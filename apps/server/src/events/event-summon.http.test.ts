import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { EVENT_SUMMON_REPLIES } from "../domain/event-summon.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";
import type { EventSummoner, SummonEventResult } from "./event-summoner.token.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: o endpoint do chamado não pode ser pulado");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";

/**
 * Chamar quem não entrou na call pelo **menu do evento no painel** (TASK-087, PE15, AC#4).
 *
 * O endpoint não tem regra própria: ele checa quem está logado, delega ao `EventSummoner` e traduz o
 * resultado. Por isso o teste usa um dublê do serviço — o que precisa ser provado aqui é que o painel
 * chega ao **mesmo** chamado do menu da call, com o evento e o ator certos, e que cada recusa vira o
 * status HTTP e a frase que o caller lê.
 */
describe.skipIf(!baseUrl)("chamado pelo menu do evento no painel (TASK-087)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let otherCaller: string;
  let member: string;
  let callerId: string;
  let templateId: string;

  /** Dublê: guarda a chamada e devolve o que o teste programar. */
  const summonCalls: { eventId: string; actorUserId: string }[] = [];
  let answer: SummonEventResult = { ok: true, outcome: { notified: 2, mentioned: 1, skipped: 3, targets: 6 } };
  const summoner: EventSummoner = {
    async summon(eventId, actorUserId) {
      summonCalls.push({ eventId, actorUserId });
      return answer;
    },
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_summon_http`;
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
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(parsed.env, { bot: false, timeline: new FakeTimelinePublisher(), summoner })],
    }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");

    [staff, caller, otherCaller, member] = await Promise.all([
      login("740000000000000001", ["member", "staff"]),
      login("740000000000000002", ["member", "caller"]),
      login("740000000000000003", ["member", "caller"]),
      login("740000000000000004", ["member"]),
    ]);
    callerId = (await upsertUserByDiscordId(handle.db, { discordId: "740000000000000002", discordUsername: "u002" })).id;

    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string; name: string }[];
    const created = await request(app.getHttpServer())
      .post("/api/event-templates")
      .set("Origin", PUBLIC_URL)
      .set("Cookie", staff)
      .send({ name: "Template do chamado", description: null, minPartySize: 1, maxPartySize: null, active: true, roles: [{ roleId: roles[0]!.id, slots: 2, buffunfaMin: "0", buffunfaMax: "0" }] });
    expect(created.status).toBe(201);
    templateId = created.body.id as string;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  beforeEach(() => {
    summonCalls.length = 0;
    answer = { ok: true, outcome: { notified: 2, mentioned: 1, skipped: 3, targets: 6 } };
  });

  async function login(discordId: string, roles: Role[]) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return `ah_session=${token}`;
  }

  const http = () => request(app.getHttpServer());
  const summon = (cookie: string | null, id: string, origin = PUBLIC_URL) => {
    const req = http().post(`/api/events/${id}/summon`).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send({});
  };
  const newEvent = async () => {
    const res = await http().post("/api/events").set("Origin", PUBLIC_URL).set("Cookie", caller).send({ templateId, name: "Roads das 21h" });
    expect(res.status).toBe(201);
    return res.body as EventDto;
  };

  it("AC#4: o caller aciona o chamado pelo painel e recebe a conta do que foi feito", async () => {
    const event = await newEvent();

    const res = await summon(caller, event.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notified: 2, mentioned: 1, skipped: 3, targets: 6 });
    // É o mesmo serviço do menu da call, com o evento clicado e quem está logado como ator.
    expect(summonCalls).toEqual([{ eventId: event.id, actorUserId: callerId }]);
  });

  it("a staff também aciona em evento alheio; caller de outro evento e membro tomam 403", async () => {
    const event = await newEvent();

    expect((await summon(staff, event.id)).status).toBe(200);

    // Caller de outro evento passa pelo guard (é caller) e para na condição de dono do CASL...
    const otherDenied = await summon(otherCaller, event.id);
    expect(otherDenied.status).toBe(403);
    expect(otherDenied.body.message).toContain("owner do evento ou a staff");
    // ...e quem é só membro nem chega lá: o guard recusa antes, porque `update` em Event não é dele.
    expect((await summon(member, event.id)).status).toBe(403);
    // Nenhuma recusa chegou a acionar o chamado.
    expect(summonCalls).toHaveLength(1);
  });

  it("evento fora de andamento vira 409 com a frase do chamado, e sem canal também", async () => {
    const event = await newEvent();

    answer = { ok: false, reason: "not_running" };
    const notRunning = await summon(caller, event.id);
    expect(notRunning.status).toBe(409);
    expect(notRunning.body.message).toBe(EVENT_SUMMON_REPLIES.notRunning);

    answer = { ok: false, reason: "no_channel" };
    const noChannel = await summon(caller, event.id);
    expect(noChannel.status).toBe(409);
    expect(noChannel.body.message).toBe(EVENT_SUMMON_REPLIES.noChannel);
  });

  it("sem sessão 401, de outra origem 403 e evento inexistente 404 — nada chega ao serviço", async () => {
    const event = await newEvent();
    expect((await summon(null, event.id)).status).toBe(401);
    expect((await summon(caller, event.id, "http://evil.example")).status).toBe(403);
    expect((await summon(caller, MISSING)).status).toBe(404);
    expect((await summon(caller, "nao-uuid")).status).toBe(400);
    expect(summonCalls).toEqual([]);
  });
});

/** Sem bot ligado o token do chamado não existe: a API recusa com texto claro em vez de quebrar. */
describe.skipIf(!baseUrl)("chamado sem o bot do Discord ligado (TASK-087)", () => {
  let app: INestApplication;
  let handle: DbHandle;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_summon_nobot`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false, timeline: new FakeTimelinePublisher() })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  it("responde 503 com a frase do bot desligado", async () => {
    const user = await upsertUserByDiscordId(handle.db, { discordId: "750000000000000001", discordUsername: "u1" });
    for (const role of ["member", "staff"] as Role[]) await grantRole(handle.db, user.id, role);
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));

    const roles = (await request(app.getHttpServer()).get("/api/event-roles").set("Cookie", `ah_session=${token}`)).body.roles as { id: string }[];
    const template = await request(app.getHttpServer())
      .post("/api/event-templates")
      .set("Origin", PUBLIC_URL)
      .set("Cookie", `ah_session=${token}`)
      .send({ name: "Template sem bot", description: null, minPartySize: 1, maxPartySize: null, active: true, roles: [{ roleId: roles[0]!.id, slots: 1, buffunfaMin: "0", buffunfaMax: "0" }] });
    const event = await request(app.getHttpServer())
      .post("/api/events")
      .set("Origin", PUBLIC_URL)
      .set("Cookie", `ah_session=${token}`)
      .send({ templateId: template.body.id, name: "Evento sem bot" });

    const res = await request(app.getHttpServer()).post(`/api/events/${event.body.id}/summon`).set("Origin", PUBLIC_URL).set("Cookie", `ah_session=${token}`).send({});

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(EVENT_SUMMON_REPLIES.unavailable);
  });
});
