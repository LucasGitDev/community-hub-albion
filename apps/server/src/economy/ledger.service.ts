import { Inject, Injectable } from "@nestjs/common";
import {
  getLedgerBalance,
  getLedgerBalancesByCurrency,
  insertLedgerEntry,
  listLedgerEntries,
  listLedgerEntriesByReference,
  reverseLedgerEntry,
  spendCurrency,
  type CurrencyFilter,
  type DbHandle,
  type LedgerBalances,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerPage,
  type LedgerPageQuery,
  type ReverseLedgerEntryOptions,
  type ReverseLedgerEntryResult,
  type SpendInput,
  type SpendResult,
} from "@albion-hub/db";
import type { Currency, LedgerBalancesDto, LedgerReferenceType } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";

/** Os dois saldos em string (Q20), um por moeda e **nunca somados** (F6-27). */
export const toBalancesDto = (balances: LedgerBalances): LedgerBalancesDto => ({
  silver: balances.silver.toString(),
  buffunfa: balances.buffunfa.toString(),
});

/**
 * Porta única do ledger (doc-002, TASK-026). Loot split (TASK-027/028), saque (TASK-030), manutenção e
 * carteira do membro chamam este serviço — nunca o repo nem SQL direto.
 *
 * O que ele garante, e continua valendo para quem vier depois:
 * - lançamento nasce e não muda mais; correção é `reverse`, que cria o inverso ligado ao original;
 * - valor é sempre `bigint` inteiro (Q20): nada de `number` atravessando a API;
 * - **a moeda é sempre explícita** (F6-1): não há método aqui que devolva saldo sem dizer de qual moeda;
 * - saldo de prata pode ficar negativo (Q24); gasto de Buffunfa não deixa negativo (`spend`, F6-7), e a
 *   exceção registrada é o ajuste da staff, que entra por `record` e pode cravar negativo (F6-6).
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Credita (amount > 0) ou debita (amount < 0) na moeda do input. Zero é recusado pelo banco. */
  record(input: LedgerEntryInput): Promise<LedgerEntry> {
    return insertLedgerEntry(this.handle.db, input);
  }

  /** Única correção possível: cria o lançamento inverso. Um estorno por lançamento (AC#2). */
  reverse(entryId: string, options: ReverseLedgerEntryOptions): Promise<ReverseLedgerEntryResult> {
    return reverseLedgerEntry(this.handle.db, entryId, options);
  }

  /**
   * Gasto que não pode deixar o saldo negativo (F6-7): trava a linha do usuário e relê o saldo dentro da
   * transação, como o saque já fazia. É por aqui que taxa de entrada e loja vão debitar Buffunfa.
   */
  spend(input: SpendInput): Promise<SpendResult> {
    return spendCurrency(this.handle.db, input);
  }

  /** Saldo somado no banco, em bigint exato (AC#3), **numa moeda**; negativo é válido em prata (Q24). */
  balance(userId: string, currency: Currency): Promise<bigint> {
    return getLedgerBalance(this.handle.db, userId, currency);
  }

  /** Os saldos das duas moedas, lado a lado e **nunca somados** (F6-27). */
  balances(userId: string): Promise<LedgerBalances> {
    return getLedgerBalancesByCurrency(this.handle.db, userId);
  }

  /** Extrato do membro numa moeda (ou `"all"`, F6-27), do mais novo para o mais antigo. */
  statement(userId: string, currency: CurrencyFilter, query: LedgerPageQuery = {}): Promise<LedgerPage> {
    return listLedgerEntries(this.handle.db, userId, currency, query);
  }

  /** Lançamentos gerados por uma origem (evento, split, saque). */
  byReference(type: LedgerReferenceType, id: string): Promise<LedgerEntry[]> {
    return listLedgerEntriesByReference(this.handle.db, type, id);
  }
}
