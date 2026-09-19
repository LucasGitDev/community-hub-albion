import { CURRENCIES, type Currency, type LedgerEntryKind, type LedgerReferenceType } from "@albion-hub/shared";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client.js";
import type { EventTx } from "./events-repo.js";
import { memberNick } from "./member-nick.js";
import { ledgerEntries, users } from "./schema.js";

/** Handle de escrita: a conexão do pool ou a transação de quem chama (split, saque). */
type LedgerWriter = Database | EventTx;

/**
 * Ledger de prata (TASK-026). Regras que este módulo faz valer, junto com o banco:
 * - append-only: nada aqui faz UPDATE ou DELETE em `ledger_entries` (triggers rejeitam de qualquer jeito);
 * - valor é `bigint` inteiro (Q20): nenhum valor passa por `number`, nem o saldo;
 * - correção é estorno, no máximo um por lançamento (índice único parcial).
 *
 * Desde a TASK-056 a tabela guarda **duas moedas** (F6-1). O risco assumido lá é query que esqueça o
 * filtro e some prata com Buffunfa, e é por isso que **saldo e extrato exigem a moeda na assinatura**:
 * não existe leitura aqui que devolva um número sem alguém ter dito de que moeda ele é.
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
  /** Valor inteiro: positivo credita, negativo debita. */
  amount: bigint;
  /** Moeda do lançamento (F6-1). Saldo e extrato nunca cruzam moedas diferentes. */
  currency: Currency;
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
  currency: ledgerEntries.currency,
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
  /** Valor inteiro, diferente de zero. */
  amount: bigint;
  /** Moeda: obrigatória, sem default. Lançamento sem moeda declarada não existe (F6-2). */
  currency: Currency;
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
      currency: input.currency,
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
        // Estorno herda a moeda do original: corrigir prata com Buffunfa não seria correção.
        currency: original.currency,
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
 * Saldo do usuário **numa moeda**: soma feita no banco e devolvida como `bigint` (o driver lê int8 como
 * BigInt), nunca como number — acima de 2^53 o JS perderia prata (AC#3). Pode ser negativo (Q24).
 *
 * A moeda é parâmetro obrigatório de propósito (F6-1): não existe assinatura aqui que devolva "o saldo"
 * sem dizer de quê, então nenhuma chamada consegue somar prata com Buffunfa por esquecimento.
 */
export async function getLedgerBalance(db: Database | EventTx, userId: string, currency: Currency): Promise<bigint> {
  const rows = await db.execute<{ balance: bigint }>(
    sql`select coalesce(sum(${ledgerEntries.amount}), 0)::int8 as balance from ${ledgerEntries} where ${ledgerEntries.userId} = ${userId} and ${ledgerEntries.currency} = ${currency}`,
  );
  return rows[0]?.balance ?? 0n;
}

/** Um saldo por moeda, **nunca somados** (F6-27): o cabeçalho do extrato e o chip do header mostram os dois lado a lado. */
export type LedgerBalances = Record<Currency, bigint>;

/**
 * Os saldos de todas as moedas numa consulta só, agrupados pelo banco. Existe para a tela que mostra as
 * duas moedas juntas não fazer uma ida por moeda — e devolve um número por moeda, nunca um total.
 */
export async function getLedgerBalancesByCurrency(db: Database | EventTx, userId: string): Promise<LedgerBalances> {
  const out = Object.fromEntries(CURRENCIES.map((c) => [c, 0n])) as LedgerBalances;
  const rows = await db
    .select({ currency: ledgerEntries.currency, total: sql<bigint>`coalesce(sum(${ledgerEntries.amount}), 0)::int8` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .groupBy(ledgerEntries.currency);
  for (const row of rows) out[row.currency] = BigInt(row.total);
  return out;
}

/**
 * Filtro de moeda do extrato: uma moeda, ou `"all"` para a lista cronológica com as duas (F6-27). É a
 * **única** leitura que aceita mais de uma moeda, e mesmo assim exige a escolha explícita — cada linha
 * carrega a sua moeda, então nada aqui vira um total misturado.
 */
export type CurrencyFilter = Currency | "all";

const currencyWhere = (filter: CurrencyFilter) => (filter === "all" ? inArray(ledgerEntries.currency, [...CURRENCIES]) : eq(ledgerEntries.currency, filter));

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

/**
 * Keyset "antes do cursor" comparando com o timestamp **da própria linha do cursor**, lido no banco (TASK-082).
 *
 * O cursor carrega `createdAt` como `Date`, e o `Date` do JavaScript só guarda milissegundo, enquanto o
 * Postgres grava microssegundo. Comparar com o valor truncado deixava de fora toda linha entre o truncado e o
 * real — no teste, 3 de 5 lançamentos sumiam, e é exatamente o caso do crédito e do saque pago no jogo, que
 * nascem na mesma transação com timestamp idêntico (TASK-081). A subconsulta pega o par exato, e a comparação
 * de tupla segue a mesma ordem do `orderBy` (`created_at desc, id desc`).
 */
function beforeCursor(cursorId: string): SQL {
  return sql`(${ledgerEntries.createdAt}, ${ledgerEntries.id}) < (select ${ledgerEntries.createdAt}, ${ledgerEntries.id} from ${ledgerEntries} where ${ledgerEntries.id} = ${cursorId})`;
}

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

/** Extrato do usuário numa moeda (ou `"all"`), do mais novo para o mais antigo, paginado por keyset (`created_at`, `id`). */
export async function listLedgerEntries(db: Database, userId: string, currency: CurrencyFilter, query: LedgerPageQuery = {}): Promise<LedgerPage> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor;
  const before = cursor
    ? beforeCursor(cursor.id)
    : undefined;
  const rows = await db
    .select(columns)
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), currencyWhere(currency), before))
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
export async function listLedgerEntriesWithAuthor(db: Database, userId: string, currency: CurrencyFilter, query: LedgerPageQuery = {}): Promise<LedgerPageWithAuthor> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor;
  const before = cursor
    ? beforeCursor(cursor.id)
    : undefined;
  const rows = await db
    .select({ ...columns, authorId: users.id, authorName: memberNick(users) })
    .from(ledgerEntries)
    .leftJoin(users, eq(users.id, ledgerEntries.createdBy))
    .where(and(eq(ledgerEntries.userId, userId), currencyWhere(currency), before))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit).map(({ authorId, authorName, ...entry }) => ({
    ...entry,
    author: authorId ? { id: authorId, name: authorName ?? "sem nome" } : null,
  }));
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

export interface SpendInput {
  userId: string;
  /** Moeda gasta. Prata continua passando pela fila de saque; esta porta é a do gasto direto (loja, taxa). */
  currency: Currency;
  /** Valor **positivo** do gasto. O débito no ledger é o negativo dele. */
  amount: bigint;
  kind: Exclude<LedgerEntryKind, "reversal">;
  reference?: { type: LedgerReferenceType; id: string } | null;
  createdBy?: string | null;
  memo?: string | null;
}

export type SpendResult =
  | { ok: true; entry: LedgerEntry; balance: bigint }
  | { ok: false; reason: "unknown_user" }
  | { ok: false; reason: "invalid_amount" }
  /** Saldo insuficiente: `balance` é o que havia **dentro** da transação, para a mensagem dizer o número certo. */
  | { ok: false; reason: "insufficient_funds"; balance: bigint };

/**
 * O núcleo do gasto, **dentro de uma transação de quem chama**. Existe separado de `spendCurrency`
 * porque a taxa de entrada (TASK-058) precisa cobrar e dar a vaga na **mesma** transação da inscrição:
 * abrir uma transação nova aqui deixaria a janela em que o débito passou e a vaga não.
 *
 * Ordem de travas em todo caminho que usa isto: **evento primeiro, usuário depois**. É a mesma em
 * `joinEventRole`, então dois inscritos concorrentes nunca travam em ordens opostas.
 */
export async function spendCurrencyTx(tx: EventTx, input: SpendInput): Promise<SpendResult> {
  if (input.amount <= 0n) return { ok: false, reason: "invalid_amount" };
  const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
  if (!owner) return { ok: false as const, reason: "unknown_user" as const };
  const balance = await getLedgerBalance(tx, input.userId, input.currency);
  if (balance < input.amount) return { ok: false as const, reason: "insufficient_funds" as const, balance };
  const entry = await insertLedgerEntry(tx, {
    userId: input.userId,
    currency: input.currency,
    amount: -input.amount,
    kind: input.kind,
    reference: input.reference,
    createdBy: input.createdBy,
    memo: input.memo,
  });
  return { ok: true as const, entry, balance: balance - input.amount };
}

/**
 * Gasto que **não pode deixar o saldo negativo** (F6-7): compra na loja e taxa de entrada recusam em vez
 * de deixar o membro devendo por conta própria.
 *
 * O desenho é o mesmo do saque (TASK-030) e pelo mesmo motivo: a regra a serializar é sobre o saldo do
 * membro, não sobre o gasto. A linha do usuário é travada com `for update` e o saldo é **relido dentro da
 * transação** — dois gastos simultâneos de 30 com 50 de saldo terminam em um aprovado e um recusado, e
 * nunca nos dois passando.
 *
 * A exceção registrada é o ajuste/estorno da staff (F6-6/F6-7): ele **não** passa por aqui, vai direto no
 * `insertLedgerEntry`, porque quem ganhou por engano e já gastou precisa poder ficar devendo.
 */
export async function spendCurrency(db: Database, input: SpendInput): Promise<SpendResult> {
  return db.transaction((tx) => spendCurrencyTx(tx, input));
}
