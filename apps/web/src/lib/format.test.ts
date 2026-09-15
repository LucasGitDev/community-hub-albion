import { describe, expect, it } from "vitest";
import { formatSilver, formatSilverShort, parseSilver } from "./format";

describe("parseSilver", () => {
  it.each([
    ["1.500.000", 1_500_000n],
    ["1500000", 1_500_000n],
    ["1,5M", 1_500_000n],
    ["1.25m", 1_250_000n],
    ["350k", 350_000n],
    [" 2 M ", 2_000_000n],
  ])("%s → %s", (input, expected) => {
    expect(parseSilver(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1,5", "1.5.0M"])("rejeita %j", (input) => {
    expect(parseSilver(input)).toBeNull();
  });
});

describe("formatSilver", () => {
  it("usa separador pt-BR", () => {
    expect(formatSilver(1_482_300n)).toBe("1.482.300");
  });
});

describe("formatSilverShort", () => {
  it.each([
    [1_818_750n, "1,81M"],
    [2_000_000n, "2M"],
    [350_999n, "350k"],
    [999n, "999"],
    [-1_500_000n, "−1,5M"],
    [-2_500n, "−2k"],
  ])("%s → %s", (value, expected) => {
    expect(formatSilverShort(value)).toBe(expected);
  });
});
