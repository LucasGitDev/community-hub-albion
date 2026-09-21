import { Inject, Injectable, Logger } from "@nestjs/common";
import { claimEventSummons, listEventSignupMembers, listRoles, type DbHandle } from "@albion-hub/db";
import { asSubject, defineAbilityFor, type EventDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import {
  EVENT_SUMMON_COOLDOWN_MS,
  eventCallLink,
  eventSummonDmView,
  eventSummonMentionText,
  summonTargets,
  type SummonOutcome,
  type SummonTarget,
} from "../domain/event-summon.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { EventsService } from "../events/events.service.js";
import type { EventSummoner, SummonEventResult } from "../events/event-summoner.token.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";

/** Relógio injetável: o teste do intervalo de 5 minutos precisa mandar no tempo. */
export const SUMMON_CLOCK = Symbol("SUMMON_CLOCK");

/**
 * Chamar quem se inscreveu e não entrou na call (TASK-087, PE12 a PE16).
 *
 * É **um serviço só** para as três portas — o início do evento, o menu da call e o menu do evento no
 * painel —, como manda a regra do doc-002: a permissão, o intervalo, a queda para menção e a linha da
 * timeline nascem aqui, e cada porta só traduz o resultado para a sua tela.
 *
 * Ordem de propósito:
 * 1. permissão (`update` em Event com condição de dono: caller do evento ou staff, mesma do menu da call);
 * 2. estado (evento rodando e com canal de voz);
 * 3. alvos (confirmado fora da call; a espera nunca, PE13);
 * 4. **reserva do intervalo no banco** antes de mandar qualquer coisa (PE15) — reservar depois deixaria
 *    dois cliques simultâneos mandarem os dois privados, que é justamente o que a decisão proíbe;
 * 5. privado um a um; quem o Discord recusar (DM fechada) entra na **única** menção do chat da call (PE14);
 * 6. timeline com quem acionou e quantos foram avisados (AC#8), depois do envio e sem nunca derrubar nada.
 *
 * Quem falha no envio **continua com o intervalo consumido**: no caso normal ele recebeu a menção, que
 * é o aviso que a PE14 promete, e um segundo clique não pode virar uma segunda menção da mesma pessoa
 * no mesmo chat. Quando nem a menção sai (bot sem permissão de escrever na call), essa pessoa fica 5
 * minutos sem ser chamada de novo — é o preço de não arriscar privado repetido, e o log diz o que
 * falhou para o operador arrumar a permissão.
 */
@Injectable()
export class EventSummonService implements EventSummoner {
  private readonly logger = new Logger("EventSummon");

  constructor(
    private readonly events: EventsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EVENT_VOICE_GATEWAY) private readonly gateway: EventVoiceGateway,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
    @Inject(SUMMON_CLOCK) private readonly now: () => Date,
  ) {}

  /** Porta pública: checa permissão e estado antes de qualquer envio. */
  async summon(eventId: string, actorUserId: string): Promise<SummonEventResult> {
    const event = await this.events.get(eventId);
    if (!event) return { ok: false, reason: "not_found" };

    const ability = defineAbilityFor({ id: actorUserId, roles: await listRoles(this.handle.db, actorUserId) });
    if (!ability.can("update", asSubject("Event", { ownerId: event.ownerUserId }))) return { ok: false, reason: "denied" };
    if (event.status !== "running") return { ok: false, reason: "not_running" };
    if (!event.voiceChannelId) return { ok: false, reason: "no_channel" };

    return { ok: true, outcome: await this.run(event, event.voiceChannelId, actorUserId) };
  }

  /**
   * Chamado disparado pelo **início do evento** (AC#1), já com o canal recém-criado. Não passa pela
   * permissão: quem iniciou o evento já foi autorizado pela transição, e o ator pode ser o job de
   * fechamento automático (`null`). Nunca lança — o start não pode cair por causa do chamado (AC#7).
   */
  async summonOnStart(event: EventDto, channelId: string, actorUserId: string | null): Promise<SummonOutcome | null> {
    try {
      return await this.run(event, channelId, actorUserId);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: o chamado de quem não entrou na call falhou, mas o evento começou normalmente. ${describeDiscordError(error)}`);
      return null;
    }
  }

  private async run(event: EventDto, channelId: string, actorUserId: string | null): Promise<SummonOutcome> {
    const signups = await listEventSignupMembers(this.handle.db, event.id);
    const present = await this.presentInCall(channelId);
    const targets = summonTargets(signups, present);

    // PE15: o banco decide quem está fora do intervalo, e decide **antes** de qualquer envio.
    const allowed = new Set(await claimEventSummons(this.handle.db, event.id, targets.map((t) => t.userId), { now: this.now(), cooldownMs: EVENT_SUMMON_COOLDOWN_MS }));
    const calling = targets.filter((t) => allowed.has(t.userId));

    const { notified, closed } = await this.sendDms(event, channelId, calling);
    const mentioned = await this.mentionClosed(event, channelId, closed);

    const outcome: SummonOutcome = { notified: notified.length, mentioned, skipped: targets.length - calling.length, targets: targets.length };
    this.logger.log(`Evento ${event.id}: chamado — ${outcome.notified} no privado, ${outcome.mentioned} por menção, ${outcome.skipped} dentro do intervalo de 5 min.`);
    await this.publish(event, actorUserId, outcome);
    return outcome;
  }

  /** Quem está na call agora. Canal apagado na mão não pode derrubar o chamado: vira "ninguém dentro". */
  private async presentInCall(channelId: string): Promise<string[]> {
    try {
      return await this.gateway.listMembersInChannel(channelId);
    } catch (error) {
      this.logger.error(`Não consegui listar quem está na call ${channelId}; sigo como se estivesse vazia. ${describeDiscordError(error)}`);
      return [];
    }
  }

  /** Um privado por vez: quem recusar (DM fechada) não impede o próximo de receber. */
  private async sendDms(event: EventDto, channelId: string, targets: readonly SummonTarget[]): Promise<{ notified: SummonTarget[]; closed: SummonTarget[] }> {
    const view = eventSummonDmView(event, eventCallLink(this.guildId, channelId));
    const notified: SummonTarget[] = [];
    const closed: SummonTarget[] = [];
    for (const target of targets) {
      try {
        await this.gateway.sendDirectMessage(target.discordId, view);
        notified.push(target);
      } catch (error) {
        closed.push(target);
        this.logger.warn(`Evento ${event.id}: privado recusado para ${target.discordId}, cai para menção. ${describeDiscordError(error)}`);
      }
    }
    return { notified, closed };
  }

  /** PE14: uma mensagem só, com a lista inteira. Falhar aqui não desfaz os privados que já saíram. */
  private async mentionClosed(event: EventDto, channelId: string, closed: readonly SummonTarget[]): Promise<number> {
    if (closed.length === 0) return 0;
    try {
      await this.gateway.mentionInChannel(
        channelId,
        closed.map((t) => t.discordId),
        eventSummonMentionText(event, closed.map((t) => t.discordId)),
      );
      return closed.length;
    } catch (error) {
      this.logger.error(`Evento ${event.id}: não consegui mencionar no chat da call quem está com o privado fechado. ${describeDiscordError(error)}`);
      return 0;
    }
  }

  /** Linha da timeline com quem acionou e quantos foram avisados (AC#8). Nunca derruba o chamado (T6). */
  private async publish(event: EventDto, actorUserId: string | null, outcome: SummonOutcome): Promise<void> {
    await publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorUserId]);
      return {
        action: "event.call_summoned" as const,
        summary: `Chamado de quem não entrou na call: ${event.name}`,
        actor: people.actor(actorUserId, "início do evento"),
        recordId: event.id,
        details: [
          { name: "Avisados no privado", value: String(outcome.notified) },
          { name: "Mencionados na call", value: String(outcome.mentioned) },
          { name: "Dentro do intervalo de 5 min", value: String(outcome.skipped) },
          { name: "Confirmados fora da call", value: String(outcome.targets) },
        ],
      };
    });
  }
}
