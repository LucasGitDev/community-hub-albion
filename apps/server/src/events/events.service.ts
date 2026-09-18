import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  applyEventTransition,
  closeDueEvents,
  createEvent,
  getEvent,
  listEventOwnerHistory,
  listEventSignupMembers,
  listTimelineUsers,
  listEvents,
  setEventEntryFee,
  transferEventOwner,
  updateEventDetails,
  type CreateEventResult,
  type DbHandle,
  type EventTransitionPrecondition,
  type EventTransitionResult,
  type TransferEventOwnerResult,
} from "@albion-hub/db";
import { EVENT_TRANSITIONS, type EventCreateInput, type EventUpdateInput, type EventDto, type EventListQuery, type EventOwnerChangeDto, type EventStatus, type EventTransition } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelineAction, type TimelineActor, type TimelineEntry, type TimelinePublisher } from "../domain/timeline.js";
import { ListenerSet } from "../members/listener-set.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";

/** Ação da timeline de cada estado novo do evento (TASK-077). */
const TRANSITION_ACTIONS: Record<EventStatus, { action: TimelineAction; verb: string } | null> = {
  draft: null,
  open: { action: "event.opened", verb: "Inscrições abertas" },
  closed: { action: "event.signups_closed", verb: "Inscrições fechadas" },
  running: { action: "event.started", verb: "Evento iniciado" },
  finished: { action: "event.finished", verb: "Evento finalizado" },
  cancelled: { action: "event.cancelled", verb: "Evento cancelado" },
  archived: { action: "event.archived", verb: "Evento arquivado" },
};

/** Ator do fechamento no horário: não há pessoa, é o job (TASK-077). */
const AUTO_CLOSE_ACTOR: TimelineActor = { kind: "system", name: "Fechamento automático" };

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

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

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
  async create(input: EventCreateInput, actorUserId: string): Promise<CreateEventResult> {
    const { templateId, name, description, startsAt, signupsCloseAt } = input;
    const result = await createEvent(this.handle.db, { templateId, name, description, startsAt, signupsCloseAt, ownerUserId: actorUserId, createdBy: actorUserId });
    if (result.ok) {
      const { event } = result;
      await publishAfterCommit(this.timeline, this.logger, async () => {
        const people = await loadTimelinePeople(this.handle.db, [actorUserId]);
        return {
          action: "event.created",
          summary: `Evento criado: ${event.name}`,
          actor: people.actor(actorUserId),
          recordId: event.id,
          details: [
            { name: "Template", value: event.templateName ?? event.templateId },
            { name: "Início", value: event.startsAt ?? "sem data" },
          ],
        };
      });
    }
    return result;
  }

  get(id: string): Promise<EventDto | null> {
    return getEvent(this.handle.db, id);
  }

  list(filters: EventListQuery): Promise<EventDto[]> {
    return listEvents(this.handle.db, filters);
  }

  /**
   * Corrige nome e descrição do evento (TASK-029, AC#2). Quem barra evento arquivado é o
   * `assertEventEditable` do controller, pelo mesmo caminho da taxa: uma frase só para todo o acerto.
   */
  /**
   * Taxa de entrada do evento (TASK-058, F6-12). Serviço único (doc-002): painel, comando e botão
   * passam por aqui. Quem decide **quando** ainda dá para mexer é o controller, com `entryFeeEditable`.
   */
  setEntryFee(id: string, entryFee: bigint): Promise<EventDto | null> {
    return setEventEntryFee(this.handle.db, id, entryFee);
  }

  update(id: string, fields: EventUpdateInput): Promise<EventDto | null> {
    return updateEventDetails(this.handle.db, id, fields);
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
    if (result.ok) {
      await publishAfterCommit(this.timeline, this.logger, async () => {
        const people = await loadTimelinePeople(this.handle.db, [actorUserId]);
        return this.transitionEntry(result.event, result.from, to, people.actor(actorUserId));
      });
      await this.listeners.emit({ event: result.event, from: result.from, to, transition, actorUserId, reason: result.event.cancelReason }, `evento ${id}`);
    }
    return result;
  }

  async transferOwner(id: string, toUserId: string, actorUserId: string): Promise<TransferEventOwnerResult> {
    return transferEventOwner(this.handle.db, id, toUserId, actorUserId);
  }

  /** Fechamento automático da inscrição (AC#5). Emite a mesma transição para quem escuta. */
  async closeDue(now: Date): Promise<EventDto[]> {
    const closed = await closeDueEvents(this.handle.db, now);
    for (const event of closed) {
      await publishAfterCommit(this.timeline, this.logger, () => this.transitionEntry(event, "open", "closed", AUTO_CLOSE_ACTOR));
      await this.listeners.emit({ event, from: "open", to: "closed", transition: "auto-close", actorUserId: null }, `evento ${event.id}`);
    }
    return closed;
  }

  /**
   * Registro de uma transição já gravada. O fechamento das inscrições leva a lista de quem estava inscrito,
   * com role e posição (T8): é o único momento em que a inscrição aparece na timeline — entrar, sair e
   * mover não publicam uma a uma.
   */
  private async transitionEntry(event: EventDto, from: EventStatus, to: EventStatus, actor: TimelineActor): Promise<TimelineEntry> {
    const meta = TRANSITION_ACTIONS[to] ?? { action: "event.transitioned" as const, verb: "Evento mudou de estado" };
    const details = [{ name: "Estado", value: `${from} → ${to}` }];
    if (to === "cancelled" && event.cancelReason) details.push({ name: "Motivo", value: event.cancelReason });
    const entry: TimelineEntry = { action: meta.action, summary: `${meta.verb}: ${event.name}`, actor, recordId: event.id, details };
    if (to !== "closed") return entry;

    const signups = await listEventSignupMembers(this.handle.db, event.id);
    const names = await listTimelineUsers(this.handle.db, signups.map((s) => s.userId));
    const confirmed = signups.filter((s) => s.status === "confirmed").length;
    details.push({ name: "Confirmados", value: String(confirmed) }, { name: "Na espera", value: String(signups.length - confirmed) });
    const items = signups.map((s) => `${names.get(s.userId)?.name ?? s.gameNick ?? "Membro"} · ${s.roleName} · ${s.status === "confirmed" ? "confirmado" : `espera ${s.position}`}`);
    return { ...entry, list: { title: "Inscritos", items } };
  }
}
