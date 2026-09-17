import type { Currency, LedgerBalancesDto, LedgerCurrencyFilter, LedgerEntryDto, WithdrawalBalanceDto, WithdrawalDto } from "@albion-hub/shared";
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

/** Um saldo por moeda, em bigint e **nunca somados** (F6-27). */
export type Balances = Record<Currency, bigint>;

export interface Withdrawal extends Omit<WithdrawalDto, "amount"> {
  amount: bigint;
}

export interface LedgerEntry extends Omit<LedgerEntryDto, "amount"> {
  amount: bigint;
}

export interface MyWallet {
  /** Prata com a reserva de saque descontada. */
  balance: Balance;
  /** Prata e Buffunfa lado a lado, para o chip do header (F6-26) e o cabeçalho do extrato (F6-27). */
  balances: Balances;
  withdrawals: Withdrawal[];
}

const toBalance = (dto: WithdrawalBalanceDto): Balance => ({
  balance: BigInt(dto.balance),
  reserved: BigInt(dto.reserved),
  available: BigInt(dto.available),
});

const toWithdrawal = (dto: WithdrawalDto): Withdrawal => ({ ...dto, amount: BigInt(dto.amount) });

const toBalances = (dto: LedgerBalancesDto): Balances => ({ silver: BigInt(dto.silver), buffunfa: BigInt(dto.buffunfa) });

type WalletResponse = { balance: WithdrawalBalanceDto; balances: LedgerBalancesDto; withdrawals: WithdrawalDto[] };

const toWallet = (res: WalletResponse): MyWallet => ({
  balance: toBalance(res.balance),
  balances: toBalances(res.balances),
  withdrawals: res.withdrawals.map(toWithdrawal),
});

export const fetchMyWallet = (): Promise<MyWallet> => api<WalletResponse>("/api/me/withdrawals").then(toWallet);

/** Pede um saque. A recusa PT-BR (valor, saldo negativo, acima do disponível) vem da API. */
export const requestWithdrawal = (amount: bigint): Promise<MyWallet> =>
  api<WalletResponse>("/api/me/withdrawals", { method: "POST", body: JSON.stringify({ amount: amount.toString() }) }).then(toWallet);

export interface Statement {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

/**
 * Extrato do membro. A moeda é **explícita** (`"all"` por default, F6-27): a ordem cronológica das duas
 * juntas é o que conta a história, e o filtro é um recorte dela, não uma segunda tela.
 */
export function fetchMyStatement(currency: LedgerCurrencyFilter = "all", limit = 50): Promise<Statement> {
  return api<{ entries: LedgerEntryDto[]; nextCursor: string | null }>(`/api/me/ledger?currency=${currency}&limit=${limit}`).then((page) => ({
    entries: page.entries.map((e) => ({ ...e, amount: BigInt(e.amount) })),
    nextCursor: page.nextCursor,
  }));
}
