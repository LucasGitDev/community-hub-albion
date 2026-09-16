import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, runMigrations, schema, setEventVoiceChannelId, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventDto, LootSplitDto, Role } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de loot split não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";
const START = new Date("2026-11-01T20:00:00.000Z");
const FINISH = new Date("2026-11-01T22:00:00.000Z");

describe.skipIf(!baseUrl)("loot split HTTP (TASK-027)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let outroCaller: string;
  let member: string;
  let callerId: string;
  let membroId: string;
  let membroDiscordId: string;
  let templateId: string;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_loot_split`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");

    [staff, caller, outroCaller, member] = await Promise.all([
      login("740000000000000001", ["member", "staff"]),
      login("740000000000000002", ["member", "caller"]),
      login("740000000000000003", ["member", "caller"]),
      login("740000000000000004", ["member"]),
    ]);
    callerId = (await upsertUserByDiscordId(handle.db, { discordId: "740000000000000002", discordUsername: "u002" })).id;
    membroDiscordId = "740000000000000004";
    membroId = (await upsertUserByDiscordId(handle.db, { discordId: membroDiscordId, discordUsername: "u004" })).id;

    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string; name: string }[];
    const template = await send("post", "/api/event-templates", staff, {
      name: "Roads",
      minPartySize: 1,
      maxPartySize: null,
      roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 5 }],
    });
    templateId = template.body.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function login(discordId: string, roles: Role[]) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return `ah_session=${token}`;
  }

  const http = () => request(app.getHttpServer());
  const send = (method: "post" | "put" | "patch", path: string, cookie: string | null, body: object = {}, origin = PUBLIC_URL) => {
    const req = http()[method](path).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body);
  };
  const go = (cookie: string, id: string, transition: string) => send("post", `/api/events/${id}/transitions/${transition}`, cookie, {});

  /** Evento do `caller`, finalizado, com o `member` inscrito e presente as 2h no canal. */
  async function finishedEvent(withPresence = true): Promise<EventDto> {
    const created = await send("post", "/api/events", caller, { templateId, name: `Roads ${++seq}` });
    expect(created.status).toBe(201);
    const id = (created.body as EventDto).id;
    expect((await go(caller, id, "open")).status).toBe(200);
    const slotId = (created.body as EventDto).roles[0]!.id;
    expect((await send("post", `/api/events/${id}/signups`, member, { slotId })).status).toBe(200);
    expect((await go(caller, id, "start")).status).toBe(200);

    const channelId = `ch-http-${seq}`;
    await setEventVoiceChannelId(handle.db, id, channelId);
    await handle.db.update(schema.events).set({ startedAt: START }).where(eq(schema.events.id, id));
    if (withPresence)
      await handle.db.insert(schema.voiceSessions).values({ discordUserId: membroDiscordId, channelId, startedAt: START, endedAt: FINISH, lastHeartbeatAt: FINISH });
    expect((await go(caller, id, "finish")).status).toBe(200);
    await handle.db.update(schema.events).set({ finishedAt: FINISH }).where(eq(schema.events.id, id));
    return (await http().get(`/api/events/${id}`).set("Cookie", caller)).body as EventDto;
  }

  describe("autorização (AC#5, recomendação do security-review da TASK-026)", () => {
    it("sem sessão 401 e de outra origem 403 (CSRF)", async () => {
      const event = await finishedEvent();
      expect((await http().get(`/api/events/${event.id}/splits`)).status).toBe(401);
      expect((await send("post", `/api/events/${event.id}/splits`, null, { totalSilver: "1000" })).status).toBe(401);
      expect((await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000" }, "http://evil.example")).status).toBe(403);
      expect((await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "percent", value: 100 } }, "http://evil.example")).status).toBe(403);
    });

    it("membro comum não lê nem cria split: o split mostra o ganho de todo mundo", async () => {
      const event = await finishedEvent();
      expect((await http().get(`/api/events/${event.id}/splits`).set("Cookie", member)).status).toBe(403);
      expect((await send("post", `/api/events/${event.id}/splits`, member, { totalSilver: "1000" })).status).toBe(403);
    });

    it("caller não mexe no split de evento que não é dele; a staff mexe em qualquer um", async () => {
      const event = await finishedEvent();
      expect((await send("post", `/api/events/${event.id}/splits`, outroCaller, { totalSilver: "1000" })).status).toBe(403);
      expect((await http().get(`/api/events/${event.id}/splits`).set("Cookie", outroCaller)).status).toBe(403);
      expect((await send("put", `/api/events/${event.id}/fee`, outroCaller, { fee: { type: "percent", value: 100 } })).status).toBe(403);
      expect((await send("post", `/api/events/${event.id}/splits`, staff, { totalSilver: "1000" })).status).toBe(201);
    });

    it("evento inexistente é 404, não 403: o id não vaza", async () => {
      expect((await http().get(`/api/events/${MISSING}/splits`).set("Cookie", caller)).status).toBe(404);
      expect((await send("post", `/api/events/${MISSING}/splits`, caller, { totalSilver: "1" })).status).toBe(404);
      expect((await http().get(`/api/events/nao-e-uuid/splits`).set("Cookie", caller)).status).toBe(400);
    });

    it("split de outro evento não vaza pela rota de um evento que o caller manda", async () => {
      const meu = await finishedEvent();
      const outro = await finishedEvent();
      const created = await send("post", `/api/events/${outro.id}/splits`, caller, { totalSilver: "1000" });
      expect(created.status).toBe(201);
      const splitId = (created.body as LootSplitDto).id;
      expect((await http().get(`/api/events/${meu.id}/splits/${splitId}`).set("Cookie", caller)).status).toBe(404);
      expect((await http().get(`/api/events/${outro.id}/splits/${splitId}`).set("Cookie", caller)).status).toBe(200);
    });
  });

  describe("rascunho pelo endpoint", () => {
    it("cria o rascunho com presença, percentual e prévia em prata (AC#1)", async () => {
      const event = await finishedEvent();
      const res = await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000000" });
      expect(res.status).toBe(201);
      const split = res.body as LootSplitDto;
      expect(split).toMatchObject({ eventId: event.id, status: "draft", totalSilver: "1000000", residualSilver: "0", createdByUserId: callerId });
      expect(split.lines).toHaveLength(1);
      expect(split.lines[0]).toMatchObject({ userId: membroId, discordUserId: membroDiscordId, signedUp: true, shareBp: 10_000, amount: "1000000", presenceMs: 7_200_000 });
    });

    it("N splits por evento, listados na ordem em que as levas chegaram (AC#3)", async () => {
      const event = await finishedEvent();
      for (const total of ["1000", "2000", "3000"]) expect((await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: total })).status).toBe(201);
      const list = await http().get(`/api/events/${event.id}/splits`).set("Cookie", caller);
      expect(list.status).toBe(200);
      expect((list.body.splits as LootSplitDto[]).map((s) => s.totalSilver)).toEqual(["1000", "2000", "3000"]);
      expect(list.headers["cache-control"]).toBe("no-store");
    });

    it("evento cancelado não aceita split (AC#4)", async () => {
      const created = await send("post", "/api/events", caller, { templateId, name: `Cancelado ${++seq}` });
      const id = (created.body as EventDto).id;
      expect((await go(caller, id, "cancel")).status).toBe(200);
      const res = await send("post", `/api/events/${id}/splits`, caller, { totalSilver: "1000" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("O evento foi cancelado: não dá para criar loot split nele.");
    });

    it("evento que ainda não terminou recusa com uma frase que diz o estado", async () => {
      const created = await send("post", "/api/events", caller, { templateId, name: `Rascunho ${++seq}` });
      const id = (created.body as EventDto).id;
      const res = await send("post", `/api/events/${id}/splits`, caller, { totalSilver: "1000" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("O evento está rascunho. O loot split só é criado depois que o evento é finalizado.");
    });

    it("evento arquivado recusa com a frase do arquivamento (TASK-044)", async () => {
      const event = await finishedEvent(false);
      expect((await go(caller, event.id, "archive")).status).toBe(200);
      const res = await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Evento arquivado não pode mais ser editado.");
    });

    it("rascunho aberto barra o arquivamento do evento (TASK-044, AC#4)", async () => {
      const event = await finishedEvent();
      expect((await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000" })).status).toBe(201);
      const res = await go(caller, event.id, "archive");
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Este evento tem loot split em rascunho. Confirme ou apague o rascunho antes de arquivar.");
    });

    it("corpo inválido é 400 com mensagem em PT-BR", async () => {
      const event = await finishedEvent();
      expect((await send("post", `/api/events/${event.id}/splits`, caller, {})).status).toBe(400);
      const negativo = await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "-1" });
      expect(negativo.status).toBe(400);
      expect(negativo.body.message).toContain("O total da prata");
      expect((await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "10", fee: { type: "metade", value: "1" } })).status).toBe(400);
    });
  });

  describe("taxa do evento (doc-005: percentual ou fixo, sem teto, default do template)", () => {
    it("o evento nasce com a taxa do template e o caller troca depois do finish (Q26)", async () => {
      const event = await finishedEvent();
      expect(event.fee).toEqual({ type: "percent", value: "0" });
      const res = await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "fixed", value: "250000" } });
      expect(res.status).toBe(200);
      expect((res.body as EventDto).fee).toEqual({ type: "fixed", value: "250000" });
    });

    it("a taxa vigente é congelada no split; trocar depois não mexe no rascunho", async () => {
      const event = await finishedEvent();
      expect((await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "percent", value: "1000" } })).status).toBe(200);
      const created = await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000" });
      expect((created.body as LootSplitDto).fee).toEqual({ type: "percent", value: "1000" });
      // A taxa não é aplicada aqui (TASK-028): a prévia é sobre o total bruto.
      expect((created.body as LootSplitDto).lines[0]!.amount).toBe("1000");

      expect((await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "fixed", value: "1" } })).status).toBe(200);
      const again = await http().get(`/api/events/${event.id}/splits/${(created.body as LootSplitDto).id}`).set("Cookie", caller);
      expect((again.body as LootSplitDto).fee).toEqual({ type: "percent", value: "1000" });
    });

    it("o pedido pode trazer a taxa da leva, sobrepondo a do evento", async () => {
      const event = await finishedEvent();
      const created = await send("post", `/api/events/${event.id}/splits`, caller, { totalSilver: "1000", fee: { type: "fixed", value: "77" } });
      expect((created.body as LootSplitDto).fee).toEqual({ type: "fixed", value: "77" });
    });

    it("evento arquivado não aceita troca de taxa", async () => {
      const event = await finishedEvent(false);
      expect((await go(caller, event.id, "archive")).status).toBe(200);
      const res = await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "percent", value: "100" } });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Evento arquivado não pode mais ser editado.");
    });

    it("taxa inválida é 400", async () => {
      const event = await finishedEvent();
      expect((await send("put", `/api/events/${event.id}/fee`, caller, {})).status).toBe(400);
      expect((await send("put", `/api/events/${event.id}/fee`, caller, { fee: { type: "percent", value: "-5" } })).status).toBe(400);
    });
  });
});
