import { Inject, Injectable } from "@nestjs/common";
import {
  payEventAttendance,
  previewEventAttendance,
  setEventRoleBuffunfa,
  type DbHandle,
  type EventAttendancePreview,
  type PayEventAttendanceResult,
  type SetEventRoleBuffunfaResult,
} from "@albion-hub/db";
import { attendanceLineToDto, BUFFUNFA_ROLE_MAX, formatAmount, type EventAttendanceDto, type EventDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit, TIMELINE_LOGGER } from "../timeline/timeline-people.js";
import { assertEventEditable } from "../events/archived.guard.js";

/**
 * Porta única da Buffunfa por participação (TASK-057, F6-8 a F6-11): a tela de fechamento, e amanhã o
 * comando do bot, chamam este serviço — nunca o repo.
 *
 * O que ele garante, além do que o banco já garante:
 * - evento **arquivado** não recebe nem ajuste de valor nem pagamento, com a frase única do
 *   `assertEventEditable` (TASK-044) — depois do arquivamento o evento é histórico;
 * - o `actorUserId` vem sempre da sessão resolvida pelo controller: nada aqui aceita um `userId` do
 *   cliente, e o `userId` de cada linha paga vem de `voice_sessions`/`event_signups`.
 */
@Injectable()
export class EventAttendanceService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  /** Prévia antes do fechamento e recibo depois dele: a mesma conta, então a tela não tem dois desenhos. */
  preview(eventId: string): Promise<EventAttendancePreview | null> {
    return previewEventAttendance(this.handle.db, eventId);
  }

/**
   * Ajuste do valor de Buffunfa até o fechamento (AC#1, AC#2). `slotId` nulo é o lote: **todas** as
   * roles do evento passam a valer o mesmo. Uma porta só para os dois gestos de propósito — quem
   * decide quem pode ajustar, e quando, não pode depender de qual botão foi clicado.
   */
  async setRoleValue(event: EventDto, slotId: string | null, value: bigint): Promise<SetEventRoleBuffunfaResult> {
    assertEventEditable(event);
    return setEventRoleBuffunfa(this.handle.db, event.id, slotId, value);
  }

  /** Fechamento: cria a Buffunfa de quem bateu os 90% (AC#4, AC#6). Idempotente. */
  async pay(event: EventDto, actorUserId: string | null): Promise<PayEventAttendanceResult> {
    assertEventEditable(event);
    const result = await payEventAttendance(this.handle.db, event.id, { actorUserId });
    // Idempotente: o segundo fechamento não cria Buffunfa, então não publica.
    if (result.ok && !result.alreadyPaid) await this.publishPaid(event, result.preview, actorUserId);
    return result;
  }

  /** Timeline (TASK-078, AC#3): um registro por fechamento, com uma linha por pessoa paga e o valor dela. */
  private publishPaid(event: EventDto, preview: EventAttendancePreview, actorUserId: string | null): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorUserId]);
      const paid = preview.rows.filter((row) => row.skip === null && row.userId !== null && row.amount > 0n);
      return {
        action: "economy.attendance_paid" as const,
        summary: `Buffunfa por presença paga: ${event.name}`,
        actor: people.actor(actorUserId),
        target: { name: event.name, id: event.id },
        amounts: [{ value: paid.reduce((sum, row) => sum + row.amount, 0n), currency: "buffunfa" as const, label: "Total pago" }],
        recordId: event.id,
        details: [{ name: "Pessoas pagas", value: String(paid.length) }],
        list: { title: "Pagos", items: paid.map((row) => `${row.nick} (${row.roleName ?? "sem role"}): ${formatAmount(row.amount, "buffunfa")}`) },
      };
    });
  }
}

/** Prévia/recibo no formato da API: valores em string (Q20). */
export const attendanceToDto = (preview: EventAttendancePreview): EventAttendanceDto => ({
  windowMs: preview.windowMs,
  measured: preview.measured,
  paidAt: preview.paidAt ? preview.paidAt.toISOString() : null,
  lines: preview.rows.map(attendanceLineToDto),
  total: preview.total.toString(),
});

/** Frase do 409 de cada recusa do ajuste de valor. Cada uma diz qual é o próximo passo. */
export function attendanceValueError(result: Exclude<SetEventRoleBuffunfaResult, { ok: true }>): string {
  switch (result.reason) {
    case "above_max":
      return `O valor de Buffunfa vai de 0 a ${BUFFUNFA_ROLE_MAX} por role. A faixa do template é sugestão de partida; este teto é do sistema.`;
    case "already_paid":
      return "A Buffunfa deste evento já foi paga: os lançamentos são imutáveis e o valor por role não muda mais.";
    case "not_found":
      // O controller devolve 404 antes de chegar aqui; existe para o switch ser exaustivo.
      return "Role do evento não encontrada.";
  }
}
