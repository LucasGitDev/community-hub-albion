import {
  canTransitionWithdrawal,
  checkWithdrawalRequest,
  RESERVING_WITHDRAWAL_STATUSES,
  type WithdrawalDto,
  type WithdrawalListQuery,
  type WithdrawalRefusal,
  type WithdrawalStatus,
} from "@albion-hub/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { memberNick } from "./member-nick.js";
import { ledgerEntries, users, withdrawals } from "./schema.js";

/**
 * Saque de prata (TASK-030). Tudo que escreve roda numa transação que começa travando a **linha do
 * usuário** (`select ... for update`), igual às transições de evento (TASK-021) e às inscrições (TASK-022).
 *
 * Por que travar o usuário e não o saque: a regra que precisa ser serializada é sobre o **saldo do
 * membro**, não sobre um pedido. Dois pedidos simultâneos travam a mesma linha de `users`, então o
 * segundo só roda depois que o primeiro já está gravado — e aí relê o saldo e a reserva já com o
 * primeiro dentro da conta (AC#5). Travar o pedido não resolveria: os dois pedidos são linhas diferentes.
 *
 * As decisões da staff (aprovar/recusar/liquidar) travam a mesma linha de usuário **antes** de travar o
 * saque, sempre nessa ordem, para nunca haver deadlock entre um pedido novo e uma aprovação.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Prende a linha do usuário até o fim da transação. `false` = usuário não existe. */
async function lockUser(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  return !!row;
}

export interface WithdrawalBalance {
  /** Soma do ledger; pode ser negativa (Q24). */
  balance: bigint;
  /** Prata presa em saques que ainda não viraram lançamento (`pending`, AC#2). */
  reserved: bigint;
  /** `balance - reserved`: teto de um pedido novo. */
  available: bigint;
}

/**
 * **A conta única de saldo disponível do sistema** (AC#2). Todo mundo — API, painel, bot, e o próprio
 * `requestWithdrawal` dentro da transação — passa por aqui, então não existe uma segunda versão da
 * verdade sobre quanta prata o membro pode pedir.
 *
 * Os dois `sum` são feitos no banco e voltam como `bigint` (o driver lê int8 como BigInt): acima de 2^53
 * o JS perderia prata (Q20).
 *
 * `pending` reserva **sem** lançar nada no ledger; a partir de `approved` o débito já está no ledger e é o
 * próprio `balance` que desconta — por isso `approved` não entra na reserva (ver RESERVING_WITHDRAWAL_STATUSES).
 */
export async function getWithdrawalBalance(db: Database | Tx, userId: string): Promise<WithdrawalBalance> {
  const reserving = sql.join(
    RESERVING_WITHDRAWAL_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const [row] = await db.execute<{ balance: bigint; reserved: bigint }>(sql`
    select
      (select coalesce(sum(${ledgerEntries.amount}), 0)::int8 from ${ledgerEntries} where ${ledgerEntries.userId} = ${userId}) as balance,
      (select coalesce(sum(${withdrawals.amount}), 0)::int8 from ${withdrawals}
        where ${withdrawals.userId} = ${userId} and ${withdrawals.status} in (${reserving})) as reserved
  `);
  const balance = row?.balance ?? 0n;
  const reserved = row?.reserved ?? 0n;
  return { balance, reserved, available: balance - reserved };
}

/**
 * Mesma conta de `getWithdrawalBalance`, para vários membros de uma vez (TASK-032): a fila da staff
 * mostra o saldo de quem pediu ao lado de cada pedido, e uma query por linha não serve.
 *
 * Duas somas agrupadas por usuário — o ledger de um lado, as reservas do outro — juntadas em memória.
 * Os totais voltam como `bigint` (Q20). Quem não tem lançamento nem reserva sai daqui com zero, para o
 * chamador não precisar distinguir "sem saldo" de "não perguntei".
 */
export async function getWithdrawalBalances(db: Database | Tx, userIds: readonly string[]): Promise<Map<string, WithdrawalBalance>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, WithdrawalBalance>(ids.map((id) => [id, { balance: 0n, reserved: 0n, available: 0n }]));
  if (ids.length === 0) return out;

  const ledgerRows = await db
    .select({ userId: ledgerEntries.userId, total: sql<bigint>`coalesce(sum(${ledgerEntries.amount}), 0)::int8` })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.userId, ids))
    .groupBy(ledgerEntries.userId);
  const reservedRows = await db
    .select({ userId: withdrawals.userId, total: sql<bigint>`coalesce(sum(${withdrawals.amount}), 0)::int8` })
    .from(withdrawals)
    .where(and(inArray(withdrawals.userId, ids), inArray(withdrawals.status, [...RESERVING_WITHDRAWAL_STATUSES])))
    .groupBy(withdrawals.userId);

  for (const row of ledgerRows) out.get(row.userId)!.balance = BigInt(row.total);
  for (const row of reservedRows) out.get(row.userId)!.reserved = BigInt(row.total);
  for (const balance of out.values()) balance.available = balance.balance - balance.reserved;
  return out;
}

const columns = {
  id: withdrawals.id,
  userId: withdrawals.userId,
  amount: withdrawals.amount,
  status: withdrawals.status,
  ledgerEntryId: withdrawals.ledgerEntryId,
  decidedBy: withdrawals.decidedBy,
  decidedAt: withdrawals.decidedAt,
  decisionNote: withdrawals.decisionNote,
  settledBy: withdrawals.settledBy,
  settledAt: withdrawals.settledAt,
  settlementNote: withdrawals.settlementNote,
  createdAt: withdrawals.createdAt,
  updatedAt: withdrawals.updatedAt,
};

type Row = { [K in keyof typeof columns]: (typeof withdrawals.$inferSelect)[K] };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toDto = (row: Row, userNick: string | null = null): WithdrawalDto => ({
  id: row.id,
  userId: row.userId,
  userNick,
  // Prata como string: JSON não tem inteiro grande o bastante (Q20).
  amount: row.amount.toString(),
  status: row.status,
  ledgerEntryId: row.ledgerEntryId,
  decidedByUserId: row.decidedBy,
  decidedAt: iso(row.decidedAt),
  decisionNote: row.decisionNote,
  settledByUserId: row.settledBy,
  settledAt: iso(row.settledAt),
  settlementNote: row.settlementNote,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export interface RequestWithdrawalInput {
  userId: string;
  /** Prata inteira positiva (Q20). */
  amount: bigint;
}

export type RequestWithdrawalResult =
  | { ok: true; withdrawal: WithdrawalDto; balance: WithdrawalBalance }
  | { ok: false; reason: "unknown_user" }
  | ({ ok: false } & WithdrawalRefusal);

/**
 * Cria o pedido `pending`, que **reserva** o saldo sem lançar nada no ledger (AC#2, Q25).
 *
 * O saldo é relido **dentro** da transação, depois do `for update` (AC#5): é isso que faz dois pedidos
 * simultâneos de 600k com 1M de saldo terminarem em um aprovado e um recusado, e nunca nos dois passando.
 *
 * Recusa só por valor não positivo, saldo negativo (Q24) ou valor acima do disponível (AC#1): **não existe
 * valor mínimo nem taxa** (Q12, revisado em 2026-09-16).
 */
export async function requestWithdrawal(db: Database, input: RequestWithdrawalInput): Promise<RequestWithdrawalResult> {
  return db.transaction(async (tx) => {
    if (!(await lockUser(tx, input.userId))) return { ok: false as const, reason: "unknown_user" as const };
    const balance = await getWithdrawalBalance(tx, input.userId);
    const refusal = checkWithdrawalRequest(input.amount, balance.balance, balance.reserved);
    if (refusal) return { ok: false as const, ...refusal };
    const [row] = await tx.insert(withdrawals).values({ userId: input.userId, amount: input.amount, status: "pending" }).returning(columns);
    const after = await getWithdrawalBalance(tx, input.userId);
    return { ok: true as const, withdrawal: toDto(row!), balance: after };
  });
}

export interface DecideWithdrawalOptions {
  /** Staff que decidiu (AC#3, AC#4). Nunca null: toda decisão tem dono. */
  actorUserId: string;
  /** Obrigatória na recusa e na liquidação; opcional na aprovação. */
  note?: string | null;
  at?: Date;
}

export type WithdrawalDecisionResult =
  | { ok: true; withdrawal: WithdrawalDto }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "note_required" }
  | { ok: false; reason: "invalid"; from: WithdrawalStatus };

/** Trava usuário → saque (sempre nessa ordem) e devolve a linha atual do saque. */
async function lockWithdrawal(tx: Tx, id: string): Promise<Row | null> {
  const [owner] = await tx.select({ userId: withdrawals.userId }).from(withdrawals).where(eq(withdrawals.id, id));
  if (!owner) return null;
  await lockUser(tx, owner.userId);
  const [row] = await tx.select(columns).from(withdrawals).where(eq(withdrawals.id, id)).for("update");
  return row ?? null;
}

const trimmed = (note: string | null | undefined) => (typeof note === "string" && note.trim() ? note.trim() : null);

/**
 * Aprova: lança o débito no ledger e amarra o lançamento ao saque, **na mesma transação** (AC#3, Q25).
 * Ou os dois acontecem ou nenhum: nunca existe saque aprovado sem lançamento, nem lançamento órfão.
 *
 * Não reconfere o saldo aqui de propósito: a prata já estava reservada desde o `pending`, e um estorno no
 * meio do caminho pode ter deixado o saldo negativo — o que é permitido (Q24) e só bloqueia pedido **novo**.
 */
export async function approveWithdrawal(db: Database, id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
  const at = options.at ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockWithdrawal(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionWithdrawal(current.status, "approved")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const note = trimmed(options.note);
    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        userId: current.userId,
        amount: -current.amount,
        kind: "withdrawal",
        referenceType: "withdrawal",
        referenceId: current.id,
        createdBy: options.actorUserId,
        memo: note ?? "Saque aprovado",
      })
      .returning({ id: ledgerEntries.id });
    const [row] = await tx
      .update(withdrawals)
      .set({ status: "approved", ledgerEntryId: entry!.id, decidedBy: options.actorUserId, decidedAt: at, decisionNote: note, updatedAt: at })
      .where(eq(withdrawals.id, id))
      .returning(columns);
    return { ok: true as const, withdrawal: toDto(row!) };
  });
}

/**
 * Recusa: libera a reserva **sem lançamento nenhum** (AC#3, Q25) — a prata nunca saiu do ledger, então não
 * há o que estornar. Motivo é obrigatório: é a única explicação que o membro recebe.
 */
export async function rejectWithdrawal(db: Database, id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
  const at = options.at ?? new Date();
  const note = trimmed(options.note);
  if (!note) return { ok: false, reason: "note_required" };
  return db.transaction(async (tx) => {
    const current = await lockWithdrawal(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionWithdrawal(current.status, "rejected")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const [row] = await tx
      .update(withdrawals)
      .set({ status: "rejected", decidedBy: options.actorUserId, decidedAt: at, decisionNote: note, updatedAt: at })
      .where(eq(withdrawals.id, id))
      .returning(columns);
    return { ok: true as const, withdrawal: toDto(row!) };
  });
}

/**
 * Liquida: passo **manual** que registra que a staff transferiu a prata in-game (Q10). Exige `settled_by`
 * e nota (AC#4, Q11) — o banco recusa a linha sem os dois, então nem um bug futuro grava um `settled` mudo.
 * Não mexe no ledger: o débito já foi lançado na aprovação.
 */
export async function settleWithdrawal(db: Database, id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
  const at = options.at ?? new Date();
  const note = trimmed(options.note);
  if (!note) return { ok: false, reason: "note_required" };
  return db.transaction(async (tx) => {
    const current = await lockWithdrawal(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionWithdrawal(current.status, "settled")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const [row] = await tx
      .update(withdrawals)
      .set({ status: "settled", settledBy: options.actorUserId, settledAt: at, settlementNote: note, updatedAt: at })
      .where(eq(withdrawals.id, id))
      .returning(columns);
    return { ok: true as const, withdrawal: toDto(row!) };
  });
}

/** Um saque pelo id, com o nick do dono. Quem pode ver é decisão do controller (CASL), não daqui. */
export async function getWithdrawal(db: Database, id: string): Promise<WithdrawalDto | null> {
  const [row] = await db
    .select({ ...columns, nick: memberNick(users) })
    .from(withdrawals)
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(eq(withdrawals.id, id));
  return row ? toDto(row, row.nick) : null;
}

/**
 * Lista saques do mais novo para o mais antigo. `filters.userId` é o que a visão do membro usa — e o
 * controller **sempre** o preenche com o id da sessão, nunca com algo vindo do cliente.
 */
export async function listWithdrawals(db: Database, filters: WithdrawalListQuery = {}): Promise<WithdrawalDto[]> {
  const where = [...(filters.userId ? [eq(withdrawals.userId, filters.userId)] : []), ...(filters.status ? [inArray(withdrawals.status, filters.status)] : [])];
  const rows = await db
    .select({ ...columns, nick: memberNick(users) })
    .from(withdrawals)
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id));
  return rows.map((r) => toDto(r, r.nick));
}
