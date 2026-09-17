import { Inject, Injectable } from "@nestjs/common";
import {
  approveWithdrawal,
  getBanStatus,
  getWithdrawal,
  getWithdrawalBalance,
  getWithdrawalBalances,
  listWithdrawals,
  rejectWithdrawal,
  requestWithdrawal,
  settleWithdrawal,
  type DbHandle,
  type DecideWithdrawalOptions,
  type RequestWithdrawalResult,
  type WithdrawalBalance,
  type WithdrawalDecisionResult,
} from "@albion-hub/db";
import type { WithdrawalBalanceDto, WithdrawalDto, WithdrawalListQuery } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";

/**
 * Serviço interno único do saque (TASK-030, regra do repo: comando do Discord, painel e botão de embed
 * chamam este serviço, nunca o repo nem SQL).
 *
 * O que ele garante:
 * - `pending` reserva saldo sem lançar nada no ledger; `approved` lança o débito; `rejected` libera (Q25);
 * - `settled` exige quem pagou e a nota (Q11);
 * - pedidos concorrentes não furam o saldo: a trava e a revalidação vivem na transação do repo (AC#5).
 *
 * **Segurança**: todo método que fala de um membro recebe `userId` como argumento, então ele confia em quem
 * chama. Quem amarra esse `userId` ao usuário autenticado é o controller (`WithdrawalsController`), e é lá
 * que está o teste que prova que um membro não age no nome de outro — recomendação do security-review da
 * TASK-026. Se um dia um comando de bot chamar este serviço, ele tem a mesma obrigação.
 */
/**
 * Recusa por banimento no **pedido** (TASK-050). Na decisão da staff a recusa já vem do repo, de dentro
 * da transação (`WithdrawalDecisionResult`), porque lá o que está em jogo é o débito no ledger.
 */
export type RequestSilverResult = RequestWithdrawalResult | { ok: false; reason: "banned"; banReason: string };
export type DecideSilverResult = WithdrawalDecisionResult;

@Injectable()
export class WithdrawalService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Saldo, reserva e disponível do membro: a conta única do sistema (AC#2). */
  async balance(userId: string): Promise<WithdrawalBalance> {
    return getWithdrawalBalance(this.handle.db, userId);
  }

  /** Saldo de vários membros de uma vez: a fila da staff mostra o de cada dono junto do pedido (TASK-032). */
  balances(userIds: readonly string[]): Promise<Map<string, WithdrawalBalance>> {
    return getWithdrawalBalances(this.handle.db, userIds);
  }

  /**
   * Cria o pedido `pending`, que reserva o saldo. Recusas em AC#1/Q24 voltam como `ok: false`.
   * Saldo de banido é congelado (TASK-050): não some, não estorna, mas não sai.
   */
  async request(userId: string, amount: bigint): Promise<RequestSilverResult> {
    const ban = await getBanStatus(this.handle.db, userId);
    if (ban) return { ok: false, reason: "banned", banReason: ban.banReason };
    return requestWithdrawal(this.handle.db, { userId, amount });
  }

  /**
   * Lança o débito no ledger e marca o saque como aprovado, na mesma transação (AC#3).
   *
   * Saque pendente de banido não pode ser aprovado enquanto durar o banimento (TASK-050): o pedido fica
   * onde está, com a reserva de pé. Quem quiser liberar o saldo rejeita (isso continua permitido) ou
   * desbane — aprovar seria pagar prata a quem acabou de ser expulso da comunidade.
   */
  approve(id: string, options: DecideWithdrawalOptions): Promise<DecideSilverResult> {
    return approveWithdrawal(this.handle.db, id, options);
  }

  /** Libera a reserva sem lançamento; motivo obrigatório (AC#3). */
  reject(id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
    return rejectWithdrawal(this.handle.db, id, options);
  }

  /** Registra o pagamento in-game: exige `settled_by` + nota (AC#4, Q11). */
  settle(id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
    return settleWithdrawal(this.handle.db, id, options);
  }

  get(id: string): Promise<WithdrawalDto | null> {
    return getWithdrawal(this.handle.db, id);
  }

  /** Lista saques. `filters.userId` é sempre preenchido pelo controller na visão do membro. */
  list(filters: WithdrawalListQuery = {}): Promise<WithdrawalDto[]> {
    return listWithdrawals(this.handle.db, filters);
  }
}

/** Prata vai para o JSON como string: número de JS não aguenta bigint (Q20). */
export const toBalanceDto = (balance: WithdrawalBalance): WithdrawalBalanceDto => ({
  balance: balance.balance.toString(),
  reserved: balance.reserved.toString(),
  available: balance.available.toString(),
});
