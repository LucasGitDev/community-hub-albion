import { Inject, Injectable, Logger } from "@nestjs/common";
import { findUserIdByDiscordId, listRoles, type DbHandle } from "@albion-hub/db";
import { asSubject, defineAbilityFor, eventCancelSchema, transitionError, EVENT_TRANSITIONS, type Action, type EventDto, type EventStatus, type EventTransition } from "@albion-hub/shared";
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

/** `/evento cancelar` aceita, além do alvo, o motivo que vai para o embed e o painel (TASK-025). */
export class EventCancelOptions extends EventTargetOptions {
  @StringOption({ name: EVENT_COMMAND.reason.name, description: EVENT_COMMAND.reason.description, required: false, max_length: EVENT_COMMAND.reason.maxLength })
  motivo?: string;
}

/** Subconjunto de ChatInputCommandInteraction usado aqui (os testes simulam). */
export interface EventCommandInteraction {
  guildId: string | null;
  user: { id: string };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

type EventCommandAction = "start" | "finish" | "cancel" | "archive";

/** Estados de onde cada ação faz sentido; o comando só oferece eventos que a máquina aceitaria (Q26). */
const CANDIDATE_STATUSES: Record<EventCommandAction, readonly EventStatus[]> = {
  start: ["open", "closed"],
  finish: ["running"],
  // Cancelar vale de qualquer estado antes de finalizado (Q26); finalizado e cancelado não voltam atrás.
  cancel: ["draft", "open", "closed", "running"],
  // Arquivar só depois de encerrar (TASK-044, Q26): `finished` é o único estado que vai para `archived`.
  archive: ["finished"],
};
const ACTION: Record<EventCommandAction, Action> = { start: "start", finish: "finish", cancel: "cancel", archive: "archive" };
const NONE: Record<EventCommandAction, string> = {
  start: EVENT_COMMAND_REPLIES.noneToStart,
  finish: EVENT_COMMAND_REPLIES.noneToFinish,
  cancel: EVENT_COMMAND_REPLIES.noneToCancel,
  archive: EVENT_COMMAND_REPLIES.noneToArchive,
};

/**
 * `/evento iniciar`, `/evento encerrar`, `/evento cancelar` e `/evento arquivar` (TASK-024 AC#4,
 * TASK-025, TASK-044). `arquivar` entrou aqui porque é o mesmo caminho das outras três — muda só o
 * estado buscado, a ação CASL e a copy —, e quem conduz o evento pelo Discord fecharia o evento pelo
 * painel só por não ter o comando.
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

  @Subcommand({ name: EVENT_COMMAND.cancel.name, description: EVENT_COMMAND.cancel.description })
  async onCancel(@Context() [interaction]: [EventCommandInteraction], @Options() { evento, motivo }: EventCancelOptions): Promise<void> {
    await this.run(interaction, "cancel", evento, motivo);
  }

  @Subcommand({ name: EVENT_COMMAND.archive.name, description: EVENT_COMMAND.archive.description })
  async onArchive(@Context() [interaction]: [EventCommandInteraction], @Options() { evento }: EventTargetOptions): Promise<void> {
    await this.run(interaction, "archive", evento);
  }

  /** Um caminho só para as três ações: muda o estado buscado, a ação CASL e a copy. */
  private async run(interaction: EventCommandInteraction, action: EventCommandAction, query: string | undefined, reason?: string): Promise<void> {
    if (!isConfiguredGuild(interaction.guildId, this.guildId)) {
      await this.respond(interaction, EVENT_COMMAND_REPLIES.wrongGuild, false);
      return;
    }
    let deferred = false;
    try {
      // Banco + Discord (criar canal, arrastar gente) passam fácil dos 3 s da interação.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      await interaction.editReply({ content: await this.act(interaction.user.id, action, query, reason) });
    } catch (error) {
      this.logger.error(`/evento ${action} de ${interaction.user.id} falhou: ${String(error)}`);
      await this.respond(interaction, EVENT_COMMAND_REPLIES.failed, deferred);
    }
  }

  private async act(discordId: string, action: EventCommandAction, query: string | undefined, reason?: string): Promise<string> {
    const parsedReason = eventCancelSchema.safeParse({ reason: reason ?? null });
    if (!parsedReason.success) return EVENT_COMMAND_REPLIES.reasonTooLong;
    const userId = await findUserIdByDiscordId(this.handle.db, discordId);
    if (!userId) return EVENT_COMMAND_REPLIES.notRegistered;
    const ability = defineAbilityFor({ id: userId, roles: await listRoles(this.handle.db, userId) });

    const candidates = (await this.events.list({ status: [...CANDIDATE_STATUSES[action]] as [EventStatus, ...EventStatus[]] }))
      .filter((event) => ability.can(ACTION[action], asSubject("Event", { ownerId: event.ownerUserId })))
      .map(choice);

    const target = resolveEventForCommand(candidates, query);
    if (target.kind === "none") return NONE[action];
    if (target.kind === "ambiguous") return EVENT_COMMAND_REPLIES.ambiguous(target.candidates);

    // Relê o evento antes de agir: entre listar e transicionar o owner pode ter sido transferido, e a
    // API faz igual (carrega e só então checa a permissão). Sem isso o ex-owner ainda daria o start.
    const fresh = await this.events.get(target.event.id);
    if (!fresh || !ability.can(ACTION[action], asSubject("Event", { ownerId: fresh.ownerUserId }))) return NONE[action];

    const transition: EventTransition = action;
    const result = await this.events.transition(target.event.id, transition, userId, parsedReason.data.reason);
    if (!result.ok) {
      // Estado mudou entre a listagem e o clique: devolve o 409 da máquina, sem inventar outra regra.
      if (result.reason === "not_found") return NONE[action];
      // Precondição de negócio (hoje: split em rascunho barrando o arquivamento) já vem com a frase pronta.
      if (result.reason === "blocked") return result.message;
      return EVENT_COMMAND_REPLIES.invalidState(result.from, transitionError(result.from, EVENT_TRANSITIONS[transition]));
    }
    if (action === "start") return EVENT_COMMAND_REPLIES.started(result.event.name);
    if (action === "finish") return EVENT_COMMAND_REPLIES.finished(result.event.name);
    if (action === "archive") return EVENT_COMMAND_REPLIES.archived(result.event.name);
    return EVENT_COMMAND_REPLIES.cancelled(result.event.name, result.event.cancelReason);
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
