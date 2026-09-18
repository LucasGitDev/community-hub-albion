import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, requestNick, runMigrations, schema, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { AlbionLookupResult, Role } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { NickDecisionService, type NickDecidedEvent } from "./nick-decision.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP da fila de nick não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const timeline = new FakeTimelinePublisher();
const CHECKED_AT = "2026-09-15T12:00:00.000Z";

/** Consulta Albion falsa (nunca chama a API real): por nick; o resto fica indisponível. */
const albionResults = new Map<string, AlbionLookupResult>();
const fakeAlbion = { lookup: async (nick: string): Promise<AlbionLookupResult> => albionResults.get(nick) ?? { status: "unavailable", region: "americas", checkedAt: CHECKED_AT } };

describe.skipIf(!baseUrl)("fila de nick da staff HTTP (TASK-013, Q14/Q31)", () => {
  let app: INestApplication;
  let handle: DbHandle;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_staff_nick`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false, timeline })] })
      .overrideProvider(ALBION_PLAYER_LOOKUP)
      .useValue(fakeAlbion)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function login(discordId: string, roles: Role[], gameNick: string | null = null) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}`, displayName: `Nome${discordId.slice(-3)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (gameNick) await setGameNick(handle.db, user.id, gameNick);
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { user, cookie: `ah_session=${token}` };
  }

  const http = () => request(app.getHttpServer());
  const decide = (cookie: string | null, id: string, action: "approve" | "reject", body: unknown = {}, origin = PUBLIC_URL) => {
    const req = http().post(`/api/staff/nick-requests/${id}/${action}`).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body as object);
  };
  const pendingOf = async (discordId: string, nick: string, gameNick: string | null = null) => {
    const { user, cookie } = await login(discordId, ["member"], gameNick);
    const { request: r } = await requestNick(handle.db, user.id, nick);
    return { user, cookie, request: r };
  };
  const rowOf = async (id: string) => (await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.id, id)))[0]!;

  it("sem sessão 401; membro comum 403 na fila e nas decisões (AC#3)", async () => {
    const { request: r, cookie } = await pendingOf("610000000000000001", "SemAcesso");
    expect((await http().get("/api/staff/nick-requests")).status).toBe(401);
    expect((await decide(null, r.id, "approve")).status).toBe(401);
    expect((await http().get("/api/staff/nick-requests").set("Cookie", cookie)).status).toBe(403);
    expect((await decide(cookie, r.id, "approve")).status).toBe(403);
    expect((await decide(cookie, r.id, "reject", { note: "não" })).status).toBe(403);
    expect((await rowOf(r.id)).status).toBe("pending");
  });

  it("staff lista pendentes com quem pediu, nick atual e pedido (AC#1)", async () => {
    const { user, request: r } = await pendingOf("610000000000000002", "NovoNick", "VelhoNick");
    const { cookie } = await login("610000000000000102", ["staff"]);
    const res = await http().get("/api/staff/nick-requests").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.requests).toContainEqual({
      id: r.id,
      nick: "NovoNick",
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      user: { id: user.id, displayName: "Nome002", discordUsername: "u002", gameNick: "VelhoNick" },
      albion: { status: "unavailable", region: "americas", checkedAt: CHECKED_AT },
    });
  });

  it("fila mostra se o nick foi encontrado no Albion da região (TASK-016 AC#1)", async () => {
    const found: AlbionLookupResult = { status: "found", region: "americas", playerId: "p1", name: "AchadoNoJogo", guildName: "Guilda X", checkedAt: CHECKED_AT };
    albionResults.set("AchadoNoJogo", found);
    albionResults.set("Fantasma", { status: "not_found", region: "americas", checkedAt: CHECKED_AT });
    const { request: a } = await pendingOf("610000000000000006", "AchadoNoJogo");
    const { request: b } = await pendingOf("610000000000000007", "Fantasma");
    const { cookie } = await login("610000000000000106", ["staff"]);
    const res = await http().get("/api/staff/nick-requests").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const byId = new Map((res.body.requests as { id: string; albion: unknown }[]).map((r) => [r.id, r.albion]));
    expect(byId.get(a.id)).toEqual(found);
    expect(byId.get(b.id)).toEqual({ status: "not_found", region: "americas", checkedAt: CHECKED_AT });
  });

  it("staff aprova: API Albion indisponível não impede (TASK-016 AC#2); nick vigente muda, auditoria gravada e listener recebe o evento (AC#1, AC#2, AC#4)", async () => {
    const events: NickDecidedEvent[] = [];
    const service = app.get(NickDecisionService);
    const off = service.onDecided((e) => void events.push(e));
    const offBroken = service.onDecided(() => {
      throw new Error("Discord fora");
    });
    const { user, cookie: memberCookie, request: r } = await pendingOf("610000000000000003", "Aprovado", "Antigo");
    const { user: staff, cookie } = await login("610000000000000103", ["staff"]);
    timeline.clear();
    const res = await decide(cookie, r.id, "approve");
    off();
    offBroken();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.id, status: "approved", decidedBy: staff.id });
    const row = await rowOf(r.id);
    expect(row).toMatchObject({ status: "approved", decidedBy: staff.id });
    expect(row.decidedAt!.toISOString()).toBe(res.body.decidedAt);
    const me = await http().get("/api/me/nick").set("Cookie", memberCookie);
    expect(me.body).toEqual({ gameNick: "Aprovado", pending: null, lastRejection: null });
    expect(events).toEqual([expect.objectContaining({ decision: "approved", previousGameNick: "Antigo", deciderUserId: staff.id })]);
    expect(events[0]!.request.userId).toBe(user.id);
    // Timeline (TASK-077): quem decidiu, quem pediu, o nick novo e o anterior.
    expect(timeline.only("account.nick_approved")).toEqual({
      action: "account.nick_approved",
      summary: "Nick aprovado: Aprovado",
      actor: { kind: "user", userId: staff.id, name: "Nome103", discordId: "610000000000000103" },
      target: { name: "Aprovado", id: user.id, discordId: "610000000000000003" },
      recordId: r.id,
      details: [
        { name: "Nick", value: "Aprovado" },
        { name: "Nick anterior", value: "Antigo" },
      ],
    });

    const again = await decide(cookie, r.id, "reject", { note: "tarde" });
    expect(again.status).toBe(409);
    expect(events).toHaveLength(1);
    // Recusa (já decidido) não publica.
    expect(timeline.actions()).toEqual(["account.nick_approved"]);
  });

  it("staff recusa com motivo: nick anterior mantido e membro vê o motivo (AC#2, AC#4)", async () => {
    const { cookie: memberCookie, request: r } = await pendingOf("610000000000000004", "Errado", "Mantido");
    const { user: staff, cookie } = await login("610000000000000104", ["staff"]);
    timeline.clear();
    const res = await decide(cookie, r.id, "reject", { note: "  Esse nick não existe no jogo. " });
    expect(res.status).toBe(200);
    expect(timeline.only("account.nick_rejected")).toMatchObject({
      summary: "Nick recusado: Errado",
      actor: { kind: "user", userId: staff.id },
      target: { name: "Mantido", id: r.userId },
      recordId: r.id,
      details: [
        { name: "Nick", value: "Errado" },
        { name: "Motivo", value: "Esse nick não existe no jogo." },
      ],
    });
    expect(res.body).toMatchObject({ status: "rejected", decidedBy: staff.id });
    expect(await rowOf(r.id)).toMatchObject({ status: "rejected", decidedBy: staff.id, decisionNote: "Esse nick não existe no jogo." });
    const me = await http().get("/api/me/nick").set("Cookie", memberCookie);
    expect(me.body).toMatchObject({ gameNick: "Mantido", pending: null, lastRejection: { nick: "Errado", note: "Esse nick não existe no jogo." } });
    expect(JSON.stringify(me.body)).not.toContain(staff.id);
  });

  it("valida id, motivo, origem e inexistente (400/403/404)", async () => {
    const { request: r } = await pendingOf("610000000000000005", "Valida");
    const { cookie } = await login("610000000000000105", ["admin"]);
    expect((await decide(cookie, "nao-uuid", "approve")).status).toBe(400);
    const noNote = await decide(cookie, r.id, "reject", {});
    expect(noNote.status).toBe(400);
    expect(noNote.body.message).toContain("motivo");
    expect((await decide(cookie, r.id, "reject", { note: "x".repeat(301) })).status).toBe(400);
    expect((await decide(cookie, r.id, "approve", {}, "https://evil.example")).status).toBe(403);
    expect((await decide(cookie, "00000000-0000-4000-8000-000000000000", "approve")).status).toBe(404);
    expect((await rowOf(r.id)).status).toBe("pending");
  });
});
