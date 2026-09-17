import { CURRENCIES, type Currency } from "./currency.js";

/**
 * Ledger (doc-002, TASK-026; duas moedas desde a TASK-056): tabela única append-only em bigint inteiro (Q20).
 * Correção nunca edita lançamento: cria um estorno (`reversal`) ligado ao original.
 */
/**
 * `purchase` e a origem `shop_order` nascem na TASK-059 **sem consumidor**, pelo mesmo motivo do
 * `spendCurrency` (F6-33): a compra só reserva, e o débito é lançado na entrega (TASK-060). Ter o tipo e a
 * origem prontos agora é o que faz a entrega ser uma transição de estado, e não uma migration nova.
 *
 * `entry_fee` é o contrário: nasce na TASK-058 **com** consumidor, porque a taxa de entrada é débito
 * imediato — cobrada na inscrição (F6-13) e devolvida por estorno quando é devolvida (F6-14).
 *
 * `event_attendance` é o ganho de Buffunfa por comparecimento (TASK-057, F6-10): a primeira fonte da
 * moeda, com origem `event` — o evento é que paga, não o split.
 */
export const LEDGER_ENTRY_KINDS = ["split_payout", "split_fee", "withdrawal", "reversal", "adjustment", "purchase", "entry_fee", "event_attendance"] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/** Tipos de origem de um lançamento (`reference_type`): de onde ele veio. */
export const LEDGER_REFERENCE_TYPES = ["event", "loot_split", "withdrawal", "manual", "shop_order"] as const;

export type LedgerReferenceType = (typeof LEDGER_REFERENCE_TYPES)[number];

/**
 * Rótulo PT-BR do tipo de lançamento (Q18). Fonte única para painel e bot: o extrato do membro precisa
 * dizer **de onde veio** cada linha (pagamento de split, taxa, saque, estorno, ajuste) sem inventar texto.
 */
export const LEDGER_ENTRY_KIND_LABELS: Record<LedgerEntryKind, string> = {
  split_payout: "Pagamento de split",
  split_fee: "Taxa do evento",
  withdrawal: "Saque",
  reversal: "Estorno",
  adjustment: "Ajuste",
  purchase: "Compra na loja",
  entry_fee: "Taxa de entrada",
  event_attendance: "Presença em evento",
};

/**
 * Lançamento como a API devolve. Prata vai como **string** (Q20): JSON não tem inteiro grande o
 * bastante, e no caminho do cálculo o painel converte de volta pra bigint, nunca pra number.
 */
export interface LedgerEntryDto {
  id: string;
  amount: string;
  /** Moeda da linha (F6-1). Cada linha do extrato marca a sua: nada aqui vira um total misturado (F6-27). */
  currency: Currency;
  kind: LedgerEntryKind;
  referenceType: LedgerReferenceType | null;
  referenceId: string | null;
  /** Id do lançamento que este estorna; null quando não é estorno. */
  reversalOf: string | null;
  /** Texto livre de quem lançou (motivo do estorno, nota do ajuste). */
  memo: string | null;
  createdAt: string;
}

/**
 * Filtro de moeda do extrato: `"all"` é o default, porque a ordem cronológica das duas moedas juntas é
 * o que conta a história (F6-27). Os saldos, esses, nunca vêm somados.
 */
export type LedgerCurrencyFilter = Currency | "all";

export const LEDGER_CURRENCY_FILTERS = ["all", ...CURRENCIES] as const;

export const isLedgerCurrencyFilter = (value: unknown): value is LedgerCurrencyFilter =>
  typeof value === "string" && (LEDGER_CURRENCY_FILTERS as readonly string[]).includes(value);

/** Os dois saldos como a API devolve: um por moeda, em string (Q20), **nunca somados** (F6-27). */
export type LedgerBalancesDto = Record<Currency, string>;

/** Cursor do extrato serializado para a query string: `<iso>|<uuid>`. */
export const encodeLedgerCursor = (cursor: { createdAt: string; id: string }): string => `${cursor.createdAt}|${cursor.id}`;

/** Volta do formato acima; qualquer coisa fora do padrão vira null (a API responde 400). */
export function decodeLedgerCursor(raw: string): { createdAt: Date; id: string } | null {
  const sep = raw.indexOf("|");
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { createdAt: at, id };
}

/** Tamanho de página do extrato do membro: os mesmos limites do repo (TASK-026). */
export const LEDGER_PAGE_MAX = 200;
export const LEDGER_PAGE_DEFAULT = 50;

/** `?currency=&limit=&cursor=` do extrato. Valor inválido é recusado em vez de silenciosamente ignorado. */
export function parseLedgerPageQuery(
  query: Record<string, unknown>,
): { ok: true; currency: LedgerCurrencyFilter; limit?: number; cursor?: { createdAt: Date; id: string } } | { ok: false; error: string } {
  const out: { limit?: number; cursor?: { createdAt: Date; id: string } } = {};
  let currency: LedgerCurrencyFilter = "all";
  if (query.currency !== undefined) {
    if (!isLedgerCurrencyFilter(query.currency)) return { ok: false, error: `Moeda inválida: use ${LEDGER_CURRENCY_FILTERS.join(", ")}.` };
    currency = query.currency;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LEDGER_PAGE_MAX) return { ok: false, error: `O limite do extrato vai de 1 a ${LEDGER_PAGE_MAX}.` };
    out.limit = limit;
  }
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string") return { ok: false, error: "Cursor do extrato inválido." };
    const cursor = decodeLedgerCursor(query.cursor);
    if (!cursor) return { ok: false, error: "Cursor do extrato inválido." };
    out.cursor = cursor;
  }
  return { ok: true, currency, ...out };
}

/** Quem assinou o lançamento. Null quando não houve gente: job, ou o namespace de manutenção (TASK-048). */
export interface LedgerAuthorDto {
  id: string;
  name: string;
}

/**
 * Lançamento como a staff lê (TASK-051): o mesmo do membro, mais o autor. O extrato do próprio membro
 * não carrega isso — quem pergunta "cadê minha prata" quer a linha; quem pergunta "quem mexeu" é a staff.
 */
export interface MemberLedgerEntryDto extends LedgerEntryDto {
  author: LedgerAuthorDto | null;
}

/** Origem `manual/maintenance`: ajuste feito pelo namespace de manutenção (TASK-048, G5), sem sessão e sem autor. */
export const MAINTENANCE_LEDGER_REFERENCE = { type: "manual" as const, id: "maintenance" };

export const isMaintenanceLedgerEntry = (entry: Pick<LedgerEntryDto, "referenceType" | "referenceId">): boolean =>
  entry.referenceType === MAINTENANCE_LEDGER_REFERENCE.type && entry.referenceId === MAINTENANCE_LEDGER_REFERENCE.id;

/**
 * Quem lançou, em texto (AC#2). O ajuste da manutenção é justamente a linha que alguém vai questionar,
 * então ele se identifica como manutenção em vez de virar um "—" mudo que não explica nada.
 */
export function describeLedgerAuthor(entry: MemberLedgerEntryDto): string {
  if (entry.author) return entry.author.name;
  if (isMaintenanceLedgerEntry(entry)) return "Manutenção";
  return "Sistema";
}
