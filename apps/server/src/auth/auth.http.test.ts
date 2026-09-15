import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, hashSessionToken, listRoles, runMigrations, schema, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { DISCORD_OAUTH_CLIENT, type DiscordOAuthClient, type DiscordUser } from "./discord-oauth.client.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de auth não podem ser pulados");

const GUILD_ID = "123456789012345678";
const PUBLIC_URL = "http://localhost:3000";
const MEMBER: DiscordUser = { id: "300000000000000001", username: "membro", globalName: "Membro Um", avatar: "abc" };
const OUTSIDER: DiscordUser = { id: "300000000000000002", username: "forasteiro", globalName: null, avatar: null };
const ADMIN: DiscordUser = { id: "300000000000000003", username: "chefe", globalName: null, avatar: null };

/** Discord falso: `code` = id do usuário; só MEMBER e ADMIN estão na guild. */
class FakeDiscord implements DiscordOAuthClient {
  calls: string[] = [];
  failExchange = false;
  async exchangeCode(code: string, redirectUri: string) {
    this.calls.push(`exchange:${code}:${redirectUri}`);
    if (this.failExchange) throw new Error("HTTP 400");
    return `token-${code}`;
  }
  async getUser(accessToken: string) {
    const id = accessToken.replace("token-", "");
    return [MEMBER, OUTSIDER, ADMIN].find((u) => u.id === id)!;
  }
  async isGuildMember(accessToken: string, guildId: string) {
    return guildId === GUILD_ID && accessToken !== `token-${OUTSIDER.id}`;
  }
}

/** Banco próprio deste arquivo: os testes do @albion-hub/db recriam o schema do banco base em paralelo. */
function isolatedUrl(url: string) {
  const parsed = new URL(url);
  const name = `${parsed.pathname.slice(1)}_server_auth`;
  const target = new URL(url);
  target.pathname = `/${name}`;
  return { name, url: target.toString() };
}

describe.skipIf(!baseUrl)("auth Discord OAuth HTTP (TASK-008, Postgres real + Discord falso)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  const discord = new FakeDiscord();

  beforeAll(async () => {
    const target = isolatedUrl(baseUrl!);
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${target.name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${target.name}"`));
    await admin.close();
    await runMigrations(target.url);
    handle = createDb(target.url);

    const parsed = parseEnv({
      DISCORD_TOKEN: "a.b.c",
      GUILD_ID,
      DATABASE_URL: target.url,
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      PUBLIC_URL,
      SESSION_TTL_DAYS: "30",
      BOOTSTRAP_ADMIN_DISCORD_IDS: ADMIN.id,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] })
      .overrideProvider(DISCORD_OAUTH_CLIENT)
      .useValue(discord)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  beforeEach(() => {
    discord.calls = [];
    discord.failExchange = false;
  });

  const http = () => request(app.getHttpServer());
  const setCookies = (res: request.Response): string[] => {
    const raw = res.headers["set-cookie"] as unknown;
    return Array.isArray(raw) ? (raw as string[]) : [];
  };
  const cookieValue = (res: request.Response, name: string) => {
    const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
    return line?.slice(name.length + 1).split(";")[0];
  };

  /** Faz o vai-e-volta: /discord → callback com o state do cookie. */
  async function login(code: string, extra: { state?: string; query?: string } = {}) {
    const start = await http().get("/api/auth/discord");
    const state = cookieValue(start, "ah_oauth_state")!;
    const qs = extra.query ?? `code=${code}&state=${extra.state ?? state}`;
    return { start, state, callback: await http().get(`/api/auth/discord/callback?${qs}`).set("Cookie", `ah_oauth_state=${state}`) };
  }

  const sessionCount = async (discordId: string) => {
    const rows = await handle.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.users.discordId, discordId));
    return rows.length;
  };

  it("GET /api/auth/discord redireciona ao Discord com state e grava cookie httpOnly do state (AC#4)", async () => {
    const { start, state } = await login(MEMBER.id);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.origin).toBe("https://discord.com");
    expect(location.searchParams.get("state")).toBe(state);
    expect(location.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/api/auth/discord/callback`);
    expect(location.searchParams.get("scope")).toBe("identify guilds.members.read");
    const stateCookie = setCookies(start).find((c) => c.startsWith("ah_oauth_state="))!;
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/SameSite=Lax/);
    expect(stateCookie).toMatch(/Path=\/api\/auth\/discord/);
  });

  it("membro da guild conclui login, recebe sessão em cookie httpOnly e vira member (AC#1, AC#4)", async () => {
    const { callback } = await login(MEMBER.id);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/carteira");
    const cookie = setCookies(callback).find((c) => c.startsWith("ah_session="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/); // NODE_ENV=test; produção coberto em domain/auth.test.ts
    expect(cookie).toMatch(/Max-Age=2592000/);
    // state é de uso único: cookie apagado no callback
    expect(setCookies(callback).some((c) => c.startsWith("ah_oauth_state=;"))).toBe(true);
    expect(discord.calls).toEqual([`exchange:${MEMBER.id}:${PUBLIC_URL}/api/auth/discord/callback`]);

    const token = cookieValue(callback, "ah_session")!;
    const [session] = await handle.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
    expect(session).toBeDefined();

    const me = await http().get("/api/auth/me").set("Cookie", `ah_session=${token}`);
    expect(me.status).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.body).toEqual({
      user: { id: session!.userId, discordId: MEMBER.id, username: "membro", displayName: "Membro Um", avatar: "abc" },
      roles: ["member"],
    });
  });

  it("não membro é recusado com código nao-membro (mensagem PT-BR na SPA) e não ganha usuário nem sessão (AC#2)", async () => {
    const { callback } = await login(OUTSIDER.id);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/entrar?erro=nao-membro");
    expect(setCookies(callback).some((c) => c.startsWith("ah_session="))).toBe(false);
    expect(await handle.db.select().from(schema.users).where(eq(schema.users.discordId, OUTSIDER.id))).toHaveLength(0);
  });

  it("state divergente ou ausente é recusado sem chamar o Discord (AC#4)", async () => {
    const mismatch = await login(MEMBER.id, { state: "outro-state" });
    expect(mismatch.callback.headers.location).toBe("/entrar?erro=oauth");
    const noCookie = await http().get(`/api/auth/discord/callback?code=${MEMBER.id}&state=${mismatch.state}`);
    expect(noCookie.headers.location).toBe("/entrar?erro=oauth");
    expect(setCookies(noCookie).some((c) => c.startsWith("ah_session="))).toBe(false);
    expect(discord.calls).toEqual([]);
  });

  it("usuário que cancela no Discord volta com código cancelado; falha do Discord vira oauth", async () => {
    const denied = await login(MEMBER.id, { query: "" });
    const cancel = await http()
      .get(`/api/auth/discord/callback?error=access_denied&state=${denied.state}`)
      .set("Cookie", `ah_oauth_state=${denied.state}`);
    expect(cancel.headers.location).toBe("/entrar?erro=cancelado");

    const noCode = await login(MEMBER.id, { query: "" });
    const missing = await http().get(`/api/auth/discord/callback?state=${noCode.state}`).set("Cookie", `ah_oauth_state=${noCode.state}`);
    expect(missing.headers.location).toBe("/entrar?erro=oauth");

    discord.failExchange = true;
    const { callback } = await login(MEMBER.id);
    expect(callback.headers.location).toBe("/entrar?erro=oauth");
    expect(setCookies(callback).some((c) => c.startsWith("ah_session="))).toBe(false);
  });

  it("id em BOOTSTRAP_ADMIN_DISCORD_IDS ganha member e admin; relogin não duplica papéis e troca a sessão", async () => {
    const first = await login(ADMIN.id);
    const token = cookieValue(first.callback, "ah_session")!;
    const again = await http()
      .get(`/api/auth/discord/callback?code=${ADMIN.id}&state=${first.state}`)
      .set("Cookie", `ah_oauth_state=${first.state}; ah_session=${token}`);
    expect(again.headers.location).toBe("/carteira");
    expect(cookieValue(again, "ah_session")).not.toBe(token);
    expect((await http().get("/api/auth/me").set("Cookie", `ah_session=${token}`)).status).toBe(401);
    const [user] = await handle.db.select().from(schema.users).where(eq(schema.users.discordId, ADMIN.id));
    expect(await listRoles(handle.db, user!.id)).toEqual(["member", "admin"]);
    expect(await sessionCount(ADMIN.id)).toBe(1);
  });

  it("GET /api/auth/me responde 401 sem cookie ou com token inválido", async () => {
    expect((await http().get("/api/auth/me")).status).toBe(401);
    const invalid = await http().get("/api/auth/me").set("Cookie", "ah_session=inventado");
    expect(invalid.status).toBe(401);
    expect(invalid.body.message).toBe("Sessão inválida ou expirada. Entre de novo.");
  });

  it("logout do mesmo site revoga a sessão e limpa o cookie; me vira 401 (AC#3)", async () => {
    const { callback } = await login(MEMBER.id);
    const token = cookieValue(callback, "ah_session")!;
    const logout = await http().post("/api/auth/logout").set("Cookie", `ah_session=${token}`).set("Origin", PUBLIC_URL);
    expect(logout.status).toBe(204);
    expect(setCookies(logout).some((c) => c.startsWith("ah_session=;") && /Path=\//.test(c))).toBe(true);
    expect((await http().get("/api/auth/me").set("Cookie", `ah_session=${token}`)).status).toBe(401);
    const [row] = await handle.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
    expect(row).toBeUndefined();

    const fetchMeta = await http().post("/api/auth/logout").set("Sec-Fetch-Site", "same-origin");
    expect(fetchMeta.status).toBe(204);
  });

  it("logout de outra origem (CSRF) é recusado com 403 e a sessão continua válida (AC#4)", async () => {
    const { callback } = await login(MEMBER.id);
    const token = cookieValue(callback, "ah_session")!;
    const crossSite = await http().post("/api/auth/logout").set("Cookie", `ah_session=${token}`).set("Sec-Fetch-Site", "cross-site").set("Origin", "https://evil.example");
    expect(crossSite.status).toBe(403);
    const foreignOrigin = await http().post("/api/auth/logout").set("Cookie", `ah_session=${token}`).set("Origin", "https://evil.example");
    expect(foreignOrigin.status).toBe(403);
    const noHeaders = await http().post("/api/auth/logout").set("Cookie", `ah_session=${token}`);
    expect(noHeaders.status).toBe(403);
    expect((await http().get("/api/auth/me").set("Cookie", `ah_session=${token}`)).status).toBe(200);
  });
});
