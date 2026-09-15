import type { LedgerEntry, Withdrawal } from "./types";

export const MIN_WITHDRAWAL = 1_000_000n;

export interface Balance {
  total: bigint;
  reserved: bigint;
  available: bigint;
}

/** Q25: pending reserva saldo; débito só entra no ledger no approved. */
export function computeBalance(userId: string, ledger: LedgerEntry[], withdrawals: Withdrawal[]): Balance {
  const total = ledger.filter((e) => e.userId === userId).reduce((s, e) => s + e.amount, 0n);
  const reserved = withdrawals
    .filter((w) => w.userId === userId && w.status === "pending")
    .reduce((s, w) => s + w.amount, 0n);
  return { total, reserved, available: total - reserved };
}

export type WithdrawalCheck = { ok: true } | { ok: false; error: string };

/** Q12 mínimo; Q24 saldo negativo bloqueia (available < amount cobre). */
export function validateWithdrawal(amount: bigint, balance: Balance): WithdrawalCheck {
  if (amount < MIN_WITHDRAWAL) return { ok: false, error: "Valor abaixo do saque mínimo." };
  if (amount > balance.available) return { ok: false, error: "Valor maior que o saldo disponível." };
  return { ok: true };
}

/** Transição de estado de saque. Retorna null se inválida. */
export function transitionWithdrawal(
  w: Withdrawal,
  to: "approved" | "rejected" | "settled",
  by: string,
  now: string,
  note?: string,
): Withdrawal | null {
  const allowed = (w.status === "pending" && (to === "approved" || to === "rejected")) || (w.status === "approved" && to === "settled");
  if (!allowed) return null;
  if (to === "rejected" && !note?.trim()) return null;
  const base = { ...w, status: to, note: note?.trim() || w.note };
  return to === "settled" ? { ...base, settledAt: now, settledBy: by } : { ...base, decidedAt: now, decidedBy: by };
}
