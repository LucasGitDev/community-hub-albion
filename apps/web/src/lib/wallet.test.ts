import { describe, expect, it } from "vitest";
import { easeOutCubic, interpolateSilver, lastSplit, monthEarnings } from "./wallet";
import { parseVariant } from "./variant";

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).toISOString();

const entries = [
  { kind: "split_credit", amount: 1_000n, createdAt: at(2026, 8, 2), description: "Loot split", eventName: "DG" },
  { kind: "split_remainder", amount: 7n, createdAt: at(2026, 8, 3), description: "Sobra" },
  { kind: "withdrawal_debit", amount: -500n, createdAt: at(2026, 8, 4), description: "Saque" },
  { kind: "reversal", amount: -1_000n, createdAt: at(2026, 8, 5), description: "Estorno" },
  { kind: "split_credit", amount: 9_999n, createdAt: at(2026, 7, 30), description: "Mês passado" },
];

describe("monthEarnings", () => {
  it("soma splits do mês corrente e desconta estornos, sem saques", () => {
    expect(monthEarnings(entries, new Date(2026, 8, 15))).toEqual({ total: 7n, splits: 2 });
  });
  it("mês sem split dá zero", () => {
    expect(monthEarnings(entries, new Date(2026, 5, 1))).toEqual({ total: 0n, splits: 0 });
  });
});

describe("lastSplit", () => {
  it("pega o split mais recente e ignora débitos", () => {
    expect(lastSplit(entries)?.amount).toBe(7n);
  });
  it("sem split retorna null", () => {
    expect(lastSplit([entries[2]])).toBeNull();
  });
});

describe("interpolateSilver", () => {
  it("interpola em bigint nos extremos e no meio", () => {
    expect(interpolateSilver(0n, 1_818_750n, 0)).toBe(0n);
    expect(interpolateSilver(0n, 1_818_750n, 1)).toBe(1_818_750n);
    expect(interpolateSilver(1_000n, 0n, 0.5)).toBe(500n);
  });
  it("prende progress fora de [0,1]", () => {
    expect(interpolateSilver(0n, 10n, 2)).toBe(10n);
    expect(interpolateSilver(0n, 10n, -1)).toBe(0n);
  });
  it("easeOutCubic vai de 0 a 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("parseVariant", () => {
  it("aceita letras e números do picker", () => {
    expect(parseVariant("b")).toBe("b");
    expect(parseVariant(" C ")).toBe("c");
    expect(parseVariant("1")).toBe("a");
    expect(parseVariant("2")).toBe("b");
    expect(parseVariant("3")).toBe("c");
  });
  it("valor inválido ou ausente vira A", () => {
    expect(parseVariant("z")).toBe("a");
    expect(parseVariant(null)).toBe("a");
  });
});
