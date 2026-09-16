import { Inject, Injectable, Logger } from "@nestjs/common";
import { findUserIdByDiscordId, listRoles, type DbHandle } from "@albion-hub/db";
import { asSubject, defineAbilityFor, transitionError, EVENT_TRANSITIONS, type Action, type EventDto, type EventStatus, type EventTransition } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { Context, Options, StringOption, Subcommand, createCommandGroupDecorator } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import { isConfiguredGuild } from "../domain/register-nick.js";
import { EVENT_COMMAND, EVENT_COMMAND_REPLIES, resolveEventForCommand, type EventChoice } from "../domain/event-voice.js";
import { EventsService } from "../events/events.service.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";

const EventCommandGroup = createCommandGroupDecorator({ name: EVENT_COMMAND.name, description: EVENT_COMMAND.description });

export class EventTargetOptions {
  @StringOption({ name: EVENT_COMMAND.option.name, description: EVENT_COMMAND.option.description, required: false, max_length: EVENT_COMMAND.option.maxLength })
  evento?: string;
}

/** Subconjunto de ChatInputCommandInteraction usado aqui (os testes simulam). */
export interface EventCommandInteraction {
  guildId: string | null;
  user: { id: string };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

/** Estados de onde cada ação faz sentido; o comando só oferece eventos que a máquina aceitaria (Q26). */
const STARTABLE: readonly EventStatus[] = ["open", "closed"];
const FINISHABLE: readonly EventStatus[] = ["running"];
const ACTION: Record<"start" | "finish", Action> = { start: "start", finish: "finish" };

/**
 * `/evento iniciar` e `/evento encerrar` (TASK-024, AC#4).
 *
 * Decisão: comando em vez de botão no embed. O embed de inscrição (TASK-022) já chega perto do teto de
 * 25 botões com uma role por botão, e um "Iniciar" visível para a guilda inteira convida clique errado;
 * o comando aparece só para quem digita e a resposta é efêmera.
 *
 * Segurança: **quem** chamou vem de `interaction.user.id` → usuário do painel → papéis → CASL
 * (`start`/`finish` em Event com condição de owner), a mesma regra do POST /api/events/:id/transitions.
 * O comando nunca aplica a transição sozinho: chama `EventsService.transition`, igual ao painel, então
 * o canal de voz sai do mesmo hook nos três caminhos.
 */
@EventCommandGroup()
@Injectable()
export class EventCommand {
  private readonly logger = new Logger("EventCommand");

  constructor(
    private readonly events: EventsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  @Subcommand({ name: EVENT_COMMAND.start.name, description: EVENT_COMMAND.start.description })
  async onStart(@Context() [interaction]: [EventCommandInteraction], @Options() { evento }: EventTargetOptions): Promise<void> {
    await this.run(interaction, "start", evento);
  }

  @Subcommand({ name: EVENT_COMMAND.finish.name, description: EVENT_COMMAND.finish.description })
  async onFinish(@Context() [interaction]: [EventCommandInteraction], @Options() { evento }: EventTargetOptions): Promise<void> {
    await this.run(interaction, "finish", evento);
  }

  /** Um caminho só para as duas ações: muda o estado buscado, a ação CASL e a copy. */
  private async run(interaction: EventCommandInteraction, action: "start" | "finish", query: string | undefined): Promise<void> {
    if (!isConfiguredGuild(interaction.guildId, this.guildId)) {
      await this.respond(interaction, EVENT_COMMAND_REPLIES.wrongGuild, false);
      return;
    }
    let deferred = false;
    try {
      // Banco + Discord (criar canal, arrastar gente) passam fácil dos 3 s da interação.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      await interaction.editReply({ content: await this.act(interaction.user.id, action, query) });
    } catch (error) {
      this.logger.error(`/evento ${action} de ${interaction.user.id} falhou: ${String(error)}`);
      await this.respond(interaction, EVENT_COMMAND_REPLIES.failed, deferred);
    }
  }

  private async act(discordId: string, action: "start" | "finish", query: string | undefined): Promise<string> {
    const userId = await findUserIdByDiscordId(this.handle.db, discordId);
    if (!userId) return EVENT_COMMAND_REPLIES.notRegistered;
    const ability = defineAbilityFor({ id: userId, roles: await listRoles(this.handle.db, userId) });

    const candidates = (await this.events.list({ status: [...(action === "start" ? STARTABLE : FINISHABLE)] as [EventStatus, ...EventStatus[]] }))
      .filter((event) => ability.can(ACTION[action], asSubject("Event", { ownerId: event.ownerUserId })))
      .map(choice);

    const target = resolveEventForCommand(candidates, query);
    if (target.kind === "none") return action === "start" ? EVENT_COMMAND_REPLIES.noneToStart : EVENT_COMMAND_REPLIES.noneToFinish;
    if (target.kind === "ambiguous") return EVENT_COMMAND_REPLIES.ambiguous(target.candidates);

    // Relê o evento antes de agir: entre listar e transicionar o owner pode ter sido transferido, e a
    // API faz igual (carrega e só então checa a permissão). Sem isso o ex-owner ainda daria o start.
    const fresh = await this.events.get(target.event.id);
    if (!fresh || !ability.can(ACTION[action], asSubject("Event", { ownerId: fresh.ownerUserId }))) {
      return action === "start" ? EVENT_COMMAND_REPLIES.noneToStart : EVENT_COMMAND_REPLIES.noneToFinish;
    }

    const transition: EventTransition = action;
    const result = await this.events.transition(target.event.id, transition, userId);
    if (!result.ok) {
      // Estado mudou entre a listagem e o clique: devolve o 409 da máquina, sem inventar outra regra.
      if (result.reason === "not_found") return action === "start" ? EVENT_COMMAND_REPLIES.noneToStart : EVENT_COMMAND_REPLIES.noneToFinish;
      return EVENT_COMMAND_REPLIES.invalidState(result.from, transitionError(result.from, EVENT_TRANSITIONS[transition]));
    }
    return action === "start" ? EVENT_COMMAND_REPLIES.started(result.event.name) : EVENT_COMMAND_REPLIES.finished(result.event.name);
  }

  private async respond(interaction: EventCommandInteraction, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error(`Não consegui responder o /evento: ${String(error)}`);
    }
  }
}

const choice = (event: EventDto): EventChoice => ({ id: event.id, name: event.name });
