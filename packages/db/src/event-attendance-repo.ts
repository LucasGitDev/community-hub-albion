import {
  attendanceMemo,
  attendanceRows,
  attendanceTotal,
  inBuffunfaRange,
  type AttendanceRow,
  type BuffunfaRange,
  type SplitPresenceDto,
} from "@albion-hub/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { EventTx } from "./events-repo.js";
import { insertLedgerEntry } from "./ledger-repo.js";
import { eventCallWindowMs, listEventPresence } from "./loot-split-repo.js";
import { eventRoleSlots, events } from "./schema.js";

/**
 * Buffunfa por participação em evento (TASK-057, F6-8 a F6-11).
 *
 * O desenho, em uma frase: o valor **por role** vive na vaga do evento (`event_role_slots`), o caller
 * mexe nele até o fechamento, e o fechamento é uma transação só que lê a presença, grava um
 * lançamento por pessoa elegível e carimba `events.buffunfa_paid_at`.
 *
 * Três garantias que não dependem do JavaScript:
 * - **valor dentro da faixa**: checado aqui e, por baixo, pelo `check` de `event_role_slots`;
 * - **paga uma vez só**: o `update ... where buffunfa_paid_at is null` na mesma transação dos
 *   lançamentos é a chave de idempotência — dois cliques simultâneos, um pagamento;
 * - **valor do fechamento para todos daquela role** (F6-9): o rateio lê a coluna da vaga no instante
 *   do pagamento e nada olha para a data da inscrição.
 *
 * A medição de presença **não** é reimplementada: é a mesma `listEventPresence` do loot split, no
 * mesmo relógio (Q6). Se o corte dos 90% e o rateio da prata discordassem sobre quem esteve na call,
 * uma das duas telas estaria mentindo.
 */

export interface EventAttendancePreview {
  windowMs: number;
  measured: boolean;
  paidAt: Date | null;
  rows: AttendanceRow[];
  total: bigint;
}

/** Leitura serve tanto o pool quanto a transação de quem está pagando. */
type Reader = Database | EventTx;

/** Vaga com a faixa e o valor vigente, já em bigint. */
export interface EventRoleBuffunfa extends BuffunfaRange {
  slotId: string;
  name: string;
  value: bigint;
}

export async function listEventRoleBuffunfa(db: Reader, eventId: string): Promise<EventRoleBuffunfa[]> {
  const rows = await db
    .select({
      slotId: eventRoleSlots.id,
      name: eventRoleSlots.name,
      min: eventRoleSlots.buffunfaMin,
      max: eventRoleSlots.buffunfaMax,
      value: eventRoleSlots.buffunfaValue,
    })
    .from(eventRoleSlots)
    .where(eq(eventRoleSlots.eventId, eventId))
    .orderBy(eventRoleSlots.sortOrder);
  return rows;
}

export type SetEventRoleBuffunfaResult = { ok: true } | { ok: false; reason: "not_found" | "out_of_range" | "already_paid"; range?: BuffunfaRange };

/**
 * Troca o valor de Buffunfa de uma role do evento (AC#2). Recusa fora da faixa e recusa depois do
 * pagamento: o ledger é imutável, então mudar o valor depois não mudaria nada e só mentiria na tela.
 */
export async function setEventRoleBuffunfa(db: Database, eventId: string, slotId: string, value: bigint): Promise<SetEventRoleBuffunfaResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ paidAt: events.buffunfaPaidAt }).from(events).where(eq(events.id, eventId)).for("update");
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (event.paidAt) return { ok: false as const, reason: "already_paid" as const };
    const [slot] = await tx
      .select({ min: eventRoleSlots.buffunfaMin, max: eventRoleSlots.buffunfaMax })
      .from(eventRoleSlots)
      .where(and(eq(eventRoleSlots.id, slotId), eq(eventRoleSlots.eventId, eventId)));
    if (!slot) return { ok: false as const, reason: "not_found" as const };
    if (!inBuffunfaRange(value, slot)) return { ok: false as const, reason: "out_of_range" as const, range: slot };
    await tx.update(eventRoleSlots).set({ buffunfaValue: value }).where(eq(eventRoleSlots.id, slotId));
    return { ok: true as const };
  });
}

/** Presença do evento no formato que o cálculo puro espera (o mesmo DTO do split). */
const toPresence = (c: Awaited<ReturnType<typeof listEventPresence>>[number]): SplitPresenceDto => ({
  discordUserId: c.discordUserId,
  userId: c.userId,
  nick: c.nick,
  signedUp: c.signedUp,
  roleName: c.roleName,
  presenceMs: c.presenceMs,
});

/**
 * Prévia (antes do pagamento) e recibo (depois): a mesma conta, com os mesmos valores por role.
 * Depois do pagamento os valores estão congelados e a presença é histórico, então recalcular devolve
 * exatamente o que foi lançado — é por isso que não existe tabela de linhas aqui, ao contrário do
 * split, cujos percentuais o caller edita à mão.
 */
export async function previewEventAttendance(db: Database, eventId: string): Promise<EventAttendancePreview | null> {
  const [event] = await db
    .select({ startedAt: events.startedAt, finishedAt: events.finishedAt, channelId: events.presenceChannelId, paidAt: events.buffunfaPaidAt })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) return null;
  const [present, slots, windowMs] = await Promise.all([listEventPresence(db, eventId), listEventRoleBuffunfa(db, eventId), eventCallWindowMs(db, eventId)]);
  const rows = attendanceRows(present.map(toPresence), {
    windowMs,
    measured: event.channelId !== null,
    valueByRole: new Map(slots.map((s) => [s.name, s.value])),
  });
  return { windowMs, measured: event.channelId !== null, paidAt: event.paidAt, rows, total: attendanceTotal(rows) };
}

export type PayEventAttendanceResult = { ok: true; alreadyPaid: boolean; preview: EventAttendancePreview } | { ok: false; reason: "not_found" | "not_measured" };

/**
 * Fecha a Buffunfa do evento (AC#3, AC#6): um lançamento `event_attendance` por participante que
 * bateu os 90%, tudo numa transação.
 *
 * Evento sem `presence_channel_id` é recusado antes de escrever qualquer coisa (F6-11): sem medição
 * não há comparecimento provado, e um carimbo de "pago zero" esconderia isso do caller.
 */
export async function payEventAttendance(db: Database, eventId: string, options: { actorUserId?: string | null } = {}): Promise<PayEventAttendanceResult> {
  const result = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        name: events.name,
        startedAt: events.startedAt,
        finishedAt: events.finishedAt,
        channelId: events.presenceChannelId,
        paidAt: events.buffunfaPaidAt,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    if (!event) return { ok: false as const, reason: "not_found" as const };
    // Segunda chamada não credita de novo: quem garante é a trava da linha do evento, não o cliente.
    if (event.paidAt) return { ok: true as const, alreadyPaid: true };
    if (!event.channelId) return { ok: false as const, reason: "not_measured" as const };

    const [present, slots, windowMs] = await Promise.all([listEventPresence(tx, eventId), listEventRoleBuffunfa(tx, eventId), eventCallWindowMs(tx, eventId)]);
    const rows = attendanceRows(present.map(toPresence), { windowMs, measured: true, valueByRole: new Map(slots.map((s) => [s.name, s.value])) });

    for (const row of rows) {
      if (row.skip !== null || row.userId === null || row.roleName === null) continue;
      await insertLedgerEntry(tx, {
        userId: row.userId,
        amount: row.amount,
        currency: "buffunfa",
        kind: "event_attendance",
        reference: { type: "event", id: eventId },
        createdBy: options.actorUserId ?? null,
        memo: attendanceMemo(event.name, row.roleName),
      });
    }
    // O carimbo fecha o pagamento na mesma transação dos lançamentos: ou tudo existe, ou nada existe.
    const updated = await tx
      .update(events)
      .set({ buffunfaPaidAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(events.id, eventId), isNull(events.buffunfaPaidAt)))
      .returning({ id: events.id });
    if (updated.length === 0) return { ok: false as const, reason: "not_found" as const };
    return { ok: true as const, alreadyPaid: false };
  });
  if (!result.ok) return result;
  return { ok: true, alreadyPaid: result.alreadyPaid, preview: (await previewEventAttendance(db, eventId))! };
}
