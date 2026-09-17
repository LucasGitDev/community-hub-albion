import type { MemberLedgerEntryDto, WithdrawalBalanceDto } from "@albion-hub/shared";
import type { Balance } from "@/api/wallet";
import { api } from "./http";

/**
 * Extrato de um jogador lido pela staff (TASK-051). A API é `/api/admin/members/:userId/ledger` e só
 * responde a quem tem `read Wallet` sem condição de dono (staff e admin) — o alvo vai na rota, o ator
 * sai da sessão. Leitura apenas: não existe aqui nenhuma chamada que escreva no ledger.
 *
 * Prata chega em string e **vira bigint na borda** (Q20): nada no caminho do cálculo passa por `number`.
 */
export interface MemberLedgerEntry extends Omit<MemberLedgerEntryDto, "amount"> {
  amount: bigint;
}

export interface MemberLedgerPage {
  member: { id: string; name: string };
  balance: Balance;
  entries: MemberLedgerEntry[];
  nextCursor: string | null;
}

interface Raw {
  member: { id: string; name: string };
  balance: WithdrawalBalanceDto;
  entries: MemberLedgerEntryDto[];
  nextCursor: string | null;
}

export function fetchMemberLedger(userId: string, options: { limit?: number; cursor?: string | null } = {}): Promise<MemberLedgerPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 25) });
  if (options.cursor) query.set("cursor", options.cursor);
  return api<Raw>(`/api/admin/members/${userId}/ledger?${query.toString()}`).then((page) => ({
    member: page.member,
    balance: { balance: BigInt(page.balance.balance), reserved: BigInt(page.balance.reserved), available: BigInt(page.balance.available) },
    entries: page.entries.map((e) => ({ ...e, amount: BigInt(e.amount) })),
    nextCursor: page.nextCursor,
  }));
}
