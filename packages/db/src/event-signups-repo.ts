import type { EventSignupDto, EventSignupStatus, EventStatus } from "@albion-hub/shared";
import { and, asc, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { eventRoleSlots, eventSignups, events, users } from "./schema.js";

/**
 * Inscrição por role com lista de espera (TASK-022, Q27).
 *
 * Toda escrita roda numa transação que começa travando a linha do evento (`select ... for update`),
 * como as transições da TASK-021. Isso serializa a disputa pela última vaga: dois cliques simultâneos
 * na mesma role viram um confirmado e um na espera, nunca dois confirmados. O custo é baixo (a contenção
 * é por evento) e evita ter que travar cada vaga separadamente e ainda assim ordenar a espera.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const toDto = (row: typeof eventSignups.$inferSelect): EventSignupDto => ({
  id: row.id,
  eventId: row.eventId,
  userId: row.userId,
  slotId: row.slotId,
  roleName: row.roleName,
  status: row.status,
  position: row.position,
  decidedByUserId: row.decidedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export interface EventSignupChange {
  signup: EventSignupDto;
  /** Quem subiu da espera porque uma vaga confirmada foi liberada (regra de promoção). */
  promoted: EventSignupDto | null;
}

export type JoinEventRoleResult =
  | ({ ok: true } & EventSignupChange)
  | { ok: false; reason: "not_found" | "unknown_role" | "already_in_role" }
  | { ok: false; reason: "not_open"; status: EventStatus };

export type LeaveEventResult =
  | ({ ok: true } & EventSignupChange)
  | { ok: false; reason: "not_found" | "not_signed_up" }
  | { ok: false; reason: "not_open"; status: EventStatus };

export type MoveEventSignupResult =
  | ({ ok: true } & EventSignupChange)
  | { ok: false; reason: "not_found" | "unknown_role" | "not_signed_up" | "already_there" | "role_full" }
  | { ok: false; reason: "closed_event"; status: EventStatus };

/** Estados em que a lista ainda pode mudar pelo caller/owner (AC#4): antes do evento rodar. */
const EDITABLE_BY_STAFF: readonly EventStatus[] = ["open", "closed"];

async function lockEvent(tx: Tx, eventId: string): Promise<EventStatus | null> {
  const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, eventId)).for("update");
  return row?.status ?? null;
}

async function findSlot(tx: Tx, eventId: string, slotId: string) {
  const [slot] = await tx
    .select({ id: eventRoleSlots.id, name: eventRoleSlots.name, slots: eventRoleSlots.slots })
    .from(eventRoleSlots)
    .where(and(eq(eventRoleSlots.id, slotId), eq(eventRoleSlots.eventId, eventId)));
  return slot ?? null;
}

async function findActiveSignup(tx: Tx, eventId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(eventSignups)
    .where(and(eq(eventSignups.eventId, eventId), eq(eventSignups.userId, userId), inArray(eventSignups.status, ["confirmed", "waitlist"])));
  return row ?? null;
}

async function confirmedCount(tx: Tx, slotId: string): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(eventSignups)
    .where(and(eq(eventSignups.slotId, slotId), eq(eventSignups.status, "confirmed")));
  return row?.total ?? 0;
}

/** Próxima posição da espera daquela role. Nunca reaproveita número: quem entrou antes fica na frente. */
async function nextWaitlistPosition(tx: Tx, slotId: string): Promise<number> {
  const [row] = await tx.select({ top: max(eventSignups.position) }).from(eventSignups).where(eq(eventSignups.slotId, slotId));
  return (row?.top ?? 0) + 1;
}

/**
 * Regra de promoção: liberou vaga confirmada numa role, o primeiro da espera **daquela role** sobe
 * sozinho. A espera é por role (Q27), então ninguém pula para uma role onde não se inscreveu.
 */
async function promoteFirstWaiting(tx: Tx, slotId: string, at: Date, exclude: string | null = null): Promise<EventSignupDto | null> {
  const slot = await tx.select({ slots: eventRoleSlots.slots }).from(eventRoleSlots).where(eq(eventRoleSlots.id, slotId));
  const limit = slot[0]?.slots ?? 0;
  if ((await confirmedCount(tx, slotId)) >= limit) return null;
  const [next] = await tx
    .select({ id: eventSignups.id })
    .from(eventSignups)
    .where(and(eq(eventSignups.slotId, slotId), eq(eventSignups.status, "waitlist"), ...(exclude ? [ne(eventSignups.id, exclude)] : [])))
    .orderBy(asc(eventSignups.position), asc(eventSignups.createdAt))
    .limit(1);
  if (!next) return null;
  const [promoted] = await tx.update(eventSignups).set({ status: "confirmed", position: 0, updatedAt: at }).where(eq(eventSignups.id, next.id)).returning();
  return promoted ? toDto(promoted) : null;
}

async function cancel(tx: Tx, id: string, decidedBy: string | null, at: Date): Promise<void> {
  await tx.update(eventSignups).set({ status: "cancelled", position: 0, decidedBy, updatedAt: at }).where(eq(eventSignups.id, id));
}

interface InsertInput {
  eventId: string;
  userId: string;
  slot: { id: string; name: string; slots: number };
  decidedBy: string | null;
  /** `waitlist` força a espera mesmo com vaga livre (caller mandando alguém para a espera, AC#4). */
  force?: EventSignupStatus;
  at: Date;
}

async function insertSignup(tx: Tx, { eventId, userId, slot, decidedBy, force, at }: InsertInput): Promise<EventSignupDto> {
  const confirmed = force ? force === "confirmed" : (await confirmedCount(tx, slot.id)) < slot.slots;
  const position = confirmed ? 0 : await nextWaitlistPosition(tx, slot.id);
  const [row] = await tx
    .insert(eventSignups)
    .values({
      eventId,
      userId,
      slotId: slot.id,
      roleName: slot.name,
      status: confirmed ? "confirmed" : "waitlist",
      position,
      decidedBy,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  return toDto(row!);
}

/** Inscrições do evento, confirmadas primeiro e na ordem da espera; canceladas por último (histórico). */
export async function listEventSignups(db: Database, eventId: string): Promise<EventSignupDto[]> {
  const rows = await db
    .select()
    .from(eventSignups)
    .where(eq(eventSignups.eventId, eventId))
    .orderBy(sql`case ${eventSignups.status} when 'confirmed' then 0 when 'waitlist' then 1 else 2 end`, asc(eventSignups.position), asc(eventSignups.createdAt));
  return rows.map(toDto);
}

/** Vaga do evento pelo id do botão: descobre a que evento ela pertence sem confiar no custom id (TASK-022). */
export async function findEventRoleSlot(db: Database, slotId: string): Promise<{ eventId: string; name: string } | null> {
  const [row] = await db.select({ eventId: eventRoleSlots.eventId, name: eventRoleSlots.name }).from(eventRoleSlots).where(eq(eventRoleSlots.id, slotId));
  return row ?? null;
}

/** Inscrito ativo com o que o embed do Discord precisa para mencionar a pessoa (TASK-022). */
export interface EventSignupMember {
  userId: string;
  discordId: string;
  gameNick: string | null;
  slotId: string;
  roleName: string;
  status: "confirmed" | "waitlist";
  position: number;
}

/** Inscritos ativos do evento, confirmados primeiro e a espera na ordem. Canceladas ficam de fora: o embed mostra a lista de agora. */
export async function listEventSignupMembers(db: Database, eventId: string): Promise<EventSignupMember[]> {
  const rows = await db
    .select({
      userId: eventSignups.userId,
      discordId: users.discordId,
      gameNick: users.gameNick,
      slotId: eventSignups.slotId,
      roleName: eventSignups.roleName,
      status: eventSignups.status,
      position: eventSignups.position,
    })
    .from(eventSignups)
    .innerJoin(users, eq(users.id, eventSignups.userId))
    .where(and(eq(eventSignups.eventId, eventId), inArray(eventSignups.status, ["confirmed", "waitlist"])))
    .orderBy(asc(eventSignups.position), asc(eventSignups.createdAt));
  return rows.filter((r): r is EventSignupMember => r.status !== "cancelled");
}

/**
 * Entra numa role (ou troca de role). Só com o evento `open` (AC#5). Role lotada vira espera (AC#2);
 * trocar de role cancela a inscrição anterior e, se ela era confirmada, promove o primeiro da espera dali (AC#3).
 */
export async function joinEventRole(db: Database, input: { eventId: string; userId: string; slotId: string; at?: Date }): Promise<JoinEventRoleResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const status = await lockEvent(tx, input.eventId);
    if (!status) return { ok: false as const, reason: "not_found" as const };
    if (status !== "open") return { ok: false as const, reason: "not_open" as const, status };
    const slot = await findSlot(tx, input.eventId, input.slotId);
    if (!slot) return { ok: false as const, reason: "unknown_role" as const };
    const current = await findActiveSignup(tx, input.eventId, input.userId);
    if (current?.slotId === slot.id) return { ok: false as const, reason: "already_in_role" as const };
    if (current) await cancel(tx, current.id, null, at);
    const signup = await insertSignup(tx, { eventId: input.eventId, userId: input.userId, slot, decidedBy: null, at });
    const promoted = current?.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at, signup.id) : null;
    return { ok: true as const, signup, promoted };
  });
}

/** Sai do evento. Vaga confirmada liberada promove o primeiro da espera da role (AC#3). */
export async function leaveEvent(db: Database, input: { eventId: string; userId: string; at?: Date }): Promise<LeaveEventResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const status = await lockEvent(tx, input.eventId);
    if (!status) return { ok: false as const, reason: "not_found" as const };
    if (status !== "open") return { ok: false as const, reason: "not_open" as const, status };
    const current = await findActiveSignup(tx, input.eventId, input.userId);
    if (!current) return { ok: false as const, reason: "not_signed_up" as const };
    await cancel(tx, current.id, null, at);
    const [cancelled] = await tx.select().from(eventSignups).where(eq(eventSignups.id, current.id));
    const promoted = current.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at) : null;
    return { ok: true as const, signup: toDto(cancelled!), promoted };
  });
}

/**
 * Caller/owner (ou staff) move um inscrito entre role e espera (AC#4). Vale enquanto o evento não rodou.
 * Mandar para uma role lotada é recusado em vez de estourar a vaga: quem manda decide quem sai primeiro.
 */
export async function moveEventSignup(
  db: Database,
  input: { eventId: string; userId: string; target: { kind: "role"; slotId: string } | { kind: "waitlist" }; actorUserId: string; at?: Date },
): Promise<MoveEventSignupResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const status = await lockEvent(tx, input.eventId);
    if (!status) return { ok: false as const, reason: "not_found" as const };
    if (!EDITABLE_BY_STAFF.includes(status)) return { ok: false as const, reason: "closed_event" as const, status };
    const current = await findActiveSignup(tx, input.eventId, input.userId);
    if (!current) return { ok: false as const, reason: "not_signed_up" as const };
    const slot = await findSlot(tx, input.eventId, input.target.kind === "role" ? input.target.slotId : current.slotId);
    if (!slot) return { ok: false as const, reason: "unknown_role" as const };
    if (input.target.kind === "role" && current.slotId === slot.id && current.status === "confirmed") return { ok: false as const, reason: "already_there" as const };
    if (input.target.kind === "waitlist" && current.status === "waitlist") return { ok: false as const, reason: "already_there" as const };
    if (input.target.kind === "role") {
      const free = slot.slots - (await confirmedCount(tx, slot.id)) - (current.slotId === slot.id && current.status === "confirmed" ? 1 : 0);
      if (free <= 0) return { ok: false as const, reason: "role_full" as const };
    }
    await cancel(tx, current.id, input.actorUserId, at);
    const signup = await insertSignup(tx, {
      eventId: input.eventId,
      userId: input.userId,
      slot,
      decidedBy: input.actorUserId,
      force: input.target.kind === "waitlist" ? "waitlist" : "confirmed",
      at,
    });
    // Exclui quem acabou de ser mandado para a espera: senão ele voltaria sozinho para a vaga que liberou.
    const promoted = current.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at, signup.id) : null;
    return { ok: true as const, signup, promoted };
  });
}
