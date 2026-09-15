import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCurrentUser } from "@/auth/AuthProvider";
import * as seed from "./seed";
import { computeBalance, transitionWithdrawal, validateWithdrawal, type Balance, type WithdrawalCheck } from "./rules";
import type { LedgerEntry, Withdrawal } from "./types";

/**
 * Ledger e saques de demonstração até a API real (F5). Identidade vem do login real
 * (AuthProvider); dados ficam no localStorage, chaveados pelo Discord ID.
 * bigint não serializa em JSON: vira string no disco.
 */

interface State {
  ledger: LedgerEntry[];
  withdrawals: Withdrawal[];
}

const STORAGE_KEY = "albion-hub:demo:v3";

const reviver = (key: string, value: unknown) => (key === "amount" && typeof value === "string" ? BigInt(value) : value);
const replacer = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw, reviver) as State;
  } catch {
    /* ignora estado corrompido */
  }
  return { ledger: seed.ledger, withdrawals: seed.withdrawals };
}

interface Store {
  ledgerFor: (discordId: string) => LedgerEntry[];
  withdrawalsFor: (discordId: string) => Withdrawal[];
  allWithdrawals: Withdrawal[];
  balanceFor: (discordId: string) => Balance;
  requestWithdrawal: (amount: bigint) => WithdrawalCheck;
  decideWithdrawal: (id: string, decision: "approved" | "rejected", note?: string) => void;
  settleWithdrawal: (id: string, note?: string) => void;
}

const StoreContext = createContext<Store | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);

/** Montar dentro de rotas autenticadas. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  const [state, setState] = useState<State>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state, replacer));
    } catch {
      /* storage cheio/bloqueado: segue em memória */
    }
  }, [state]);

  const balanceFor = useCallback((discordId: string) => computeBalance(discordId, state.ledger, state.withdrawals), [state.ledger, state.withdrawals]);

  const store = useMemo<Store>(() => {
    const transition = (id: string, to: "approved" | "rejected" | "settled", note?: string) =>
      setState((s) => {
        const w = s.withdrawals.find((x) => x.id === id);
        const now = new Date().toISOString();
        const updated = w ? transitionWithdrawal(w, to, user.nick, now, note) : null;
        if (!w || !updated) return s;
        const ledger =
          to === "approved"
            ? [...s.ledger, { id: uid(), userId: w.userId, kind: "withdrawal_debit" as const, amount: -w.amount, description: "Saque aprovado", createdAt: now }]
            : s.ledger;
        return { ...s, ledger, withdrawals: s.withdrawals.map((x) => (x.id === id ? updated : x)) };
      });

    return {
      ledgerFor: (discordId) => state.ledger.filter((e) => e.userId === discordId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      withdrawalsFor: (discordId) =>
        state.withdrawals.filter((w) => w.userId === discordId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      allWithdrawals: [...state.withdrawals].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      balanceFor,
      requestWithdrawal: (amount) => {
        const check = validateWithdrawal(amount, balanceFor(user.discordId));
        if (!check.ok) return check;
        const w: Withdrawal = { id: uid(), userId: user.discordId, amount, status: "pending", requestedAt: new Date().toISOString() };
        setState((s) => ({ ...s, withdrawals: [...s.withdrawals, w] }));
        return check;
      },
      decideWithdrawal: (id, decision, note) => transition(id, decision, note),
      settleWithdrawal: (id, note) => transition(id, "settled", note),
    };
  }, [user, state, balanceFor]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore fora de StoreProvider");
  return ctx;
}

export const nickOf = (discordId: string) => seed.demoMembers.find((u) => u.discordId === discordId)?.nick ?? "Membro";
export { MIN_WITHDRAWAL } from "./rules";
