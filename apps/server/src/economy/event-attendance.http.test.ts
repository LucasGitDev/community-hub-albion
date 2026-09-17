import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, getLedgerBalance, grantRole, runMigrations, schema, setEventVoiceChannelId, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventAttendanceDto, EventDto, Role } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de Buffunfa por presença não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";
const START = new Date("2026-12-01T20:00:00.000Z");
const FINISH = new Date("2026-12-01T22:00:00.000Z");
const WINDOW = FINISH.getTime() - START.getTime();

/**
 * Buffunfa por participação pela API (TASK-057). A porta é a mesma do loot split (`distribute` no
 * evento), e é aqui que se prova que ela não abre para o membro comum nem para o caller de outro
 * evento: esta rota **cria moeda**, então quem pode chamá-la importa tanto quanto o quanto ela paga.
 */
describe.skipIf(!baseUrl)("Buffunfa por presença HTTP (TASK-057)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let outroCaller: string;
  let member: string;
  let membroId: string;
  let membroDiscordId: string;
  let templateId: string;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_attendance`;
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
      login("750000000000000001", ["member", "staff"]),
      login("750000000000000002", ["member", "caller"]),
      login("750000000000000003", ["member", "caller"]),
      login("750000000000000004", ["member"]),
    ]);
    membroDiscordId = "750000000000000004";
    membroId = (await upsertUserByDiscordId(handle.db, { discordId: membroDiscordId, discordUsername: "u004" })).id;

    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string; name: string }[];
    const template = await send("post", "/api/event-templates", staff, {
      name: "Buffunfa Roads",
      minPartySize: 1,
      maxPartySize: null,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 5, buffunfaMin: 10, buffunfaMax: 40 },
        // Faixa 0 a 0: o template antigo da F6-51, que antes não tinha como pagar nada (AC#6).
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 5, buffunfaMin: 0, buffunfaMax: 0 },
      ],
    });
    expect(template.status).toBe(201);
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

  /** Evento do `caller`, finalizado, com o `member` inscrito e (por default) presente a janela toda. */
  async function finishedEvent({ presence = WINDOW, measured = true }: { presence?: number; measured?: boolean } = {}): Promise<EventDto> {
    const created = await send("post", "/api/events", caller, { templateId, name: `Buffunfa ${++seq}` });
    expect(created.status).toBe(201);
    const id = (created.body as EventDto).id;
    expect((await go(caller, id, "open")).status).toBe(200);
    const slotId = (created.body as EventDto).roles[0]!.id;
    expect((await send("post", `/api/events/${id}/signups`, member, { slotId })).status).toBe(200);
    expect((await go(caller, id, "start")).status).toBe(200);

    const channelId = `ch-buf-${seq}`;
    if (measured) {
      await setEventVoiceChannelId(handle.db, id, channelId);
      await handle.db.update(schema.events).set({ startedAt: START }).where(eq(schema.events.id, id));
      if (presence > 0)
        await handle.db
          .insert(schema.voiceSessions)
          .values({ discordUserId: membroDiscordId, channelId, startedAt: START, endedAt: new Date(START.getTime() + presence), lastHeartbeatAt: FINISH });
    } else {
      await handle.db.update(schema.events).set({ startedAt: START }).where(eq(schema.events.id, id));
    }
    expect((await go(caller, id, "finish")).status).toBe(200);
    await handle.db.update(schema.events).set({ finishedAt: FINISH }).where(eq(schema.events.id, id));
    return (await http().get(`/api/events/${id}`).set("Cookie", caller)).body as EventDto;
  }

  const attendance = async (cookie: string, id: string) => http().get(`/api/events/${id}/attendance`).set("Cookie", cookie);
  /** Relê o evento pela API: é onde o valor vigente por role aparece para a tela. */
  const eventOf = async (id: string): Promise<EventDto> => (await http().get(`/api/events/${id}`).set("Cookie", caller)).body as EventDto;

  describe("autorização: esta rota cria moeda", () => {
    it("sem sessão 401, de outra origem 403 (CSRF)", async () => {
      const event = await finishedEvent();
      expect((await http().get(`/api/events/${event.id}/attendance`)).status).toBe(401);
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, null)).status).toBe(401);
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, caller, {}, "http://evil.example")).status).toBe(403);
      expect((await send("patch", `/api/events/${event.id}/attendance/roles/${event.roles[0]!.id}`, caller, { value: 20 }, "http://evil.example")).status).toBe(403);
    });

    it("membro comum não lê nem paga; caller de outro evento também não; a staff sim", async () => {
      const event = await finishedEvent();
      expect((await attendance(member, event.id)).status).toBe(403);
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, member)).status).toBe(403);
      expect((await attendance(outroCaller, event.id)).status).toBe(403);
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, outroCaller)).status).toBe(403);
      expect((await attendance(staff, event.id)).status).toBe(200);
    });

    it("evento inexistente é 404 e id torto é 400: o id não vaza", async () => {
      expect((await attendance(caller, MISSING)).status).toBe(404);
      expect((await attendance(caller, "nao-e-uuid")).status).toBe(400);
      expect((await send("post", `/api/events/${MISSING}/attendance/payout`, caller)).status).toBe(404);
    });
  });

  describe("valor de Buffunfa do evento (AC#1 a AC#4, AC#6)", () => {
    it("o evento nasce com a faixa do template e o valor no mínimo (AC#4)", async () => {
      const event = await finishedEvent();
      expect(event.roles[0]).toMatchObject({ name: "Tank", buffunfaMin: "10", buffunfaMax: "40", buffunfaValue: "10" });
      expect(event.roles[1]).toMatchObject({ name: "Healer", buffunfaMin: "0", buffunfaMax: "0", buffunfaValue: "0" });
    });

    it("aceita qualquer inteiro até o teto do sistema e recusa acima dele com a frase do teto (AC#3)", async () => {
      const event = await finishedEvent();
      const slotId = event.roles[0]!.id;
      const patch = (value: unknown) => send("patch", `/api/events/${event.id}/attendance/roles/${slotId}`, caller, { value });
      const valueOf = async (name: string) => (await eventOf(event.id)).roles.find((r) => r.name === name)!.buffunfaValue;

      expect((await patch(40)).status).toBe(200);
      // Acima do máximo do template e abaixo do mínimo dele: os dois passam agora (revisão da F6-8).
      expect((await patch(900)).status).toBe(200);
      expect(await valueOf("Tank")).toBe("900");
      expect((await patch(9)).status).toBe(200);
      expect((await patch(0)).status).toBe(200);

      // O teto do sistema recusa, e a recusa explica de quem é o teto.
      const above = await patch(10_001);
      expect(above.status).toBe(400);
      expect(above.body.message).toContain("10000");
      expect(await valueOf("Tank")).toBe("0");
      // Valor negativo e valor não inteiro continuam erro de pedido, não de regra.
      expect((await patch(-1)).status).toBe(400);
      expect((await patch("2,5")).status).toBe(400);
    });

    it("o lote põe todas as roles no mesmo valor e o individual vale por cima (AC#1, AC#2)", async () => {
      const event = await finishedEvent();
      const valuesOf = async () => Object.fromEntries((await eventOf(event.id)).roles.map((r) => [r.name, r.buffunfaValue]));
      expect(await valuesOf()).toEqual({ Tank: "10", Healer: "0" });

      const lote = await send("patch", `/api/events/${event.id}/attendance/roles`, caller, { value: 55 });
      expect(lote.status).toBe(200);
      expect(await valuesOf()).toEqual({ Tank: "55", Healer: "55" });

      expect((await send("patch", `/api/events/${event.id}/attendance/roles/${event.roles[0]!.id}`, caller, { value: 80 })).status).toBe(200);
      expect(await valuesOf()).toEqual({ Tank: "80", Healer: "55" });
    });

    it("o lote é a mesma porta do individual: sem sessão 401, de outra origem 403, membro comum 403 (AC#1)", async () => {
      const event = await finishedEvent();
      const path = `/api/events/${event.id}/attendance/roles`;
      expect((await send("patch", path, null, { value: 5 })).status).toBe(401);
      expect((await send("patch", path, caller, { value: 5 }, "http://evil.example")).status).toBe(403);
      expect((await send("patch", path, member, { value: 5 })).status).toBe(403);
      expect((await send("patch", path, outroCaller, { value: 5 })).status).toBe(403);
      expect((await send("patch", `/api/events/${MISSING}/attendance/roles`, caller, { value: 5 })).status).toBe(404);
    });

    it("role de outro evento não é alcançável pela rota de um evento que o caller manda", async () => {
      const meu = await finishedEvent();
      const outro = await finishedEvent();
      expect((await send("patch", `/api/events/${meu.id}/attendance/roles/${outro.roles[0]!.id}`, caller, { value: 20 })).status).toBe(404);
    });
  });

  describe("fechamento (AC#3, AC#4, AC#5, AC#6)", () => {
    it("paga o valor do fechamento a quem bateu os 90% e o lançamento aparece no extrato do membro", async () => {
      const event = await finishedEvent();
      expect((await send("patch", `/api/events/${event.id}/attendance/roles/${event.roles[0]!.id}`, caller, { value: 30 })).status).toBe(200);

      const preview = (await attendance(caller, event.id)).body as EventAttendanceDto;
      expect(preview).toMatchObject({ measured: true, paidAt: null, total: "30" });

      const paid = await send("post", `/api/events/${event.id}/attendance/payout`, caller);
      expect(paid.status).toBe(201);
      expect(paid.body as EventAttendanceDto).toMatchObject({ total: "30" });
      expect((paid.body as EventAttendanceDto).paidAt).not.toBeNull();
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(30n);

      const extrato = await http().get("/api/me/ledger?currency=buffunfa").set("Cookie", member);
      expect(extrato.status).toBe(200);
      expect(extrato.body.entries[0]).toMatchObject({ kind: "event_attendance", currency: "buffunfa", amount: "30" });
      expect(extrato.body.entries[0].memo).toContain("Presença em");

      // Segundo clique não credita de novo, e o valor por role não muda mais.
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, caller)).status).toBe(201);
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(30n);
      const late = await send("patch", `/api/events/${event.id}/attendance/roles/${event.roles[0]!.id}`, caller, { value: 10 });
      expect(late.status).toBe(409);
      expect(late.body.message).toContain("já foi paga");
      // O lote congela junto: depois de pago não existe porta de ajuste nenhuma (AC#5).
      const loteTarde = await send("patch", `/api/events/${event.id}/attendance/roles`, caller, { value: 10 });
      expect(loteTarde.status).toBe(409);
      expect(loteTarde.body.message).toContain("já foi paga");
    });

    it("presença abaixo de 90% não recebe nada, e a linha diz o motivo", async () => {
      const before = await getLedgerBalance(handle.db, membroId, "buffunfa");
      const event = await finishedEvent({ presence: Math.floor(WINDOW * 0.5) });
      const preview = (await attendance(caller, event.id)).body as EventAttendanceDto;
      expect(preview.lines[0]).toMatchObject({ skip: "below_presence", amount: "0" });
      expect(preview.total).toBe("0");
      expect((await send("post", `/api/events/${event.id}/attendance/payout`, caller)).status).toBe(201);
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(before);
    });

    it("evento sem canal de presença avisa na prévia e recusa o fechamento (AC#5)", async () => {
      const before = await getLedgerBalance(handle.db, membroId, "buffunfa");
      const event = await finishedEvent({ measured: false });
      expect(event.presenceChannelId).toBeNull();
      const preview = (await attendance(caller, event.id)).body as EventAttendanceDto;
      expect(preview.measured).toBe(false);
      expect(preview.lines.every((l) => l.skip === "no_channel")).toBe(true);
      const refused = await send("post", `/api/events/${event.id}/attendance/payout`, caller);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toContain("sem presença medida");
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(before);
    });
  });

  /**
   * Fica por último de propósito: este teste **credita** o mesmo membro dos outros, e o extrato
   * deles é conferido em valor absoluto.
   */
  describe("template antigo com faixa zerada (AC#6)", () => {
    it("evento de template com faixa 0 a 0 paga Buffunfa depois do lote (AC#6)", async () => {
      const event = await finishedEvent();
      const before = await getLedgerBalance(handle.db, membroId, "buffunfa");
      // O membro está inscrito na Tank; o que importa é que o valor venha do lote, não da faixa.
      expect((await send("patch", `/api/events/${event.id}/attendance/roles`, caller, { value: 0 })).status).toBe(200);
      const zerado = (await attendance(caller, event.id)).body as EventAttendanceDto;
      expect(zerado).toMatchObject({ total: "0" });
      expect(zerado.lines[0]!.skip).toBe("zero_value");

      expect((await send("patch", `/api/events/${event.id}/attendance/roles`, caller, { value: 70 })).status).toBe(200);
      const paid = await send("post", `/api/events/${event.id}/attendance/payout`, caller);
      expect(paid.status).toBe(201);
      expect(paid.body as EventAttendanceDto).toMatchObject({ total: "70" });
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(before + 70n);
    });
  });
});
