/**
 * Ledger de prata (doc-002, TASK-026): tabela única append-only em bigint inteiro (Q20).
 * Correção nunca edita lançamento: cria um estorno (`reversal`) ligado ao original.
 */
export const LEDGER_ENTRY_KINDS = ["split_payout", "split_fee", "withdrawal", "reversal", "adjustment"] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/** Tipos de origem de um lançamento (`reference_type`): de onde ele veio. */
export const LEDGER_REFERENCE_TYPES = ["event", "loot_split", "withdrawal", "manual"] as const;

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
};

/**
 * Lançamento como a API devolve. Prata vai como **string** (Q20): JSON não tem inteiro grande o
 * bastante, e no caminho do cálculo o painel converte de volta pra bigint, nunca pra number.
 */
export interface LedgerEntryDto {
  id: string;
  amount: string;
  kind: LedgerEntryKind;
  referenceType: LedgerReferenceType | null;
  referenceId: string | null;
  /** Id do lançamento que este estorna; null quando não é estorno. */
  reversalOf: string | null;
  /** Texto livre de quem lançou (motivo do estorno, nota do ajuste). */
  memo: string | null;
  createdAt: string;
}

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

/** `?limit=&cursor=` do extrato. Valor inválido é recusado em vez de silenciosamente ignorado. */
export function parseLedgerPageQuery(query: Record<string, unknown>): { ok: true; limit?: number; cursor?: { createdAt: Date; id: string } } | { ok: false; error: string } {
  const out: { limit?: number; cursor?: { createdAt: Date; id: string } } = {};
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
  return { ok: true, ...out };
}
