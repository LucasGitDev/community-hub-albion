import { describe, expect, it } from "vitest";
import { buffunfaEmojiMention, formatBuffunfa } from "./buffunfa-emoji.js";

describe("emoji da Buffunfa (F6-28, doc-009)", () => {
  it("escreve valor, espaço e emoji quando há id", () => {
    expect(formatBuffunfa(340n, "123456789012345678")).toBe("340 <:buffunfa:123456789012345678>");
  });

  it("cai para o texto puro sem id, nunca para um emoji quebrado", () => {
    expect(formatBuffunfa(340n, null)).toBe("340 BUF");
    expect(buffunfaEmojiMention(null)).toBeNull();
  });

  it("nunca abrevia, com ou sem emoji (F6-5)", () => {
    expect(formatBuffunfa(12_500n, null)).toBe("12.500 BUF");
    expect(formatBuffunfa(12_500n, "1")).toBe("12.500 <:buffunfa:1>");
  });
});
