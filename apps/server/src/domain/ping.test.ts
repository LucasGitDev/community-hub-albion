import { describe, expect, it } from "vitest";
import { buildPingReply } from "./ping.js";

describe("buildPingReply", () => {
  it("responde em PT-BR com a latência arredondada", () => {
    expect(buildPingReply(41.6)).toBe("🏓 Pong! Latência do bot: 42 ms.");
  });

  it("avisa em PT-BR quando a latência ainda não foi medida", () => {
    expect(buildPingReply(-1)).toBe("🏓 Pong! Latência ainda sendo medida, tente de novo em instantes.");
    expect(buildPingReply(Number.NaN)).toContain("ainda sendo medida");
  });
});
