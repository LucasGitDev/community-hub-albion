import { LEDGER_ENTRY_KIND_LABELS, type Currency, type LedgerEntryKind } from "@albion-hub/shared";

/**
 * Leitura do extrato real do ledger (TASK-031). Tudo em bigint: valor nunca vira float (Q20).
 *
 * Desde a TASK-056 o extrato tem duas moedas (F6-1), e **estas contas são de prata**: loot split paga
 * prata, e somar Buffunfa aqui daria um número que não existe. Por isso as duas funções filtram a moeda
 * em vez de confiar em quem chama — é exatamente o esquecimento que a decisão previu.
 *
 * Os tipos são os do ledger (`packages/shared/src/ledger.ts`): `split_payout` credita a parte do membro,
 * `split_fee` debita a taxa do evento, `withdrawal` é o débito do saque aprovado, `reversal` é a correção
 * de um lançamento e `adjustment` é o acerto manual da staff.
 */
interface Entry {
  kind: LedgerEntryKind;
  currency: Currency;
  amount: bigint;
  createdAt: string;
}

/** Linha do extrato que veio de uma divisão de loot (o ganho do membro, não a taxa). */
const isSplit = (e: Entry) => e.kind === "split_payout";

const SILVER: Currency = "silver";

/** Ganho líquido de **prata** no mês corrente (fuso local): splits menos taxas e estornos; saque não é gasto. */
export function monthEarnings(entries: Entry[], now: Date): { total: bigint; splits: number } {
  let total = 0n;
  let splits = 0;
  for (const e of entries) {
    const at = new Date(e.createdAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) continue;
    if (e.currency !== SILVER || e.kind === "withdrawal") continue;
    total += e.amount;
    if (isSplit(e)) splits += 1;
  }
  return { total, splits };
}

/** Crédito de split de **prata** mais recente, ou null. */
export function lastSplit<T extends Entry>(entries: T[]): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (e.currency === SILVER && isSplit(e) && (!best || e.createdAt > best.createdAt)) best = e;
  }
  return best;
}

/**
 * Título da linha do extrato: a origem do lançamento em PT-BR (AC#1). O `memo` é o que a staff escreveu
 * (motivo do estorno, nota do ajuste) e vira o detalhe abaixo do título.
 */
export const entryTitle = (kind: LedgerEntryKind): string => LEDGER_ENTRY_KIND_LABELS[kind];
