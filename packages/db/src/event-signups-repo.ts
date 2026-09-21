import { ACTIVE_EVENT_SIGNUP_STATUSES, ENTRY_FEE_REFUND_REASONS, NO_ENTRY_FEE, type EventMemberDto, type EventOccupancyDto, type EventSignupDto, type EventSignupStatus, type EventStatus } from "@albion-hub/shared";
import { and, asc, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { refundEntryFee } from "./entry-fee-repo.js";
import { spendCurrencyTx } from "./ledger-repo.js";
import { memberNick } from "./member-nick.js";
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
  /** `charged` é a taxa debitada agora; null quando o evento é gratuito ou quando foi só troca de role. */
  | ({ ok: true; charged: bigint | null } & EventSignupChange)
  | { ok: false; reason: "not_found" | "unknown_role" | "already_in_role" }
  | { ok: false; reason: "not_open"; status: EventStatus }
  /** Taxa de entrada maior que o saldo em Buffunfa (AC#2). Leva os dois números para a mensagem dizer o que falta. */
  | { ok: false; reason: "insufficient_funds"; fee: bigint; balance: bigint };

export type LeaveEventResult =
  | ({ ok: true; refunded: bigint | null } & EventSignupChange)
  | { ok: false; reason: "not_found" | "not_signed_up" }
  | { ok: false; reason: "not_open"; status: EventStatus };

export type MoveEventSignupResult =
  | ({ ok: true } & EventSignupChange)
  | { ok: false; reason: "not_found" | "unknown_role" | "not_signed_up" | "already_there" | "role_full" }
  | { ok: false; reason: "closed_event"; status: EventStatus };

/** Estados em que a lista ainda pode mudar pelo caller/owner (AC#4): antes do evento rodar. */
const EDITABLE_BY_STAFF: readonly EventStatus[] = ["open", "closed"];

/** Trava a linha do evento e devolve o que a inscrição precisa decidir: estado, nome e taxa de entrada. */
async function lockEvent(tx: Tx, eventId: string): Promise<{ status: EventStatus; name: string; entryFee: bigint } | null> {
  const [row] = await tx.select({ status: events.status, name: events.name, entryFee: events.entryFee }).from(events).where(eq(events.id, eventId)).for("update");
  return row ?? null;
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

/**
 * Próxima posição da espera daquela role: fim da fila de **quem está esperando agora** (TASK-066).
 * Olhar todas as linhas da vaga contava cancelados e confirmados (que têm `position 0`) e transformava
 * a posição num contador que nunca reaproveitava número — a fila ficava com buraco permanente.
 */
async function nextWaitlistPosition(tx: Tx, slotId: string): Promise<number> {
  const [row] = await tx
    .select({ top: max(eventSignups.position) })
    .from(eventSignups)
    .where(and(eq(eventSignups.slotId, slotId), eq(eventSignups.status, "waitlist")));
  return (row?.top ?? 0) + 1;
}

/**
 * Renumera a espera daquela role para 1..N (TASK-066). É o que fecha o buraco que sobra quando alguém
 * sai ou é promovido: a posição guardada é a posição real da fila, então a API, o embed e o painel
 * mostram o mesmo número sem camada de exibição por cima.
 *
 * A nova ordem é a ordem antiga (`position`, desempate por `created_at`), então renumerar **nunca**
 * embaralha quem já estava esperando: só tira os buracos. Só escreve nas linhas que mudaram de número,
 * para não carimbar `updated_at` em quem ficou no mesmo lugar.
 */
async function resequenceWaitlist(tx: Tx, slotId: string, at: Date): Promise<void> {
  await tx.execute(sql`
    update ${eventSignups} as s
    set position = r.rn, updated_at = ${at.toISOString()}::timestamptz
    from (
      select id, row_number() over (order by position, created_at, id) as rn
      from ${eventSignups}
      where slot_id = ${slotId} and status = 'waitlist'
    ) as r
    where s.id = r.id and s.position <> r.rn
  `);
}

/** Renumera as vagas mexidas pela operação (a de origem e a de destino são a mesma com frequência). */
async function resequenceSlots(tx: Tx, slotIds: readonly string[], at: Date): Promise<void> {
  for (const slotId of new Set(slotIds)) await resequenceWaitlist(tx, slotId, at);
}

/** Relê a inscrição depois da renumeração: o DTO devolvido tem que sair com a posição final. */
async function reload(tx: Tx, id: string): Promise<EventSignupDto> {
  const [row] = await tx.select().from(eventSignups).where(eq(eventSignups.id, id));
  return toDto(row!);
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
  /** Lançamento da taxa já paga. Trocar de role ou ser movido **carrega** a cobrança para a linha nova: a taxa é do evento, não da vaga. */
  feeEntryId?: string | null;
  /** Instante a partir do qual a presença conta (TASK-086, PE8); null é "desde o início da call". */
  presenceFrom?: Date | null;
  at: Date;
}

async function insertSignup(tx: Tx, { eventId, userId, slot, decidedBy, force, feeEntryId, presenceFrom, at }: InsertInput): Promise<EventSignupDto> {
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
      feeEntryId: feeEntryId ?? null,
      presenceFrom: presenceFrom ?? null,
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

/**
 * Ocupação de cada vaga dos eventos pedidos, contada pelo banco (TASK-023). O painel lista dezenas de
 * eventos e só precisa do número: baixar a lista de inscritos de cada um seria uma consulta por evento.
 */
export async function listEventsOccupancy(db: Database, eventIds: readonly string[]): Promise<EventOccupancyDto[]> {
  if (eventIds.length === 0) return [];
  return db
    .select({
      eventId: eventSignups.eventId,
      slotId: eventSignups.slotId,
      confirmed: count(sql`case when ${eventSignups.status} = 'confirmed' then 1 end`),
      waitlist: count(sql`case when ${eventSignups.status} = 'waitlist' then 1 end`),
    })
    .from(eventSignups)
    .where(inArray(eventSignups.eventId, [...eventIds]))
    .groupBy(eventSignups.eventId, eventSignups.slotId);
}

/** Inscrições ativas de uma pessoa nos eventos pedidos: é o "minha inscrição" destacado no painel (AC#1). */
export async function listUserEventSignups(db: Database, userId: string, eventIds: readonly string[]): Promise<EventSignupDto[]> {
  if (eventIds.length === 0) return [];
  const rows = await db
    .select()
    .from(eventSignups)
    .where(and(eq(eventSignups.userId, userId), inArray(eventSignups.eventId, [...eventIds]), inArray(eventSignups.status, [...ACTIVE_EVENT_SIGNUP_STATUSES])));
  return rows.map(toDto);
}

/** Nome de exibição dos usuários pedidos, para o painel mostrar gente e não uuid. */
export async function listMemberNicks(db: Database, userIds: readonly string[]): Promise<EventMemberDto[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const rows = await db.select({ userId: users.id, nick: memberNick(users) }).from(users).where(inArray(users.id, unique));
  return rows.map((r) => ({ userId: r.userId, nick: r.nick ?? "Membro" }));
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
    const event = await lockEvent(tx, input.eventId);
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (event.status !== "open") return { ok: false as const, reason: "not_open" as const, status: event.status };
    const slot = await findSlot(tx, input.eventId, input.slotId);
    if (!slot) return { ok: false as const, reason: "unknown_role" as const };
    const current = await findActiveSignup(tx, input.eventId, input.userId);
    if (current?.slotId === slot.id) return { ok: false as const, reason: "already_in_role" as const };
    // Taxa de entrada (TASK-058, F6-13): cobrada aqui, **dentro da mesma transação que dá a vaga**, e
    // só em inscrição nova — trocar de role carrega a cobrança que já foi paga. Saldo insuficiente
    // recusa a inscrição inteira em vez de dar a vaga fiado (F6-7).
    let feeEntryId = current?.feeEntryId ?? null;
    let charged: bigint | null = null;
    if (!current && event.entryFee > NO_ENTRY_FEE) {
      const paid = await spendCurrencyTx(tx, {
        userId: input.userId,
        currency: "buffunfa",
        amount: event.entryFee,
        kind: "entry_fee",
        reference: { type: "event", id: input.eventId },
        memo: `Taxa de entrada: ${event.name}`,
      });
      if (!paid.ok) return { ok: false as const, reason: "insufficient_funds" as const, fee: event.entryFee, balance: paid.reason === "insufficient_funds" ? paid.balance : 0n };
      feeEntryId = paid.entry.id;
      charged = event.entryFee;
    }
    if (current) await cancel(tx, current.id, null, at);
    const signup = await insertSignup(tx, { eventId: input.eventId, userId: input.userId, slot, decidedBy: null, feeEntryId, at });
    const promoted = current?.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at, signup.id) : null;
    await resequenceSlots(tx, [slot.id, ...(current ? [current.slotId] : [])], at);
    return { ok: true as const, signup: await reload(tx, signup.id), promoted, charged };
  });
}

/** Sai do evento. Vaga confirmada liberada promove o primeiro da espera da role (AC#3). */
export async function leaveEvent(db: Database, input: { eventId: string; userId: string; at?: Date }): Promise<LeaveEventResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const event = await lockEvent(tx, input.eventId);
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (event.status !== "open") return { ok: false as const, reason: "not_open" as const, status: event.status };
    const current = await findActiveSignup(tx, input.eventId, input.userId);
    if (!current) return { ok: false as const, reason: "not_signed_up" as const };
    await cancel(tx, current.id, null, at);
    // Desistir **antes do início** devolve (F6-13). Sair só é possível com o evento `open`, então
    // chegar aqui já é "antes do início": depois disso a inscrição não sai mais, e a taxa fica.
    // A devolução é **estorno**, nunca um UPDATE no lançamento original.
    const refunded = await refundEntryFee(tx, current.feeEntryId, ENTRY_FEE_REFUND_REASONS.left);
    const [cancelled] = await tx.select().from(eventSignups).where(eq(eventSignups.id, current.id));
    const promoted = current.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at) : null;
    await resequenceWaitlist(tx, current.slotId, at);
    return { ok: true as const, signup: toDto(cancelled!), promoted, refunded };
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
    const event = await lockEvent(tx, input.eventId);
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (!EDITABLE_BY_STAFF.includes(event.status)) return { ok: false as const, reason: "closed_event" as const, status: event.status };
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
      // O caller mover alguém não recobra nem devolve: a pessoa continua inscrita no mesmo evento.
      feeEntryId: current.feeEntryId,
      at,
    });
    // Exclui quem acabou de ser mandado para a espera: senão ele voltaria sozinho para a vaga que liberou.
    const promoted = current.status === "confirmed" ? await promoteFirstWaiting(tx, current.slotId, at, signup.id) : null;
    await resequenceSlots(tx, [slot.id, current.slotId], at);
    return { ok: true as const, signup: await reload(tx, signup.id), promoted };
  });
}

/* ------------------------------------------- inscrição no meio da call (TASK-086) */

/** Vaga com quantas cadeiras ainda estão livres agora. Só as livres interessam à pergunta (PE7). */
export interface EventFreeRoleSlot {
  id: string;
  name: string;
  free: number;
}

/**
 * Roles do evento com vaga livre, na ordem em que o caller montou o evento. Serve a pergunta do bot
 * para quem entrou no meio: sem nenhuma aqui, a resposta diz que não há vaga em vez de falhar calada.
 */
export async function listEventFreeRoleSlots(db: Database, eventId: string): Promise<EventFreeRoleSlot[]> {
  const rows = await db
    .select({
      id: eventRoleSlots.id,
      name: eventRoleSlots.name,
      slots: eventRoleSlots.slots,
      taken: sql<number>`count(${eventSignups.id}) filter (where ${eventSignups.status} = 'confirmed')`,
    })
    .from(eventRoleSlots)
    .leftJoin(eventSignups, eq(eventSignups.slotId, eventRoleSlots.id))
    .where(eq(eventRoleSlots.eventId, eventId))
    .groupBy(eventRoleSlots.id, eventRoleSlots.name, eventRoleSlots.slots, eventRoleSlots.sortOrder)
    .orderBy(asc(eventRoleSlots.sortOrder));
  return rows.map((r) => ({ id: r.id, name: r.name, free: r.slots - Number(r.taken) })).filter((r) => r.free > 0);
}

export type AddLateEventSignupResult =
  | ({ ok: true; charged: bigint | null; presenceFrom: Date } & EventSignupChange)
  | { ok: false; reason: "not_found" | "unknown_role" | "already_signed_up" | "role_full" }
  | { ok: false; reason: "not_running"; status: EventStatus }
  | { ok: false; reason: "insufficient_funds"; fee: bigint; balance: bigint };

/**
 * Inscreve alguém **com o evento já rodando** (TASK-086, PE7/PE8): é o que o caller aceita quando o
 * bot pergunta sobre quem entrou na call sem estar inscrito.
 *
 * Três diferenças para o `joinEventRole`, e cada uma tem motivo:
 * - só com o evento `running` — antes disso a pessoa usa o botão do embed, depois disso não existe
 *   mais o que presenciar;
 * - **não** vai para a espera: role lotada é recusada com `role_full`, porque a pessoa já está dentro
 *   da call e "fica esperando" não quer dizer nada aqui;
 * - grava `presence_from` no instante do aceite, e é só isso que faz a PE8 valer — a medição de
 *   presença continua sendo a mesma, com a janela dessa pessoa começando mais tarde.
 *
 * A taxa de entrada é cobrada igual à inscrição normal (F6-13): entrar atrasado não é entrar de graça.
 */
export async function addLateEventSignup(
  db: Database,
  input: { eventId: string; userId: string; slotId: string; actorUserId: string; at?: Date },
): Promise<AddLateEventSignupResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const event = await lockEvent(tx, input.eventId);
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (event.status !== "running") return { ok: false as const, reason: "not_running" as const, status: event.status };
    const slot = await findSlot(tx, input.eventId, input.slotId);
    if (!slot) return { ok: false as const, reason: "unknown_role" as const };
    if (await findActiveSignup(tx, input.eventId, input.userId)) return { ok: false as const, reason: "already_signed_up" as const };
    if ((await confirmedCount(tx, slot.id)) >= slot.slots) return { ok: false as const, reason: "role_full" as const };

    let feeEntryId: string | null = null;
    let charged: bigint | null = null;
    if (event.entryFee > NO_ENTRY_FEE) {
      const paid = await spendCurrencyTx(tx, {
        userId: input.userId,
        currency: "buffunfa",
        amount: event.entryFee,
        kind: "entry_fee",
        reference: { type: "event", id: input.eventId },
        // Diferente do `joinEventRole`, quem paga não é quem mandou cobrar: o extrato do jogador
        // precisa dizer sozinho quem aceitou a inscrição dele no meio da call.
        createdBy: input.actorUserId,
        memo: `Taxa de entrada: ${event.name}`,
      });
      if (!paid.ok) return { ok: false as const, reason: "insufficient_funds" as const, fee: event.entryFee, balance: paid.reason === "insufficient_funds" ? paid.balance : 0n };
      feeEntryId = paid.entry.id;
      charged = event.entryFee;
    }
    const signup = await insertSignup(tx, {
      eventId: input.eventId,
      userId: input.userId,
      slot,
      decidedBy: input.actorUserId,
      force: "confirmed",
      feeEntryId,
      presenceFrom: at,
      at,
    });
    return { ok: true as const, signup: await reload(tx, signup.id), promoted: null, charged, presenceFrom: at };
  });
}
