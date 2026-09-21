import { Inject, Injectable, Logger } from "@nestjs/common";
import { findUserIdByDiscordId, listEventSignupMembers, listRoles, type DbHandle } from "@albion-hub/db";
import { asSubject, defineAbilityFor, isUuid, type Action, type EventDto } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { Button, ComponentParam, Context } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import {
  callAllowedDiscordIds,
  EVENT_CALL_FINISH_BUTTON,
  EVENT_CALL_LOCK_BUTTON,
  EVENT_CALL_REPLIES,
  EVENT_CALL_UNLOCK_BUTTON,
} from "../domain/event-call-menu.js";
import { TIMELINE_PUBLISHER, type TimelineAction, type TimelinePublisher } from "../domain/timeline.js";
import { EventsService } from "../events/events.service.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";

/** Subconjunto de ButtonInteraction usado aqui (os testes simulam). */
export interface CallMenuInteraction {
  user: { id: string };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

type CallAction = "finish" | "lock" | "unlock";

/** Ação CASL de cada botão: finalizar é `finish`; mexer na call é `update` do evento. */
const ABILITY: Record<CallAction, Action> = { finish: "finish", lock: "update", unlock: "update" };

/** Ação da timeline de cada botão que não passa pelo serviço de evento (o finish publica sozinho). */
const TIMELINE: Record<Exclude<CallAction, "finish">, { action: TimelineAction; verb: string }> = {
  lock: { action: "event.call_locked", verb: "Call fechada" },
  unlock: { action: "event.call_unlocked", verb: "Call aberta" },
};

/**
 * Menu de gestão da call (TASK-085, PE9 a PE11). Três botões no chat de texto do canal de voz do
 * evento: finalizar o evento, fechar a call e abrir a call. Chamar os ausentes saiu daqui e virou a
 * TASK-087 (PE12 a PE16): lá o chamado é mensagem no privado, com queda para menção e intervalo por
 * pessoa, e também sai do painel — outra ação, outro caminho, não este botão.
 *
 * **Segurança (PE11):** o menu é visível para todo mundo que enxerga a call — o Discord não esconde
 * componente por cargo —, então a checagem é no clique. Quem clicou vem sempre de
 * `interaction.user.id` → usuário do painel → papéis → CASL contra o **evento recarregado agora**,
 * nunca de dado embutido no botão: um custom id forjado não executa nada. Recusa responde efêmero e
 * **não escreve nada** — nem no banco, nem no Discord, nem na timeline.
 *
 * **Finalizar não é uma segunda implementação:** chama `EventsService.transition(..., "finish")`, o
 * mesmo serviço do painel e do `/evento encerrar`, então o canal de voz, o embed e a linha
 * `event.finished` da timeline saem do mesmo hook nos três caminhos (regra do doc-002).
 *
 * **Fechar a call é só permissão (PE10):** nega `Connect` para `@everyone` e libera os inscritos.
 * Não existe campo "call fechada" no evento — o estado é a sobrescrita do canal, e quem já está
 * dentro fica onde está. Falha do Discord (bot sem permissão, canal apagado na mão) vira mensagem
 * clara para quem clicou e não derruba o evento.
 */
@Injectable()
export class EventCallInteractions {
  private readonly logger = new Logger("EventCallMenu");

  constructor(
    private readonly events: EventsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EVENT_VOICE_GATEWAY) private readonly gateway: EventVoiceGateway,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  @Button(EVENT_CALL_FINISH_BUTTON)
  async onFinish(@Context() [interaction]: [CallMenuInteraction], @ComponentParam("eventId") eventId: string): Promise<void> {
    await this.guarded(interaction, eventId, "finish");
  }

  @Button(EVENT_CALL_LOCK_BUTTON)
  async onLock(@Context() [interaction]: [CallMenuInteraction], @ComponentParam("eventId") eventId: string): Promise<void> {
    await this.guarded(interaction, eventId, "lock");
  }

  @Button(EVENT_CALL_UNLOCK_BUTTON)
  async onUnlock(@Context() [interaction]: [CallMenuInteraction], @ComponentParam("eventId") eventId: string): Promise<void> {
    await this.guarded(interaction, eventId, "unlock");
  }

  /** Valida o id, a permissão e o estado antes de qualquer escrita; responde sempre efêmero. */
  private async guarded(interaction: CallMenuInteraction, eventId: string, action: CallAction): Promise<void> {
    let deferred = false;
    try {
      if (!isUuid(eventId)) return void (await interaction.reply(ephemeral(EVENT_CALL_REPLIES.invalid)));
      // Banco + Discord (permissão do canal, mensagem, finalizar) passam fácil dos 3 s da interação.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      await interaction.editReply({ content: await this.act(interaction.user.id, eventId, action) });
    } catch (error) {
      this.logger.error(`Menu da call (${action}) do evento ${eventId} falhou: ${String(error)}`);
      await this.safeRespond(interaction, EVENT_CALL_REPLIES.failed, deferred);
    }
  }

  private async act(discordId: string, eventId: string, action: CallAction): Promise<string> {
    const userId = await findUserIdByDiscordId(this.handle.db, discordId);
    if (!userId) return EVENT_CALL_REPLIES.notRegistered;
    const event = await this.events.get(eventId);
    if (!event) return EVENT_CALL_REPLIES.notFound;

    // PE11: caller do evento (owner) ou staff. As duas condições são a regra do CASL, a mesma da API.
    const ability = defineAbilityFor({ id: userId, roles: await listRoles(this.handle.db, userId) });
    if (!ability.can(ABILITY[action], asSubject("Event", { ownerId: event.ownerUserId }))) return EVENT_CALL_REPLIES.denied;

    // Evento já finalizado ou cancelado: o menu recusa com o motivo, e nada acontece.
    if (event.status !== "running") return EVENT_CALL_REPLIES.notRunning(event.status);

    if (action === "finish") return this.finish(event, userId);
    if (!event.voiceChannelId) return EVENT_CALL_REPLIES.noChannel;
    return this.setLock(event, event.voiceChannelId, userId, action === "lock");
  }

  /** Mesmo serviço do painel (AC#2): o menu não conhece a máquina de estados nem o canal de voz. */
  private async finish(event: EventDto, userId: string): Promise<string> {
    const result = await this.events.transition(event.id, "finish", userId);
    if (result.ok) return EVENT_CALL_REPLIES.finished(result.event.name);
    if (result.reason === "not_found") return EVENT_CALL_REPLIES.notFound;
    if (result.reason === "blocked") return result.message;
    return EVENT_CALL_REPLIES.notRunning(result.from);
  }

  private async setLock(event: EventDto, channelId: string, userId: string, locked: boolean): Promise<string> {
    const signups = await listEventSignupMembers(this.handle.db, event.id);
    const allowed = callAllowedDiscordIds(signups);
    try {
      await this.gateway.setChannelConnectLock(channelId, locked, allowed, `Menu da call do evento ${event.name}`);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: falha ao ${locked ? "fechar" : "abrir"} a call ${channelId}. ${describeDiscordError(error)}`);
      return EVENT_CALL_REPLIES.lockFailed;
    }
    await this.publish(locked ? "lock" : "unlock", event, userId, [{ name: "Inscritos liberados", value: String(allowed.length) }]);
    return locked ? EVENT_CALL_REPLIES.locked : EVENT_CALL_REPLIES.unlocked;
  }

  /** Linha da timeline com **quem clicou** (AC#7). Falhar aqui nunca desfaz o que já aconteceu (T6). */
  private async publish(action: Exclude<CallAction, "finish">, event: EventDto, userId: string, details: { name: string; value: string }[]): Promise<void> {
    const meta = TIMELINE[action];
    await publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [userId]);
      return { action: meta.action, summary: `${meta.verb}: ${event.name}`, actor: people.actor(userId), recordId: event.id, details };
    });
  }

  private async safeRespond(interaction: CallMenuInteraction, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply(ephemeral(content));
    } catch (error) {
      this.logger.error(`Não consegui responder a interação do menu da call: ${String(error)}`);
    }
  }
}

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });
