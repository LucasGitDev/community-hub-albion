import { describe, expect, it } from "vitest";
import { CURRENCIES, formatAmount, formatAmountShort, parseAmount, parseCurrency } from "./currency.js";

describe("parseAmount (prata)", () => {
  it.each([
    ["1.500.000", 1_500_000n],
    ["1500000", 1_500_000n],
    ["1,5M", 1_500_000n],
    ["350k", 350_000n],
    [" 42 ", 42n],
  ])("lê %s", (input, expected) => {
    expect(parseAmount(input, "silver")).toBe(expected);
  });

  it.each(["", "abc", "1,5x", "-10"])("recusa %s", (input) => {
    expect(parseAmount(input, "silver")).toBeNull();
  });
});

describe("parseAmount (Buffunfa)", () => {
  it("lê o valor cheio, com ou sem o sufixo BUF", () => {
    expect(parseAmount("340", "buffunfa")).toBe(340n);
    expect(parseAmount("340 BUF", "buffunfa")).toBe(340n);
  });

  it("recusa abreviação: Buffunfa não abrevia em lugar nenhum (F6-5)", () => {
    expect(parseAmount("2k", "buffunfa")).toBeNull();
    expect(parseAmount("1,5M", "buffunfa")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("prata sai sem sufixo e Buffunfa com BUF", () => {
    expect(formatAmount(1_482_300n, "silver")).toBe("1.482.300");
    expect(formatAmount(340n, "buffunfa")).toBe("340 BUF");
  });
});

describe("formatAmountShort", () => {
  it.each([
    [1_482_300n, "1,48M"],
    [350_000n, "350k"],
    [999n, "999"],
    [-1_200_000n, "−1,2M"],
  ])("abrevia prata %s", (value, expected) => {
    expect(formatAmountShort(value, "silver")).toBe(expected);
  });

  it("nunca abrevia Buffunfa (F6-5)", () => {
    expect(formatAmountShort(340n, "buffunfa")).toBe("340 BUF");
    expect(formatAmountShort(12_500n, "buffunfa")).toBe("12.500 BUF");
  });
});

describe("parseCurrency", () => {
  it("aceita o alias bufunfa só na entrada (doc-009)", () => {
    expect(parseCurrency("bufunfa")).toBe("buffunfa");
    expect(parseCurrency("Buffunfa")).toBe("buffunfa");
    expect(parseCurrency("prata")).toBe("silver");
    expect(parseCurrency("ouro")).toBeNull();
  });

  it("cobre todas as moedas do ledger", () => {
    for (const c of CURRENCIES) expect(parseCurrency(c)).toBe(c);
  });
});
