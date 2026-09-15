import { describe, expect, it } from "vitest";
import { computeBalance, MIN_WITHDRAWAL, transitionWithdrawal, validateWithdrawal } from "./rules";
import type { LedgerEntry, Withdrawal } from "./types";

const entry = (userId: string, amount: bigint): LedgerEntry => ({
  id: `${userId}-${amount}`,
  userId,
  kind: amount >= 0n ? "split_credit" : "withdrawal_debit",
  amount,
  description: "x",
  createdAt: "2026-09-01T00:00:00.000Z",
});

const withdrawal = (over: Partial<Withdrawal> = {}): Withdrawal => ({
  id: "w",
  userId: "u1",
  amount: 1_500_000n,
  status: "pending",
  requestedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("computeBalance", () => {
  it("soma só lançamentos do membro", () => {
    const b = computeBalance("u1", [entry("u1", 3_000_000n), entry("u2", 9_000_000n), entry("u1", -500_000n)], []);
    expect(b).toEqual({ total: 2_500_000n, reserved: 0n, available: 2_500_000n });
  });

  it("reserva só saques pending (Q25)", () => {
    const b = computeBalance("u1", [entry("u1", 3_000_000n)], [
      withdrawal({ amount: 1_000_000n }),
      withdrawal({ id: "a", amount: 700_000n, status: "approved" }),
      withdrawal({ id: "r", amount: 900_000n, status: "rejected" }),
      withdrawal({ id: "o", userId: "u2", amount: 2_000_000n }),
    ]);
    expect(b).toEqual({ total: 3_000_000n, reserved: 1_000_000n, available: 2_000_000n });
  });

  it("permite saldo negativo após estorno (Q24)", () => {
    expect(computeBalance("u1", [entry("u1", 1_000_000n), entry("u1", -1_200_000n)], []).available).toBe(-200_000n);
  });
});

describe("validateWithdrawal", () => {
  const balance = { total: 3_000_000n, reserved: 0n, available: 3_000_000n };

  it("recusa abaixo do mínimo (Q12)", () => {
    expect(validateWithdrawal(MIN_WITHDRAWAL - 1n, balance)).toEqual({ ok: false, error: "Valor abaixo do saque mínimo." });
  });

  it("recusa acima do disponível", () => {
    expect(validateWithdrawal(3_000_001n, balance).ok).toBe(false);
  });

  it("aceita no limite exato", () => {
    expect(validateWithdrawal(3_000_000n, balance)).toEqual({ ok: true });
    expect(validateWithdrawal(MIN_WITHDRAWAL, balance)).toEqual({ ok: true });
  });

  it("bloqueia com saldo negativo", () => {
    expect(validateWithdrawal(MIN_WITHDRAWAL, { total: -1n, reserved: 0n, available: -1n }).ok).toBe(false);
  });
});

describe("transitionWithdrawal", () => {
  const now = "2026-09-02T10:00:00.000Z";

  it("pending → approved registra decisão", () => {
    expect(transitionWithdrawal(withdrawal(), "approved", "Grim", now)).toMatchObject({
      status: "approved",
      decidedBy: "Grim",
      decidedAt: now,
    });
  });

  it("recusa exige motivo", () => {
    expect(transitionWithdrawal(withdrawal(), "rejected", "Grim", now)).toBeNull();
    expect(transitionWithdrawal(withdrawal(), "rejected", "Grim", now, "  ")).toBeNull();
    expect(transitionWithdrawal(withdrawal(), "rejected", "Grim", now, " sem prata ")).toMatchObject({
      status: "rejected",
      note: "sem prata",
    });
  });

  it("approved → settled registra entrega e mantém nota anterior sem nova", () => {
    const w = withdrawal({ status: "approved", note: "antiga" });
    expect(transitionWithdrawal(w, "settled", "Grim", now)).toMatchObject({
      status: "settled",
      settledBy: "Grim",
      settledAt: now,
      note: "antiga",
    });
  });

  it.each([
    ["pending", "settled"],
    ["approved", "approved"],
    ["approved", "rejected"],
    ["rejected", "approved"],
    ["settled", "settled"],
  ] as const)("bloqueia %s → %s", (from, to) => {
    expect(transitionWithdrawal(withdrawal({ status: from }), to, "Grim", now, "nota")).toBeNull();
  });
});
