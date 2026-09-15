import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as seed from "./seed";
import type { LedgerEntry, Role, User, Withdrawal } from "./types";

/**
 * Store em memória simulando a API. Persiste em localStorage pra sobreviver a reload.
 * bigint não serializa em JSON: converte pra string no disco.
 */

interface State {
  sessionUserId: string | null;
  ledger: LedgerEntry[];
  withdrawals: Withdrawal[];
}

const STORAGE_KEY = "albion-hub:mock:v2";

const reviver = (key: string, value: unknown) =>
  key === "amount" && typeof value === "string" ? BigInt(value) : value;
const replacer = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw, reviver) as State;
  } catch {
    /* ignora estado corrompido */
  }
  return { sessionUserId: null, ledger: seed.ledger, withdrawals: seed.withdrawals };
}

export const STAFF_ROLES: Role[] = ["caller", "staff", "admin"];
export const canManageWithdrawals = (role: Role) => role === "staff" || role === "admin";
export const isStaffArea = (role: Role) => STAFF_ROLES.includes(role);

interface Balance {
  total: bigint;
  reserved: bigint;
  available: bigint;
}

interface Store {
  user: User | null;
  users: User[];
  loginAs: (userId: string) => void;
  logout: () => void;
  ledgerFor: (userId: string) => LedgerEntry[];
  withdrawalsFor: (userId: string) => Withdrawal[];
  allWithdrawals: Withdrawal[];
  balanceFor: (userId: string) => Balance;
  requestWithdrawal: (amount: bigint) => { ok: true } | { ok: false; error: string };
  decideWithdrawal: (id: string, decision: "approved" | "rejected", note?: string) => void;
  settleWithdrawal: (id: string, note?: string) => void;
  resetMock: () => void;
}

const StoreContext = createContext<Store | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state, replacer));
  }, [state]);

  const user = seed.users.find((u) => u.id === state.sessionUserId) ?? null;

  const balanceFor = useCallback(
    (userId: string): Balance => {
      const total = state.ledger.filter((e) => e.userId === userId).reduce((s, e) => s + e.amount, 0n);
      // Q25: pending reserva saldo; débito só entra no ledger no approved
      const reserved = state.withdrawals
        .filter((w) => w.userId === userId && w.status === "pending")
        .reduce((s, w) => s + w.amount, 0n);
      return { total, reserved, available: total - reserved };
    },
    [state.ledger, state.withdrawals],
  );

  const store = useMemo<Store>(
    () => ({
      user,
      users: seed.users,
      loginAs: (userId) => setState((s) => ({ ...s, sessionUserId: userId })),
      logout: () => setState((s) => ({ ...s, sessionUserId: null })),
      ledgerFor: (userId) =>
        state.ledger.filter((e) => e.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      withdrawalsFor: (userId) =>
        state.withdrawals.filter((w) => w.userId === userId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      allWithdrawals: [...state.withdrawals].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      balanceFor,
      requestWithdrawal: (amount) => {
        if (!user) return { ok: false, error: "Sessão expirada. Entre de novo." };
        if (amount < seed.MIN_WITHDRAWAL) return { ok: false, error: "Valor abaixo do saque mínimo." };
        const { available } = balanceFor(user.id);
        if (amount > available) return { ok: false, error: "Valor maior que o saldo disponível." };
        const w: Withdrawal = { id: uid(), userId: user.id, amount, status: "pending", requestedAt: new Date().toISOString() };
        setState((s) => ({ ...s, withdrawals: [...s.withdrawals, w] }));
        return { ok: true };
      },
      decideWithdrawal: (id, decision, note) =>
        setState((s) => {
          const w = s.withdrawals.find((x) => x.id === id);
          if (!w || w.status !== "pending") return s;
          const now = new Date().toISOString();
          const updated: Withdrawal = { ...w, status: decision, decidedAt: now, decidedBy: user?.nick, note: note || w.note };
          const ledger =
            decision === "approved"
              ? [...s.ledger, { id: uid(), userId: w.userId, kind: "withdrawal_debit" as const, amount: -w.amount, description: "Saque aprovado", createdAt: now }]
              : s.ledger;
          return { ...s, ledger, withdrawals: s.withdrawals.map((x) => (x.id === id ? updated : x)) };
        }),
      settleWithdrawal: (id, note) =>
        setState((s) => ({
          ...s,
          withdrawals: s.withdrawals.map((w) =>
            w.id === id && w.status === "approved"
              ? { ...w, status: "settled", settledAt: new Date().toISOString(), settledBy: user?.nick, note: note || w.note }
              : w,
          ),
        })),
      resetMock: () => setState({ sessionUserId: state.sessionUserId, ledger: seed.ledger, withdrawals: seed.withdrawals }),
    }),
    [user, state, balanceFor],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore fora de StoreProvider");
  return ctx;
}

export function useUser(): User {
  const { user } = useStore();
  if (!user) throw new Error("useUser sem sessão");
  return user;
}

export const nickOf = (userId: string) => seed.users.find((u) => u.id === userId)?.nick ?? "Desconhecido";
export { MIN_WITHDRAWAL } from "./seed";
