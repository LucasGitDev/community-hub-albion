import { createHash, randomBytes } from "node:crypto";

/** Token opaco do cookie: 32 bytes aleatórios (256 bits) em base64url. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash persistido no banco (sha256 hex). Token com alta entropia dispensa salt/KDF lento. */
export function hashSessionToken(token: string): string {
  if (!token) throw new Error("token de sessão vazio");
  return createHash("sha256").update(token).digest("hex");
}

/** Sessão expirada quando `now >= expiresAt`. */
export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}
