import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LoginErrorCode, Role } from "@albion-hub/shared";

/** Cookie da sessão do painel (token opaco; banco guarda só o hash). */
export const SESSION_COOKIE = "ah_session";
/** Cookie do `state` OAuth (proteção CSRF do login), vive só durante o vai-e-volta no Discord. */
export const STATE_COOKIE = "ah_oauth_state";
const STATE_COOKIE_PATH = "/api/auth/discord";
const STATE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_SUCCESS_PATH = "/carteira";
const CALLBACK_PATH = "/api/auth/discord/callback";
/** `identify` = perfil; `guilds.members.read` = checar membro de GUILD_ID sem listar todas as guilds do usuário. */
const OAUTH_SCOPES = ["identify", "guilds.members.read"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

type NodeEnv = "development" | "test" | "production";

/** 256 bits aleatórios em base64url. */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Compara o state do cookie com o da query em tempo constante (hash iguala os tamanhos). */
export function verifyOAuthState(expected: string | undefined, received: unknown): boolean {
  if (!expected || typeof received !== "string" || !received) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(received));
}

/** Lê o header Cookie sem dependência extra. Valores malformados são ignorados. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      // valor com escape inválido: ignora
    }
  }
  return cookies;
}

/** httpOnly + SameSite=Lax sempre; `secure` em produção (PUBLIC_URL https é exigido lá). */
export function sessionCookieOptions(nodeEnv: NodeEnv, ttlDays: number): CookieOptions {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: "/", maxAge: ttlDays * DAY_MS };
}

export function stateCookieOptions(nodeEnv: NodeEnv): CookieOptions {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: STATE_COOKIE_PATH, maxAge: STATE_TTL_MS };
}

/** Mesmos atributos sem `maxAge`: o navegador só apaga cookie com nome, path e flags iguais. */
export function clearCookieOptions(options: CookieOptions): Omit<CookieOptions, "maxAge"> {
  return { httpOnly: options.httpOnly, secure: options.secure, sameSite: options.sameSite, path: options.path };
}

export function sessionExpiresAt(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

export function buildRedirectUri(publicUrl: string): string {
  return `${publicUrl}${CALLBACK_PATH}`;
}

export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    scope: OAUTH_SCOPES.join(" "),
    redirect_uri: input.redirectUri,
    state: input.state,
    prompt: "none",
  }).toString();
  return url.toString();
}

/** Destino da SPA em caso de falha; a mensagem PT-BR vem de `loginErrorMessage` (@albion-hub/shared). */
export function loginErrorPath(code: LoginErrorCode): string {
  return `/entrar?erro=${code}`;
}

/** `error` devolvido pelo Discord no callback: usuário negou = cancelado; resto = falha genérica. */
export function callbackErrorCode(error: unknown): LoginErrorCode {
  return error === "access_denied" ? "cancelado" : "oauth";
}

/**
 * Proteção CSRF de rotas que mudam estado (logout). Além do SameSite=Lax do cookie, exige
 * requisição do próprio site: `Sec-Fetch-Site: same-origin` quando o navegador envia, senão `Origin`
 * igual a PUBLIC_URL. Sem nenhum dos dois headers, recusa.
 */
export function isSameOriginRequest(headers: { origin?: string; secFetchSite?: string }, publicUrl: string): boolean {
  if (headers.secFetchSite) return headers.secFetchSite === "same-origin";
  if (!headers.origin) return false;
  try {
    return new URL(headers.origin).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

/** Todo membro da guild ganha `member`; ids do bootstrap ganham também `admin`. */
export function rolesForLogin(discordId: string, bootstrapAdminIds: readonly string[]): Role[] {
  return bootstrapAdminIds.includes(discordId) ? ["member", "admin"] : ["member"];
}
