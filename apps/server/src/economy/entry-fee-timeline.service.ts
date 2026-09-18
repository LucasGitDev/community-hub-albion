import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { DbHandle } from "@albion-hub/db";
import { ENTRY_FEE_REFUND_REASONS, formatAmount } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { EventsService, type EventTransitionEvent } from "../events/events.service.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/after-commit.js";
import { LedgerService } from "./ledger.service.js";

/**
 * Devolução da taxa de entrada **em lote** na timeline (TASK-078): cancelar o evento devolve a todos
 * (F6-14) e iniciar devolve a quem ficou na espera. As duas acontecem dentro da transação da transição,
 * no repo de eventos; aqui o listener de transição, que roda **depois do commit**, lê os estornos que
 * ela gravou e publica um registro consolidado (AC#3).
 *
 * Os estornos são achados pelo motivo gravado no `memo` (`ENTRY_FEE_REFUND_REASONS`): cancelamento e
 * início acontecem uma vez só por evento, então o motivo identifica exatamente o lote daquela transição.
 */
@Injectable()
export class EntryFeeTimelineService implements OnModuleInit {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  onModuleInit(): void {
    this.events.onEventTransition((event) => this.onTransition(event));
  }

  async onTransition({ event, to, actorUserId }: EventTransitionEvent): Promise<void> {
    const reason = to === "cancelled" ? ENTRY_FEE_REFUND_REASONS.cancelled : to === "running" ? ENTRY_FEE_REFUND_REASONS.waitlisted : null;
    if (!reason) return;
    await publishAfterCommit(this.timeline, async () => {
      const refunds = (await this.ledger.byReference("event", event.id)).filter((e) => e.kind === "reversal" && e.currency === "buffunfa" && e.memo === reason);
      if (refunds.length === 0) return null;
      const people = await loadTimelinePeople(this.handle.db, [actorUserId, ...refunds.map((e) => e.userId)]);
      return {
        action: "economy.entry_fee_refunded" as const,
        summary: `Taxa de entrada devolvida em lote: ${event.name}`,
        actor: people.actor(actorUserId),
        target: { name: event.name, id: event.id },
        amounts: [{ value: refunds.reduce((sum, e) => sum + e.amount, 0n), currency: "buffunfa" as const, label: "Total devolvido" }],
        recordId: event.id,
        details: [{ name: "Motivo", value: reason }],
        list: { title: "Devolvidos", items: refunds.map((e) => `${people.name(e.userId)}: ${formatAmount(e.amount, "buffunfa")}`) },
      };
    });
  }
}
