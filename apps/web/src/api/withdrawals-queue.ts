import type { WithdrawalBalanceDto, WithdrawalDto, WithdrawalQueueResponse } from "@albion-hub/shared";
import { api } from "./http";
import type { Balance, Withdrawal } from "./wallet";

/**
 * Fila de saques da staff (TASK-032) contra a API real. Aprovar, recusar e liquidar são POSTs
 * separados; quem agiu (`decided_by`/`settled_by`) sai sempre da sessão no servidor, nunca daqui.
 *
 * Prata chega como string e **vira bigint aqui**, na borda (Q20): nada no caminho do cálculo passa por
 * `number`, que acima de 2^53 perderia prata do membro.
 */
export interface QueueItem extends Withdrawal {
  /** Saldo do dono no momento da leitura: o contexto de quem decide. Null se a API não mandou. */
  balance: Balance | null;
}

const toBalance = (dto: WithdrawalBalanceDto): Balance => ({
  balance: BigInt(dto.balance),
  reserved: BigInt(dto.reserved),
  available: BigInt(dto.available),
});

const toItem = (dto: WithdrawalDto, balances: Record<string, WithdrawalBalanceDto>): QueueItem => {
  const b = balances[dto.userId];
  return { ...dto, amount: BigInt(dto.amount), balance: b ? toBalance(b) : null };
};

/** A fila inteira: a tela filtra por aba no cliente, então o contador de cada aba é sempre coerente. */
export const fetchWithdrawalQueue = (): Promise<QueueItem[]> =>
  api<WithdrawalQueueResponse>("/api/withdrawals").then((res) => res.withdrawals.map((w) => toItem(w, res.balances)));

/**
 * Decisões da staff. A recusa e a nota de entrega são obrigatórias (Q11, AC#2 da TASK-030) e a
 * mensagem de erro — inclusive o 409 de "outro staff já decidiu" — vem pronta da API.
 */
const decide = (id: string, action: "approve" | "reject" | "settle", note?: string): Promise<WithdrawalDto> =>
  api<WithdrawalDto>(`/api/withdrawals/${id}/${action}`, { method: "POST", body: JSON.stringify(note === undefined ? {} : { note }) });

export const approveWithdrawal = (id: string): Promise<WithdrawalDto> => decide(id, "approve");
export const rejectWithdrawal = (id: string, note: string): Promise<WithdrawalDto> => decide(id, "reject", note);
export const settleWithdrawal = (id: string, note: string): Promise<WithdrawalDto> => decide(id, "settle", note);

/**
 * Saque aberto pela staff para um membro (TASK-083, SS1–SS4). O `userId` é o **alvo**; quem abriu sai da
 * sessão no servidor, nunca daqui. `paidInGame` é o atalho de SS2: o saque nasce liquidado e não entra
 * na fila.
 */
export const openWithdrawalForMember = (input: { userId: string; amount: bigint; reason: string; paidInGame: boolean }): Promise<WithdrawalDto> =>
  api<WithdrawalDto>("/api/withdrawals", {
    method: "POST",
    // Prata vai como string (Q20): number perderia valor acima de 2^53.
    body: JSON.stringify({ userId: input.userId, amount: input.amount.toString(), reason: input.reason, paidInGame: input.paidInGame }),
  });
