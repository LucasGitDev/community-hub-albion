import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  clearCookieOptions,
  callbackErrorCode,
  generateOAuthState,
  isSameOriginRequest,
  loginErrorPath,
  parseCookies,
  rolesForLogin,
  sessionCookieOptions,
  sessionExpiresAt,
  stateCookieOptions,
  verifyOAuthState,
} from "./auth.js";

describe("state OAuth (TASK-008 AC#4)", () => {
  it("gera state aleatório de 256 bits em base64url", () => {
    const a = generateOAuthState();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(generateOAuthState()).not.toBe(a);
  });

  it("aceita só state idêntico ao do cookie", () => {
    const state = generateOAuthState();
    expect(verifyOAuthState(state, state)).toBe(true);
    expect(verifyOAuthState(state, `${state}x`)).toBe(false);
    expect(verifyOAuthState(state, "curto")).toBe(false);
  });

  it.each([[undefined, "a"], ["", "a"], ["a", undefined], ["a", ""], ["a", ["a"]]])("recusa state ausente/inválido (%j, %j)", (expected, received) => {
    expect(verifyOAuthState(expected, received)).toBe(false);
  });
});

describe("cookies", () => {
  it("parseia header Cookie, ignora malformados e mantém o primeiro valor", () => {
    expect(parseCookies("a=1; b=x%20y; =z; semvalor; c=%E0%A4%A; a=2")).toEqual({ a: "1", b: "x y" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("sessão: httpOnly, SameSite=Lax, path / e secure só em produção (AC#4)", () => {
    expect(sessionCookieOptions("production", 30)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 86_400_000 });
    expect(sessionCookieOptions("development", 1).secure).toBe(false);
    expect(sessionCookieOptions("test", 1).secure).toBe(false);
  });

  it("state: curto e restrito ao caminho do OAuth", () => {
    expect(stateCookieOptions("production")).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/discord", maxAge: 600_000 });
  });

  it("limpeza reaproveita flags sem maxAge", () => {
    expect(clearCookieOptions(sessionCookieOptions("production", 30))).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("expiração da sessão alinhada ao TTL", () => {
    expect(sessionExpiresAt(new Date("2026-01-01T00:00:00Z"), 30).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("URLs do OAuth", () => {
  it("monta authorize com scopes, redirect e state", () => {
    const url = new URL(buildAuthorizeUrl({ clientId: "123456789012345678", redirectUri: buildRedirectUri("http://localhost:3000"), state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "123456789012345678",
      scope: "identify guilds.members.read",
      redirect_uri: "http://localhost:3000/api/auth/discord/callback",
      state: "s1",
      prompt: "none",
    });
  });

  it("erro vira código estável na URL da SPA", () => {
    expect(loginErrorPath("nao-membro")).toBe("/entrar?erro=nao-membro");
    expect(callbackErrorCode("access_denied")).toBe("cancelado");
    expect(callbackErrorCode("server_error")).toBe("oauth");
  });
});

describe("CSRF de logout: isSameOriginRequest", () => {
  const pub = "https://painel.exemplo.com";
  it.each([
    [{ secFetchSite: "same-origin" }, true],
    [{ secFetchSite: "cross-site", origin: pub }, false],
    [{ secFetchSite: "same-site" }, false],
    [{ origin: pub }, true],
    [{ origin: "https://evil.exemplo" }, false],
    [{ origin: "null" }, false],
    [{}, false],
  ])("%j → %s", (headers, expected) => {
    expect(isSameOriginRequest(headers, pub)).toBe(expected);
  });
});

describe("papéis no login (Q13)", () => {
  it("membro recebe member; bootstrap recebe também admin", () => {
    expect(rolesForLogin("111111111111111111", [])).toEqual(["member"]);
    expect(rolesForLogin("111111111111111111", ["111111111111111111"])).toEqual(["member", "admin"]);
  });
});
