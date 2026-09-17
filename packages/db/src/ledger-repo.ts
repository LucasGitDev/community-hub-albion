import type { LedgerEntryKind, LedgerReferenceType } from "@albion-hub/shared";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { EventTx } from "./events-repo.js";
import { memberNick } from "./member-nick.js";
import { ledgerEntries, users } from "./schema.js";

/** Handle de escrita: a conexão do pool ou a transação de quem chama (split, saque). */
type LedgerWriter = Database | EventTx;

/**
 * Ledger de prata (TASK-026). Regras que este módulo faz valer, junto com o banco:
 * - append-only: nada aqui faz UPDATE ou DELETE em `ledger_entries` (triggers rejeitam de qualquer jeito);
 * - prata é `bigint` inteiro (Q20): nenhum valor passa por `number`, nem o saldo;
 * - correção é estorno, no máximo um por lançamento (índice único parcial).
 */

const UNIQUE_VIOLATION = "23505";

function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  /** Prata inteira: positivo credita, negativo debita. */
  amount: bigint;
  kind: LedgerEntryKind;
  referenceType: LedgerReferenceType | null;
  referenceId: string | null;
  reversalOf: string | null;
  createdBy: string | null;
  memo: string | null;
  createdAt: Date;
}

const columns = {
  id: ledgerEntries.id,
  userId: ledgerEntries.userId,
  amount: ledgerEntries.amount,
  kind: ledgerEntries.kind,
  referenceType: ledgerEntries.referenceType,
  referenceId: ledgerEntries.referenceId,
  reversalOf: ledgerEntries.reversalOf,
  createdBy: ledgerEntries.createdBy,
  memo: ledgerEntries.memo,
  createdAt: ledgerEntries.createdAt,
};

export interface LedgerEntryInput {
  userId: string;
  /** Prata inteira, diferente de zero. */
  amount: bigint;
  /** `reversal` não entra aqui: estorno só nasce de `reverseLedgerEntry`. */
  kind: Exclude<LedgerEntryKind, "reversal">;
  reference?: { type: LedgerReferenceType; id: string } | null;
  createdBy?: string | null;
  memo?: string | null;
}

/** Grava um lançamento. `tx` permite lançar dentro da transação de quem chama (split, saque). */
export async function insertLedgerEntry(db: LedgerWriter, input: LedgerEntryInput): Promise<LedgerEntry> {
  const [row] = await db
    .insert(ledgerEntries)
    .values({
      userId: input.userId,
      amount: input.amount,
      kind: input.kind,
      referenceType: input.reference?.type ?? null,
      referenceId: input.reference?.id ?? null,
      createdBy: input.createdBy ?? null,
      memo: input.memo ?? null,
    })
    .returning(columns);
  return row!;
}

export type ReverseLedgerEntryResult = { ok: true; entry: LedgerEntry; original: LedgerEntry } | { ok: false; reason: "not_found" | "already_reversed" | "is_reversal" };

export interface ReverseLedgerEntryOptions {
  /** Motivo obrigatório: o estorno é a única correção possível, então ele precisa explicar. */
  reason: string;
  /** Quem estornou; null quando foi um job. */
  actorUserId?: string | null;
}

/**
 * Estorna um lançamento criando o inverso (`kind: reversal`, `reversal_of` = original). Nunca toca no
 * original (AC#2). Aceita uma transação: estornar um loot split inteiro (TASK-028) é tudo ou nada. O índice único parcial em `reversal_of` é quem resolve a corrida: dois estornos
 * simultâneos viram um `already_reversed`, mesmo em transações concorrentes.
 *
 * Estorno de estorno é recusado (`is_reversal`): re-creditar é um lançamento novo, não uma correção.
 */
export async function reverseLedgerEntry(db: LedgerWriter, entryId: string, options: ReverseLedgerEntryOptions): Promise<ReverseLedgerEntryResult> {
  const [original] = await db.select(columns).from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
  if (!original) return { ok: false, reason: "not_found" };
  if (original.kind === "reversal") return { ok: false, reason: "is_reversal" };
  try {
    const [row] = await db
      .insert(ledgerEntries)
      .values({
        userId: original.userId,
        amount: -original.amount,
        kind: "reversal",
        referenceType: original.referenceType,
        referenceId: original.referenceId,
        reversalOf: original.id,
        createdBy: options.actorUserId ?? null,
        memo: options.reason,
      })
      .returning(columns);
    return { ok: true, entry: row!, original };
  } catch (error) {
    if (pgCode(error) === UNIQUE_VIOLATION) return { ok: false, reason: "already_reversed" };
    throw error;
  }
}

/**
 * Saldo do usuário: soma feita **no banco** e devolvida como `bigint` (o driver lê int8 como BigInt),
 * nunca como number — acima de 2^53 o JS perderia prata (AC#3). Pode ser negativo (Q24).
 */
export async function getLedgerBalance(db: Database, userId: string): Promise<bigint> {
  const rows = await db.execute<{ balance: bigint }>(sql`select coalesce(sum(${ledgerEntries.amount}), 0)::int8 as balance from ${ledgerEntries} where ${ledgerEntries.userId} = ${userId}`);
  return rows[0]?.balance ?? 0n;
}

export interface LedgerPageQuery {
  /** Máximo de lançamentos (1..200, default 50). */
  limit?: number;
  /** Continua o extrato depois deste lançamento (mais novo → mais antigo). */
  cursor?: { createdAt: Date; id: string } | null;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  /** Cursor da próxima página; null quando acabou. */
  nextCursor: { createdAt: Date; id: string } | null;
}

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

/** Extrato do usuário, do mais novo para o mais antigo, paginado por keyset (`created_at`, `id`). */
export async function listLedgerEntries(db: Database, userId: string, query: LedgerPageQuery = {}): Promise<LedgerPage> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor;
  const before = cursor
    ? or(lt(ledgerEntries.createdAt, cursor.createdAt), and(eq(ledgerEntries.createdAt, cursor.createdAt), lt(ledgerEntries.id, cursor.id)))
    : undefined;
  const rows = await db
    .select(columns)
    .from(ledgerEntries)
    .where(before ? and(eq(ledgerEntries.userId, userId), before) : eq(ledgerEntries.userId, userId))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit);
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

/** Lançamentos de uma origem (evento, split, saque), do mais antigo para o mais novo. */
export async function listLedgerEntriesByReference(db: LedgerWriter, type: LedgerReferenceType, id: string): Promise<LedgerEntry[]> {
  return db
    .select(columns)
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.referenceType, type), eq(ledgerEntries.referenceId, id)))
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));
}

/** Um lançamento com o nome de quem lançou já resolvido. `author` é null quando ninguém assinou (job, manutenção). */
export interface LedgerEntryWithAuthor extends LedgerEntry {
  author: { id: string; name: string } | null;
}

export interface LedgerPageWithAuthor {
  entries: LedgerEntryWithAuthor[];
  nextCursor: { createdAt: Date; id: string } | null;
}

/**
 * Mesmo extrato de `listLedgerEntries`, com o autor do lançamento resolvido num `left join` (TASK-051).
 *
 * Existe separado porque só a leitura da staff precisa do autor: o extrato do próprio membro (TASK-031)
 * responde "cadê minha prata", e a staff responde "quem mexeu nisso". Mesmo keyset, mesmos limites — a
 * paginação é a daqui, não uma segunda versão dela.
 *
 * `created_by` é nulo de propósito em lançamento sem gente por trás (ajuste do namespace de manutenção,
 * TASK-048): a tela distingue isso pela origem `manual/maintenance`, não inventando um nome aqui.
 */
export async function listLedgerEntriesWithAuthor(db: Database, userId: string, query: LedgerPageQuery = {}): Promise<LedgerPageWithAuthor> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor;
  const before = cursor
    ? or(lt(ledgerEntries.createdAt, cursor.createdAt), and(eq(ledgerEntries.createdAt, cursor.createdAt), lt(ledgerEntries.id, cursor.id)))
    : undefined;
  const rows = await db
    .select({ ...columns, authorId: users.id, authorName: memberNick(users) })
    .from(ledgerEntries)
    .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
    .where(before ? and(eq(ledgerEntries.userId, userId), before) : eq(ledgerEntries.userId, userId))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit).map(({ authorId, authorName, ...entry }) => ({
    ...entry,
    author: authorId ? { id: authorId, name: authorName ?? "sem nome" } : null,
  }));
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}
