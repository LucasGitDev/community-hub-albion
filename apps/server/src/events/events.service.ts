import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  applyEventTransition,
  closeDueEvents,
  createEvent,
  getEvent,
  listEventOwnerHistory,
  listEvents,
  transferEventOwner,
  type CreateEventResult,
  type DbHandle,
  type EventTransitionPrecondition,
  type EventTransitionResult,
  type TransferEventOwnerResult,
} from "@albion-hub/db";
import { EVENT_TRANSITIONS, type EventCreateInput, type EventDto, type EventListQuery, type EventOwnerChangeDto, type EventStatus, type EventTransition } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { ListenerSet } from "../members/listener-set.js";

/** Evento emitido depois que a transição foi gravada. TASK-022 (embed) e TASK-024 (canal de voz) assinam aqui. */
export interface EventTransitionEvent {
  event: EventDto;
  from: EventStatus;
  to: EventStatus;
  /** Ação chamada (`start`, `cancel`...) ou `auto-close` quando foi o fechamento automático (AC#5). */
  transition: EventTransition | "auto-close";
  /** Quem pediu; null quando foi o job. */
  actorUserId: string | null;
  /** Motivo escrito no cancelamento (TASK-025); null nas outras transições. */
  reason?: string | null;
}

export type EventTransitionListener = (event: EventTransitionEvent) => void | Promise<void>;

/**
 * Único ponto de mudança de estado de evento (doc-002): comando do bot, botão do embed e painel
 * chamam este serviço, nunca o repo direto. A validação da transição é da máquina compartilhada
 * (@albion-hub/shared), aplicada dentro da transação do repo.
 * Listeners rodam depois do commit; falha de listener é logada e não desfaz a transição.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly listeners = new ListenerSet<EventTransitionEvent>(this.logger, "Listener de transição de evento");

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Registra um listener (ex.: módulo do bot no onModuleInit). Retorna função pra remover. */
  onEventTransition(listener: EventTransitionListener): () => void {
    return this.listeners.add(listener);
  }

  /**
   * Arquivar exige que não haja loot split em rascunho (TASK-044, AC#4). O split não existe ainda —
   * ele nasce na F5 (TASK-027/028) —, então o default aqui é "não há nada pendente" e a F5 registra a
   * consulta real com `setArchivePrecondition`, sem reabrir este serviço nem o repo.
   *
   * A função roda **dentro** da transação da transição, com o evento já travado por `for update`:
   * é isso que impede a corrida entre conferir os splits e gravar o `archived`.
   */
  private archivePrecondition: EventTransitionPrecondition = () => Promise.resolve(null);

  setArchivePrecondition(precondition: EventTransitionPrecondition): void {
    this.archivePrecondition = precondition;
  }

  /** Cria o evento; quem cria vira owner (Q21, AC#1). */
  create(input: EventCreateInput, actorUserId: string): Promise<CreateEventResult> {
    const { templateId, name, description, startsAt, signupsCloseAt } = input;
    return createEvent(this.handle.db, { templateId, name, description, startsAt, signupsCloseAt, ownerUserId: actorUserId, createdBy: actorUserId });
  }

  get(id: string): Promise<EventDto | null> {
    return getEvent(this.handle.db, id);
  }

  list(filters: EventListQuery): Promise<EventDto[]> {
    return listEvents(this.handle.db, filters);
  }

  ownerHistory(id: string): Promise<EventOwnerChangeDto[]> {
    return listEventOwnerHistory(this.handle.db, id);
  }

  /**
   * Muda o estado do evento. `reason` só é gravado no cancelamento (TASK-025) e as inscrições ativas
   * são canceladas junto, dentro da transação do repo — quem escuta já recebe o evento com tudo feito.
   */
  async transition(id: string, transition: EventTransition, actorUserId: string, reason: string | null = null): Promise<EventTransitionResult> {
    const to = EVENT_TRANSITIONS[transition];
    const result = await applyEventTransition(this.handle.db, id, to, { reason, ...(to === "archived" ? { precondition: this.archivePrecondition } : {}) });
    if (result.ok) await this.listeners.emit({ event: result.event, from: result.from, to, transition, actorUserId, reason: result.event.cancelReason }, `evento ${id}`);
    return result;
  }

  async transferOwner(id: string, toUserId: string, actorUserId: string): Promise<TransferEventOwnerResult> {
    return transferEventOwner(this.handle.db, id, toUserId, actorUserId);
  }

  /** Fechamento automático da inscrição (AC#5). Emite a mesma transição para quem escuta. */
  async closeDue(now: Date): Promise<EventDto[]> {
    const closed = await closeDueEvents(this.handle.db, now);
    for (const event of closed) await this.listeners.emit({ event, from: "open", to: "closed", transition: "auto-close", actorUserId: null }, `evento ${event.id}`);
    return closed;
  }
}
