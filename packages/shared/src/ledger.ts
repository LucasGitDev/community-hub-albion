/**
 * Ledger de prata (doc-002, TASK-026): tabela única append-only em bigint inteiro (Q20).
 * Correção nunca edita lançamento: cria um estorno (`reversal`) ligado ao original.
 */
export const LEDGER_ENTRY_KINDS = ["split_payout", "split_fee", "withdrawal", "reversal", "adjustment"] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/** Tipos de origem de um lançamento (`reference_type`): de onde ele veio. */
export const LEDGER_REFERENCE_TYPES = ["event", "loot_split", "withdrawal", "manual"] as const;

export type LedgerReferenceType = (typeof LEDGER_REFERENCE_TYPES)[number];
