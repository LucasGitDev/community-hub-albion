import { z } from "zod";

export const DISCORD_OAUTH_CLIENT = Symbol("DISCORD_OAUTH_CLIENT");

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

/** Toda chamada HTTP ao Discord no login passa por aqui (testes injetam um fake). */
export interface DiscordOAuthClient {
  /** Troca o `code` do callback por access token. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  getUser(accessToken: string): Promise<DiscordUser>;
  /** true se o dono do token é membro da guild; false se o Discord responde 404. */
  isGuildMember(accessToken: string, guildId: string): Promise<boolean>;
}

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
});

export class DiscordApiError extends Error {}

export class FetchDiscordOAuthClient implements DiscordOAuthClient {
  constructor(
    private readonly credentials: { clientId: string; clientSecret: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const response = await this.fetchImpl(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Nunca inclui corpo da resposta no erro (pode ecoar dados sensíveis).
    if (!response.ok) throw new DiscordApiError(`troca de code falhou: HTTP ${response.status}`);
    return tokenSchema.parse(await response.json()).access_token;
  }

  async getUser(accessToken: string): Promise<DiscordUser> {
    const response = await this.get("/users/@me", accessToken);
    if (!response.ok) throw new DiscordApiError(`/users/@me falhou: HTTP ${response.status}`);
    const user = userSchema.parse(await response.json());
    return { id: user.id, username: user.username, globalName: user.global_name ?? null, avatar: user.avatar ?? null };
  }

  async isGuildMember(accessToken: string, guildId: string): Promise<boolean> {
    const response = await this.get(`/users/@me/guilds/${encodeURIComponent(guildId)}/member`, accessToken);
    if (response.status === 404) return false;
    if (!response.ok) throw new DiscordApiError(`checagem de membro falhou: HTTP ${response.status}`);
    return true;
  }

  private get(path: string, accessToken: string) {
    return this.fetchImpl(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
