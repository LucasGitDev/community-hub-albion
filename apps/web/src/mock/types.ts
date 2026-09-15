/** Membro de demonstração (nome exibido na fila da staff). */
export interface DemoMember {
  discordId: string;
  nick: string;
}

type LedgerKind = "split_credit" | "split_remainder" | "withdrawal_debit" | "reversal";

export interface LedgerEntry {
  id: string;
  /** Discord ID do membro */
  userId: string;
  kind: LedgerKind;
  /** positivo = crédito, negativo = débito */
  amount: bigint;
  description: string;
  eventName?: string;
  createdAt: string;
  reversesId?: string;
}

export type WithdrawalStatus = "pending" | "approved" | "rejected" | "settled";

export interface Withdrawal {
  id: string;
  userId: string;
  amount: bigint;
  status: WithdrawalStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  settledAt?: string;
  settledBy?: string;
  note?: string;
}
