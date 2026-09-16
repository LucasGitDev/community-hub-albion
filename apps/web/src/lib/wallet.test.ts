import { describe, expect, it } from "vitest";
import { entryTitle, lastSplit, monthEarnings } from "./wallet";
import { parseTheme } from "./theme";

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).toISOString();

const entries = [
  { kind: "split_payout" as const, amount: 1_000n, createdAt: at(2026, 8, 2) },
  { kind: "split_fee" as const, amount: -100n, createdAt: at(2026, 8, 3) },
  { kind: "withdrawal" as const, amount: -500n, createdAt: at(2026, 8, 4) },
  { kind: "reversal" as const, amount: -1_000n, createdAt: at(2026, 8, 5) },
  { kind: "split_payout" as const, amount: 2_000n, createdAt: at(2026, 8, 6) },
  { kind: "split_payout" as const, amount: 9_999n, createdAt: at(2026, 7, 30) },
];

describe("monthEarnings", () => {
  it("soma splits do mês, desconta taxa e estorno e ignora saque", () => {
    expect(monthEarnings(entries, new Date(2026, 8, 15))).toEqual({ total: 1_900n, splits: 2 });
  });
  it("mês sem lançamento dá zero", () => {
    expect(monthEarnings(entries, new Date(2026, 5, 1))).toEqual({ total: 0n, splits: 0 });
  });
});

describe("lastSplit", () => {
  it("pega o split mais recente e ignora taxa, saque e estorno", () => {
    expect(lastSplit(entries)?.amount).toBe(2_000n);
  });
  it("sem split retorna null", () => {
    expect(lastSplit([entries[2]!])).toBeNull();
  });
});

describe("entryTitle", () => {
  it("usa o rótulo PT-BR do tipo de lançamento", () => {
    expect(entryTitle("split_payout")).toBe("Pagamento de split");
    expect(entryTitle("reversal")).toBe("Estorno");
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
