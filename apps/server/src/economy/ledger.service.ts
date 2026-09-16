import { Inject, Injectable } from "@nestjs/common";
import {
  getLedgerBalance,
  insertLedgerEntry,
  listLedgerEntries,
  listLedgerEntriesByReference,
  reverseLedgerEntry,
  type DbHandle,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerPage,
  type LedgerPageQuery,
  type ReverseLedgerEntryOptions,
  type ReverseLedgerEntryResult,
} from "@albion-hub/db";
import type { LedgerReferenceType } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";

/**
 * Porta única do ledger de prata (doc-002, TASK-026). Loot split (TASK-027/028), saque (TASK-030) e
 * carteira do membro chamam este serviço — nunca o repo nem SQL direto.
 *
 * O que ele garante, e continua valendo para quem vier depois:
 * - lançamento nasce e não muda mais; correção é `reverse`, que cria o inverso ligado ao original;
 * - prata é sempre `bigint` inteiro (Q20): nada de `number` atravessando a API;
 * - saldo pode ficar negativo (Q24) — quem bloqueia saque com saldo negativo é o módulo de saque.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Credita (amount > 0) ou debita (amount < 0) prata. Zero é recusado pelo banco. */
  record(input: LedgerEntryInput): Promise<LedgerEntry> {
    return insertLedgerEntry(this.handle.db, input);
  }

  /** Única correção possível: cria o lançamento inverso. Um estorno por lançamento (AC#2). */
  reverse(entryId: string, options: ReverseLedgerEntryOptions): Promise<ReverseLedgerEntryResult> {
    return reverseLedgerEntry(this.handle.db, entryId, options);
  }

  /** Saldo somado no banco, em bigint exato (AC#3); negativo é válido (Q24). */
  balance(userId: string): Promise<bigint> {
    return getLedgerBalance(this.handle.db, userId);
  }

  /** Extrato do membro, do mais novo para o mais antigo. */
  statement(userId: string, query: LedgerPageQuery = {}): Promise<LedgerPage> {
    return listLedgerEntries(this.handle.db, userId, query);
  }

  /** Lançamentos gerados por uma origem (evento, split, saque). */
  byReference(type: LedgerReferenceType, id: string): Promise<LedgerEntry[]> {
    return listLedgerEntriesByReference(this.handle.db, type, id);
  }
}
