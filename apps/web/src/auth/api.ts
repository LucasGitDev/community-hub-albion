import type { Role } from "@albion-hub/shared";

export interface Me {
  user: { id: string; discordId: string; username: string; displayName: string | null; avatar: string | null };
  roles: Role[];
}

/** Sessão atual via cookie httpOnly. 401 = deslogado. */
export async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin", signal, headers: { Accept: "application/json" } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Falha ao carregar sessão (HTTP ${res.status})`);
  return (await res.json()) as Me;
}

export async function logoutRequest(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!res.ok && res.status !== 401) throw new Error(`Falha ao sair (HTTP ${res.status})`);
}

/** Inicia o OAuth no server (redirect pro Discord). */
export const DISCORD_LOGIN_URL = "/api/auth/discord";
