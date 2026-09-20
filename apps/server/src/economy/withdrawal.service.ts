import { Inject, Injectable } from "@nestjs/common";
import {
  approveWithdrawal,
  getBanStatus,
  getWithdrawal,
  getWithdrawalBalance,
  getWithdrawalBalances,
  listWithdrawals,
  openWithdrawalForMember,
  rejectWithdrawal,
  requestWithdrawal,
  settleWithdrawal,
  type DbHandle,
  type DecideWithdrawalOptions,
  type OpenWithdrawalForMemberResult,
  type RequestWithdrawalResult,
  type WithdrawalBalance,
  type WithdrawalDecisionResult,
} from "@albion-hub/db";
import type { WithdrawalBalanceDto, WithdrawalDto, WithdrawalListQuery } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelineAction, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit, TIMELINE_LOGGER } from "../timeline/timeline-people.js";

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

/** Abertura pela staff (TASK-083). Banido tem o saldo congelado, então nem pending nem pago no jogo passam. */
export type OpenForMemberResult = OpenWithdrawalForMemberResult | { ok: false; reason: "banned"; banReason: string };

@Injectable()
export class WithdrawalService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

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
    const result = await requestWithdrawal(this.handle.db, { userId, amount });
    if (result.ok) await this.publish("economy.withdrawal_requested", result.withdrawal, userId, null);
    return result;
  }

  /**
   * Abre um saque **para outro membro** (TASK-083, SS1–SS4). O `userId` é o alvo e `actorUserId` é quem
   * age — o controller tira o ator da sessão e nunca do corpo.
   *
   * Sem `paidInGame` nasce `pending` e entra na fila como qualquer outro (SS1). Com `paidInGame` nasce
   * liquidado (SS2). Banido é recusado nos dois casos: o saldo de quem foi banido fica congelado
   * (TASK-050), e abrir um pendente que nunca poderia ser aprovado só entulharia a fila.
   */
  async openForMember(input: { userId: string; actorUserId: string; amount: bigint; reason: string; paidInGame?: boolean }): Promise<OpenForMemberResult> {
    const ban = await getBanStatus(this.handle.db, input.userId);
    if (ban) return { ok: false, reason: "banned", banReason: ban.banReason };
    const result = await openWithdrawalForMember(this.handle.db, input);
    if (result.ok) {
      const action = result.withdrawal.status === "settled" ? "economy.withdrawal_opened_paid_in_game" : "economy.withdrawal_opened_by_staff";
      await this.publish(action, result.withdrawal, input.actorUserId, input.reason.trim());
    }
    return result;
  }

  /**
   * Lança o débito no ledger e marca o saque como aprovado, na mesma transação (AC#3).
   *
   * Saque pendente de banido não pode ser aprovado enquanto durar o banimento (TASK-050): o pedido fica
   * onde está, com a reserva de pé. Quem quiser liberar o saldo rejeita (isso continua permitido) ou
   * desbane — aprovar seria pagar prata a quem acabou de ser expulso da comunidade.
   */
  async approve(id: string, options: DecideWithdrawalOptions): Promise<DecideSilverResult> {
    const result = await approveWithdrawal(this.handle.db, id, options);
    if (result.ok) await this.publish("economy.withdrawal_approved", result.withdrawal, options.actorUserId, result.withdrawal.decisionNote);
    return result;
  }

  /** Libera a reserva sem lançamento; motivo obrigatório (AC#3). */
  async reject(id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
    const result = await rejectWithdrawal(this.handle.db, id, options);
    if (result.ok) await this.publish("economy.withdrawal_rejected", result.withdrawal, options.actorUserId, result.withdrawal.decisionNote);
    return result;
  }

  /** Registra o pagamento in-game: exige `settled_by` + nota (AC#4, Q11). */
  async settle(id: string, options: DecideWithdrawalOptions): Promise<WithdrawalDecisionResult> {
    const result = await settleWithdrawal(this.handle.db, id, options);
    if (result.ok) await this.publish("economy.withdrawal_settled", result.withdrawal, options.actorUserId, result.withdrawal.settlementNote);
    return result;
  }

  /**
   * Timeline (TASK-078): só depois de o repo devolver `ok`, ou seja, com a transação já commitada (T5).
   * Recusa não chega aqui. Prata por inteiro, no canal só de admins (T2).
   */
  private publish(action: TimelineAction, withdrawal: WithdrawalDto, actorUserId: string, note: string | null): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorUserId, withdrawal.userId]);
      const owner = people.target(withdrawal.userId);
      return {
        action,
        summary: `${WITHDRAWAL_SUMMARY[action]}: ${owner.name}`,
        actor: people.actor(actorUserId),
        ...(actorUserId === withdrawal.userId ? {} : { target: owner }),
        amounts: [{ value: BigInt(withdrawal.amount), currency: "silver" as const }],
        recordId: withdrawal.id,
        ...(note ? { details: [{ name: action === "economy.withdrawal_rejected" || action.startsWith("economy.withdrawal_opened") ? "Motivo" : "Nota", value: note }] } : {}),
      };
    });
  }

  get(id: string): Promise<WithdrawalDto | null> {
    return getWithdrawal(this.handle.db, id);
  }

  /** Lista saques. `filters.userId` é sempre preenchido pelo controller na visão do membro. */
  list(filters: WithdrawalListQuery = {}): Promise<WithdrawalDto[]> {
    return listWithdrawals(this.handle.db, filters);
  }
}

const WITHDRAWAL_SUMMARY: Record<string, string> = {
  "economy.withdrawal_requested": "Saque pedido",
  "economy.withdrawal_approved": "Saque aprovado",
  "economy.withdrawal_rejected": "Saque recusado",
  "economy.withdrawal_settled": "Saque entregue",
  "economy.withdrawal_opened_by_staff": "Saque aberto pela staff",
  "economy.withdrawal_opened_paid_in_game": "Saque aberto pela staff, já pago no jogo",
};

/** Prata vai para o JSON como string: número de JS não aguenta bigint (Q20). */
export const toBalanceDto = (balance: WithdrawalBalance): WithdrawalBalanceDto => ({
  balance: balance.balance.toString(),
  reserved: balance.reserved.toString(),
  available: balance.available.toString(),
});
