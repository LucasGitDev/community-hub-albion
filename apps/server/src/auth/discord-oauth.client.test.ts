import { describe, expect, it } from "vitest";
import { DiscordApiError, FetchDiscordOAuthClient } from "./discord-oauth.client.js";

type Call = { url: string; init?: RequestInit };

function client(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = responses.shift()!;
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, discord: new FetchDiscordOAuthClient({ clientId: "1", clientSecret: "s3cr3t" }, fetchImpl) };
}

describe("FetchDiscordOAuthClient", () => {
  it("troca code por token enviando form com credenciais", async () => {
    const { calls, discord } = client([[200, { access_token: "tok", token_type: "Bearer" }]]);
    expect(await discord.exchangeCode("c0de", "http://localhost:3000/api/auth/discord/callback")).toBe("tok");
    expect(calls[0]!.url).toBe("https://discord.com/api/v10/oauth2/token");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(Object.fromEntries(calls[0]!.init?.body as URLSearchParams)).toMatchObject({ grant_type: "authorization_code", code: "c0de", client_secret: "s3cr3t" });
  });

  it("erro na troca não expõe corpo da resposta", async () => {
    const { discord } = client([[400, { error: "invalid_grant", echo: "s3cr3t" }]]);
    const error = await discord.exchangeCode("x", "y").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscordApiError);
    expect((error as Error).message).toBe("troca de code falhou: HTTP 400");
  });

  it("lê usuário com bearer token", async () => {
    const { calls, discord } = client([[200, { id: "300000000000000001", username: "membro", global_name: null, avatar: null }]]);
    expect(await discord.getUser("tok")).toEqual({ id: "300000000000000001", username: "membro", globalName: null, avatar: null });
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const failing = client([[401, {}]]);
    await expect(failing.discord.getUser("tok")).rejects.toThrow("HTTP 401");
  });

  it("membro: 200 = true, 404 = false, outro status = erro", async () => {
    const { calls, discord } = client([[200, { roles: [] }], [404, { code: 10004 }], [429, {}]]);
    expect(await discord.isGuildMember("tok", "123456789012345678")).toBe(true);
    expect(calls[0]!.url).toBe("https://discord.com/api/v10/users/@me/guilds/123456789012345678/member");
    expect(await discord.isGuildMember("tok", "123456789012345678")).toBe(false);
    await expect(discord.isGuildMember("tok", "123456789012345678")).rejects.toThrow("HTTP 429");
  });
});
