/** Resumos da carteira pros cards (TASK-036). Tudo em bigint: prata nunca vira float. */

interface Entry {
  kind: string;
  amount: bigint;
  createdAt: string;
  eventName?: string;
  description: string;
}

const isSplit = (e: Entry) => e.kind === "split_credit" || e.kind === "split_remainder";

/** Ganho líquido do mês corrente (fuso local): splits menos estornos; saques não contam. */
export function monthEarnings(entries: Entry[], now: Date): { total: bigint; splits: number } {
  let total = 0n;
  let splits = 0;
  for (const e of entries) {
    const at = new Date(e.createdAt);
    if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) continue;
    if (e.kind === "reversal") total += e.amount;
    if (!isSplit(e)) continue;
    total += e.amount;
    splits += 1;
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
