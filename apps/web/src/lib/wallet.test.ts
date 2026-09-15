import { describe, expect, it } from "vitest";
import { lastSplit, monthEarnings } from "./wallet";
import { parseTheme } from "./theme";

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

describe("parseTheme", () => {
  it("só light explícito vira claro; resto é o padrão escuro", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme("b")).toBe("dark");
  });
});
