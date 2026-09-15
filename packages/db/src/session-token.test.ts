import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken, isSessionExpired } from "./session-token.js";

describe("session-token", () => {
  it("gera tokens base64url de 256 bits, distintos", () => {
    const a = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(a);
  });

  it("hash é sha256 hex determinístico e não contém o token", () => {
    const h = hashSessionToken("abc");
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashSessionToken("abc")).toBe(h);
    expect(hashSessionToken("abd")).not.toBe(h);
  });

  it("rejeita token vazio", () => {
    expect(() => hashSessionToken("")).toThrow("vazio");
  });

  it("expira quando now >= expiresAt", () => {
    const exp = new Date("2026-01-01T00:00:00Z");
    expect(isSessionExpired(exp, new Date("2025-12-31T23:59:59Z"))).toBe(false);
    expect(isSessionExpired(exp, exp)).toBe(true);
    expect(isSessionExpired(new Date(Date.now() - 1))).toBe(true);
  });
});
