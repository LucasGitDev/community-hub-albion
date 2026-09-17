import { createHash, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, maintenanceTokenMatches, parseSilverAdjustment } from "./maintenance.js";

const SECRET = "token-de-manutencao-com-32-chars-ok";

describe("maintenanceTokenMatches (TASK-048, AC#1/AC#5)", () => {
  it("aceita só o token exato", () => {
    expect(maintenanceTokenMatches(SECRET, SECRET)).toBe(true);
    expect(maintenanceTokenMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(maintenanceTokenMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(maintenanceTokenMatches(SECRET.toUpperCase(), SECRET)).toBe(false);
  });

  it("recusa ausente, vazio e errado do mesmo jeito, sem lançar", () => {
    for (const received of [undefined, "", " ", "chute", "x".repeat(4096)]) {
      expect(maintenanceTokenMatches(received, SECRET)).toBe(false);
    }
  });

  it("sem token configurado nada passa, nem string vazia nem undefined", () => {
    for (const expected of [undefined, ""]) {
      for (const received of [undefined, "", SECRET]) expect(maintenanceTokenMatches(received, expected)).toBe(false);
    }
  });

  it("compara em tempo constante: digests de tamanho igual e nenhum === entre segredos", async () => {
    const a = createHash("sha256").update("curto").digest();
    const b = createHash("sha256").update("x".repeat(9999)).digest();
    expect(a.length).toBe(b.length);
    expect(timingSafeEqual(a, b)).toBe(false);
    // E o código fonte não compara os segredos com ===.
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./maintenance.ts", import.meta.url), "utf8"));
    expect(source).toContain("timingSafeEqual");
    expect(source).not.toMatch(/received\s*===\s*expected/);
  });
});

describe("FixedWindowRateLimiter (TASK-048, rate limit)", () => {
  it("libera até o limite e depois recusa com espera em segundos", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) expect(limiter.take(1_000).allowed).toBe(true);
    const blocked = limiter.take(1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("abre a janela de novo quando ela expira", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);
    expect(limiter.take(0).allowed).toBe(true);
    expect(limiter.take(0).allowed).toBe(true);
    expect(limiter.take(500).allowed).toBe(false);
    expect(limiter.take(1_000).allowed).toBe(true);
  });

  it("espera nunca é zero enquanto está bloqueado", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);
    limiter.take(0);
    expect(limiter.take(999).retryAfterSeconds).toBe(1);
  });
});

describe("parseSilverAdjustment (TASK-048, AC#2)", () => {
  it("aceita prata inteira em string, positiva ou negativa, com motivo", () => {
    expect(parseSilverAdjustment({ amount: "1500000", reason: "acerto do split 12" })).toEqual({ ok: true, amount: 1_500_000n, reason: "acerto do split 12" });
    expect(parseSilverAdjustment({ amount: " -42 ", reason: " estorno manual " })).toEqual({ ok: true, amount: -42n, reason: "estorno manual" });
  });

  it("exige motivo não vazio", () => {
    for (const reason of [undefined, "", "   ", 7]) {
      const parsed = parseSilverAdjustment({ amount: "10", reason });
      expect(parsed).toMatchObject({ ok: false });
      expect(!parsed.ok && parsed.error).toContain("reason");
    }
  });

  it("recusa zero, float, número cru e texto", () => {
    for (const amount of ["0", "-0", "1.5", 10, "1e6", "abc", "", undefined, "9".repeat(19)]) {
      expect(parseSilverAdjustment({ amount, reason: "motivo" })).toMatchObject({ ok: false });
    }
  });

  it("recusa motivo gigante", () => {
    expect(parseSilverAdjustment({ amount: "10", reason: "x".repeat(201) })).toMatchObject({ ok: false });
  });
});
