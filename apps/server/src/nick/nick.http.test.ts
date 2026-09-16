import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, listRoles, runMigrations, schema, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";
import { NickRequestService, type NickRequestedEvent } from "../members/nick-request.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de nick não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
/** Consulta Albion que nunca responde: prova que o pedido de nick não espera a API (TASK-016 AC#2). */
const albionCalls: string[] = [];
const hangingAlbion = { lookup: (nick: string) => (albionCalls.push(nick), new Promise<never>(() => undefined)) };

describe.skipIf(!baseUrl)("nick do usuário HTTP (TASK-012, Q14/Q31)", () => {
  let app: INestApplication;
  let handle: DbHandle;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_nick`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const parsed = parseEnv({
      DISCORD_TOKEN: "a.b.c",
      GUILD_ID: "123456789012345678",
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_MEMBER_ROLE_ID: "323456789012345678",
      DISCORD_STAFF_CHANNEL_ID: "423456789012345678",
      DISCORD_EVENTS_CHANNEL_ID: "523456789012345678",
      DISCORD_WAITING_VOICE_CHANNEL_ID: "623456789012345678",
      DISCORD_EVENT_CATEGORY_ID: "723456789012345678",
      PUBLIC_URL,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] })
      .overrideProvider(ALBION_PLAYER_LOOKUP)
      .useValue(hangingAlbion)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function member(discordId: string, gameNick: string | null = null) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` });
    await grantRole(handle.db, user.id, "member");
    if (gameNick) await handle.db.update(schema.users).set({ gameNick }).where(eq(schema.users.id, user.id));
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { user, cookie: `ah_session=${token}` };
  }

  const post = (cookie: string | null, body: unknown, origin = PUBLIC_URL) => {
    const req = request(app.getHttpServer()).post("/api/me/nick").set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body as object);
  };

  it("API Albion travada não atrasa o pedido de nick; consulta é disparada em segundo plano (TASK-016 AC#2)", async () => {
    const { cookie } = await member("600000000000000077");
    const res = await post(cookie, { nick: "SemEspera" }).timeout(2_000);
    expect(res.status).toBe(201);
    expect(albionCalls).toContain("SemEspera");
  });

  it("sem sessão: 401 no GET e no POST", async () => {
    expect((await request(app.getHttpServer()).get("/api/me/nick")).status).toBe(401);
    expect((await post(null, { nick: "Ravenmoor" })).status).toBe(401);
  });

  it("usuário logado sem papel não pede nick (403)", async () => {
    const user = await upsertUserByDiscordId(handle.db, { discordId: "600000000000000009", discordUsername: "semPapel" });
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    expect((await post(`ah_session=${token}`, { nick: "SemPapel" })).status).toBe(403);
  });

  it("envia nick e a solicitação fica pending (AC#1)", async () => {
    const { cookie } = await member("600000000000000001");
    const empty = await request(app.getHttpServer()).get("/api/me/nick").set("Cookie", cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ gameNick: null, pending: null, lastRejection: null });

    const res = await post(cookie, { nick: "  Ravenmoor " });
    expect(res.status).toBe(201);
    expect(res.body.pending).toMatchObject({ nick: "Ravenmoor", status: "pending" });

    const after = await request(app.getHttpServer()).get("/api/me/nick").set("Cookie", cookie);
    expect(after.headers["cache-control"]).toBe("no-store");
    expect(after.body.pending.nick).toBe("Ravenmoor");
  });

  it("segunda solicitação troca o nick da pendente, sem duplicar (AC#2)", async () => {
    const { user, cookie } = await member("600000000000000002");
    const first = await post(cookie, { nick: "Thalya" });
    const second = await post(cookie, { nick: "ThalyaReal" });
    expect(second.status).toBe(200);
    expect(second.body.pending.id).toBe(first.body.pending.id);
    const rows = await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.userId, user.id));
    expect(rows.map((r) => [r.nick, r.status])).toEqual([["ThalyaReal", "pending"]]);
  });

  it("membro aprovado pede troca: pendência criada, nick vigente e acesso mantidos (AC#3)", async () => {
    const { user, cookie } = await member("600000000000000003", "Grimwald");
    const res = await post(cookie, { nick: "GrimwaldII" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ gameNick: "Grimwald", pending: { nick: "GrimwaldII", status: "pending" } });
    expect(await listRoles(handle.db, user.id)).toEqual(["member"]);
    const me = await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    const status = await request(app.getHttpServer()).get("/api/me/nick").set("Cookie", cookie);
    expect(status.body.gameNick).toBe("Grimwald");
  });

  it("recusa nick inválido (400), igual ao vigente (409) e outra origem (403)", async () => {
    const { cookie } = await member("600000000000000004", "Kestrel");
    const bad = await post(cookie, { nick: "Kes trel!" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("só letras e números");
    expect((await post(cookie, {})).status).toBe(400);
    expect((await post(cookie, { nick: "kestrel" })).status).toBe(409);
    expect((await post(cookie, { nick: "KestrelNovo" }, "https://evil.example")).status).toBe(403);
    const status = await request(app.getHttpServer()).get("/api/me/nick").set("Cookie", cookie);
    expect(status.body.pending).toBeNull();
  });

  it("hook onRequested recebe pedido criado e corrigido; listener com erro não quebra o pedido (TASK-015)", async () => {
    const events: NickRequestedEvent[] = [];
    const service = app.get(NickRequestService);
    const off = service.onRequested((e) => void events.push(e));
    const offBroken = service.onRequested(() => {
      throw new Error("Discord fora");
    });
    const { cookie } = await member("600000000000015015");
    expect((await post(cookie, { nick: "Gancho" })).status).toBe(201);
    expect((await post(cookie, { nick: "GanchoDois" })).status).toBe(200);
    off();
    offBroken();
    expect(events.map((e) => [e.created, e.request.nick])).toEqual([
      [true, "Gancho"],
      [false, "GanchoDois"],
    ]);
    expect(events[0]!.request.id).toBe(events[1]!.request.id);
  });
});
