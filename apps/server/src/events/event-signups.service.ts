import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  getBanStatus,
  getEvent,
  joinEventRole,
  leaveEvent,
  listEventSignups,
  listEventsOccupancy,
  listMemberNicks,
  listUserEventSignups,
  moveEventSignup,
  type DbHandle,
  type JoinEventRoleResult,
  type LeaveEventResult,
  type MoveEventSignupResult,
} from "@albion-hub/db";
import { ENTRY_FEE_REFUND_REASONS, type EventMemberDto, type EventOccupancyDto, type EventSignupDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelineAction, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit, TIMELINE_LOGGER } from "../timeline/timeline-people.js";
import { ListenerSet } from "../members/listener-set.js";

/** Emitido depois que a lista do evento mudou. O embed do Discord assina daqui (TASK-022). */
/**
 * Resultado da inscrição no serviço: o que o repo devolve, mais a recusa por banimento (TASK-050).
 * A recusa vive aqui, e não no repo, porque banimento é regra de acesso e não regra de vaga — mas vive
 * no **serviço**, e não no controller, para o botão do Discord e o painel recusarem igual.
 */
export type JoinSignupResult = JoinEventRoleResult | { ok: false; reason: "banned"; banReason: string };

export interface EventSignupChangedEvent {
  eventId: string;
  /** `join` cobre entrar e trocar de role; `move` é o caller/owner mexendo na lista (AC#4). */
  change: "join" | "leave" | "move";
  signup: EventSignupDto;
  /** Quem subiu da espera na mesma operação, se alguém subiu. */
  promoted: EventSignupDto | null;
}

/**
 * Inscrição em evento (TASK-022, Q27). Serviço único (doc-002): botão do embed no Discord, API do
 * painel e qualquer comando futuro passam por aqui, então a regra de vagas, espera e promoção é a
 * mesma em todo lugar. A trava de concorrência e a promoção automática ficam no repo, dentro da
 * transação; aqui só ficam os hooks pós-commit.
 */
@Injectable()
export class EventSignupsService {
  private readonly logger = new Logger(EventSignupsService.name);
  private readonly listeners = new ListenerSet<EventSignupChangedEvent>(this.logger, "Listener de inscrição de evento");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  /** Registra um listener (o embed do bot). Retorna função pra remover. */
  onSignupChanged(listener: (event: EventSignupChangedEvent) => void | Promise<void>): () => void {
    return this.listeners.add(listener);
  }

  list(eventId: string): Promise<EventSignupDto[]> {
    return listEventSignups(this.handle.db, eventId);
  }

  /** Ocupação por vaga dos eventos listados: o painel desenha "2/5" sem uma consulta por evento (TASK-023). */
  occupancy(eventIds: readonly string[]): Promise<EventOccupancyDto[]> {
    return listEventsOccupancy(this.handle.db, eventIds);
  }

  /** Inscrições ativas de quem está olhando o painel (AC#1). */
  mine(userId: string, eventIds: readonly string[]): Promise<EventSignupDto[]> {
    return listUserEventSignups(this.handle.db, userId, eventIds);
  }

  /** Nome de exibição de cada pessoa citada na tela (inscritos e owner). */
  members(userIds: readonly string[]): Promise<EventMemberDto[]> {
    return listMemberNicks(this.handle.db, userIds);
  }

  /** Entra numa role ou troca de role (AC#2/AC#3). Fora de `open` é recusado (AC#5). */
  async join(eventId: string, userId: string, slotId: string): Promise<JoinSignupResult> {
    const ban = await getBanStatus(this.handle.db, userId);
    if (ban) return { ok: false, reason: "banned", banReason: ban.banReason };
    const result = await joinEventRole(this.handle.db, { eventId, userId, slotId });
    if (result.ok) await this.emit(eventId, "join", result);
    // Inscrição em si não vai para a timeline (T8); a **cobrança** vai, porque é dinheiro saindo.
    if (result.ok && result.charged) await this.publishFee("economy.entry_fee_charged", result.signup, result.charged, null);
    return result;
  }

  async leave(eventId: string, userId: string): Promise<LeaveEventResult> {
    const result = await leaveEvent(this.handle.db, { eventId, userId });
    if (result.ok) await this.emit(eventId, "leave", result);
    if (result.ok && result.refunded) await this.publishFee("economy.entry_fee_refunded", result.signup, result.refunded, ENTRY_FEE_REFUND_REASONS.left);
    return result;
  }

  /** Caller/owner move alguém entre role e espera (AC#4). */
  async move(eventId: string, userId: string, target: { kind: "role"; slotId: string } | { kind: "waitlist" }, actorUserId: string): Promise<MoveEventSignupResult> {
    const result = await moveEventSignup(this.handle.db, { eventId, userId, target, actorUserId });
    if (result.ok) await this.emit(eventId, "move", result);
    return result;
  }

  /** Timeline (TASK-078): taxa de entrada cobrada ou devolvida, depois do commit da inscrição (T5). */
  private publishFee(action: TimelineAction, signup: EventSignupDto, amount: bigint, reason: string | null): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const [people, event] = await Promise.all([loadTimelinePeople(this.handle.db, [signup.userId]), getEvent(this.handle.db, signup.eventId)]);
      const eventName = event?.name ?? "evento";
      return {
        action,
        summary: `${action === "economy.entry_fee_charged" ? "Taxa de entrada cobrada" : "Taxa de entrada devolvida"}: ${eventName}`,
        actor: people.actor(signup.userId),
        target: { name: eventName, id: signup.eventId },
        amounts: [{ value: amount, currency: "buffunfa" as const }],
        recordId: signup.id,
        ...(reason ? { details: [{ name: "Motivo", value: reason }] } : {}),
      };
    });
  }

  private emit(eventId: string, change: EventSignupChangedEvent["change"], result: { signup: EventSignupDto; promoted: EventSignupDto | null }): Promise<void> {
    return this.listeners.emit({ eventId, change, signup: result.signup, promoted: result.promoted }, `evento ${eventId}`);
  }
}
