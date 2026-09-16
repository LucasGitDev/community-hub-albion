import { LEDGER_ENTRY_KIND_LABELS, type LedgerEntryKind } from "@albion-hub/shared";

/**
 * Leitura do extrato real do ledger (TASK-031). Tudo em bigint: prata nunca vira float (Q20).
 *
 * Os tipos são os do ledger (`packages/shared/src/ledger.ts`): `split_payout` credita a parte do membro,
 * `split_fee` debita a taxa do evento, `withdrawal` é o débito do saque aprovado, `reversal` é a correção
 * de um lançamento e `adjustment` é o acerto manual da staff.
 */
interface Entry {
  kind: LedgerEntryKind;
  amount: bigint;
  createdAt: string;
}

/** Linha do extrato que veio de uma divisão de loot (o ganho do membro, não a taxa). */
const isSplit = (e: Entry) => e.kind === "split_payout";

/** Ganho líquido do mês corrente (fuso local): splits menos taxas e estornos; saque não é gasto. */
export function monthEarnings(entries: Entry[], now: Date): { total: bigint; splits: number } {
  let total = 0n;
  let splits = 0;
  for (const e of entries) {
    const at = new Date(e.createdAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) continue;
    if (e.kind === "withdrawal") continue;
    total += e.amount;
    if (isSplit(e)) splits += 1;
  }
  return { total, splits };
}

/** Crédito de split mais recente, ou null. */
export function lastSplit<T extends Entry>(entries: T[]): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (isSplit(e) && (!best || e.createdAt > best.createdAt)) best = e;
  }
  return best;
}

/**
 * Título da linha do extrato: a origem do lançamento em PT-BR (AC#1). O `memo` é o que a staff escreveu
 * (motivo do estorno, nota do ajuste) e vira o detalhe abaixo do título.
 */
export const entryTitle = (kind: LedgerEntryKind): string => LEDGER_ENTRY_KIND_LABELS[kind];
