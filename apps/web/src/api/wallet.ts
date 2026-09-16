import type { LedgerEntryDto, WithdrawalBalanceDto, WithdrawalDto } from "@albion-hub/shared";
import { api } from "./http";

/**
 * Carteira do membro (TASK-031) contra a API real: saldo + saques em `/api/me/withdrawals`, extrato em
 * `/api/me/ledger`. Nenhuma das duas rotas aceita usuário: o dono sai sempre da sessão (AC#2).
 *
 * Prata chega como string e **vira bigint aqui**, na borda (Q20). Nada no caminho do cálculo passa por
 * `number`: acima de 2^53 o JS perderia prata do membro.
 */
export interface Balance {
  balance: bigint;
  reserved: bigint;
  available: bigint;
}

export interface Withdrawal extends Omit<WithdrawalDto, "amount"> {
  amount: bigint;
}

export interface LedgerEntry extends Omit<LedgerEntryDto, "amount"> {
  amount: bigint;
}

export interface MyWallet {
  balance: Balance;
  withdrawals: Withdrawal[];
}

const toBalance = (dto: WithdrawalBalanceDto): Balance => ({
  balance: BigInt(dto.balance),
  reserved: BigInt(dto.reserved),
  available: BigInt(dto.available),
});

const toWithdrawal = (dto: WithdrawalDto): Withdrawal => ({ ...dto, amount: BigInt(dto.amount) });

const toWallet = (res: { balance: WithdrawalBalanceDto; withdrawals: WithdrawalDto[] }): MyWallet => ({
  balance: toBalance(res.balance),
  withdrawals: res.withdrawals.map(toWithdrawal),
});

export const fetchMyWallet = (): Promise<MyWallet> => api<{ balance: WithdrawalBalanceDto; withdrawals: WithdrawalDto[] }>("/api/me/withdrawals").then(toWallet);

/** Pede um saque. A recusa PT-BR (valor, saldo negativo, acima do disponível) vem da API. */
export const requestWithdrawal = (amount: bigint): Promise<MyWallet> =>
  api<{ balance: WithdrawalBalanceDto; withdrawals: WithdrawalDto[] }>("/api/me/withdrawals", { method: "POST", body: JSON.stringify({ amount: amount.toString() }) }).then(toWallet);

export interface Statement {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

export function fetchMyStatement(limit = 50): Promise<Statement> {
  return api<{ entries: LedgerEntryDto[]; nextCursor: string | null }>(`/api/me/ledger?limit=${limit}`).then((page) => ({
    entries: page.entries.map((e) => ({ ...e, amount: BigInt(e.amount) })),
    nextCursor: page.nextCursor,
  }));
}
