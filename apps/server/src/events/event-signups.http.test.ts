import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { banUser, createDb, createSession, getLedgerBalance, grantRole, insertLedgerEntry, runMigrations, unbanUser, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventDto, EventSignupDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { EventSignupsService } from "./event-signups.service.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de inscrição não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!baseUrl)("inscrição em evento HTTP (TASK-022, Q27)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let caller: string;
  let staff: string;
  let membro: string;
  let outro: string;
  let terceiro: string;
  let membroId: string;
  let outroId: string;
  let terceiroId: string;
  let templateId: string;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_signups`;
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
    [caller, staff, membro, outro, terceiro] = await Promise.all([
      login("740000000000000001", ["member", "caller"]),
      login("740000000000000002", ["member", "staff"]),
      login("740000000000000003", ["member"]),
      login("740000000000000004", ["member"]),
      login("740000000000000005", ["member"]),
    ]);
    membroId = await userId("740000000000000003");
    outroId = await userId("740000000000000004");
    terceiroId = await userId("740000000000000005");
    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string; name: string }[];
    const template = await send("post", "/api/event-templates", staff, {
      name: "Inscrição",
      minPartySize: 1,
      maxPartySize: null,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1 },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2 },
      ],
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

  const userId = async (discordId: string) => (await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` })).id;

  const http = () => request(app.getHttpServer());
  const send = (method: "post" | "patch" | "delete", path: string, cookie: string | null, body: object = {}, origin = PUBLIC_URL) => {
    const req = http()[method](path).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body);
  };

  /** Evento já aberto pelo caller, com Tank (1 vaga) e Healer (2). */
  async function openEvent(name: string) {
    const created = await send("post", "/api/events", caller, { templateId, name });
    expect(created.status).toBe(201);
    const event = created.body as EventDto;
    expect((await send("post", `/api/events/${event.id}/transitions/open`, caller)).status).toBe(200);
    return { event, tank: event.roles.find((r) => r.name === "Tank")!, healer: event.roles.find((r) => r.name === "Healer")! };
  }

  const join = (cookie: string, eventId: string, slotId: string) => send("post", `/api/events/${eventId}/signups`, cookie, { slotId });
  const leave = (cookie: string, eventId: string) => send("delete", `/api/events/${eventId}/signups/me`, cookie);
  const list = async (cookie: string, eventId: string) => (await http().get(`/api/events/${eventId}/signups`).set("Cookie", cookie)).body.signups as EventSignupDto[];

  /** Evento aberto com taxa de entrada, pelo caminho que o painel usa (PATCH da rota nova). */
  async function openPaidEvent(name: string, entryFee: string) {
    const created = await send("post", "/api/events", caller, { templateId, name });
    const event = created.body as EventDto;
    expect((await send("patch", `/api/events/${event.id}/entry-fee`, caller, { entryFee })).body.entryFee).toBe(entryFee);
    expect((await send("post", `/api/events/${event.id}/transitions/open`, caller)).status).toBe(200);
    return { event, tank: event.roles.find((r) => r.name === "Tank")!, healer: event.roles.find((r) => r.name === "Healer")! };
  }

  const giveBuffunfa = (userId: string, amount: bigint) =>
    insertLedgerEntry(handle.db, { userId, currency: "buffunfa", amount, kind: "adjustment", memo: "saldo do teste" });

  describe("taxa de entrada em Buffunfa (TASK-058)", () => {
    it("a rota da taxa só aceita inteiro >= 0, e só de quem conduz o evento", async () => {
      const created = await send("post", "/api/events", caller, { templateId, name: "Taxa validada" });
      const id = (created.body as EventDto).id;
      expect((created.body as EventDto).entryFee).toBe("0");

      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: "-5" })).status).toBe(400);
      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: "1,5" })).status).toBe(400);
      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: 20 })).status).toBe(400);
      // Sem teto de política (decisão do usuário): um valor absurdo passa e volta inteiro...
      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: "999999999999" })).body.entryFee).toBe("999999999999");
      // ...mas acima do que o int8 guarda é 400 legível, não 500 do banco.
      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: "99999999999999999999" })).status).toBe(400);
      // Membro comum não mexe na taxa de evento que não é dele.
      expect((await send("patch", `/api/events/${id}/entry-fee`, membro, { entryFee: "1" })).status).toBe(403);
      expect((await send("patch", `/api/events/${id}/entry-fee`, null, { entryFee: "1" })).status).toBe(401);
      expect((await send("patch", `/api/events/${id}/entry-fee`, caller, { entryFee: "1" }, "http://evil.example")).status).toBe(403);
    });

    it("a taxa congela quando as inscrições fecham (AC#1)", async () => {
      const { event } = await openPaidEvent("Taxa congelada", "10");
      expect((await send("patch", `/api/events/${event.id}/entry-fee`, caller, { entryFee: "12" })).body.entryFee).toBe("12");
      expect((await send("post", `/api/events/${event.id}/transitions/close`, caller)).status).toBe(200);
      const frozen = await send("patch", `/api/events/${event.id}/entry-fee`, caller, { entryFee: "1" });
      expect(frozen.status).toBe(409);
      expect(frozen.body.message).toContain("inscrições");
    });

    it("a inscrição debita, a desistência devolve, e saldo insuficiente é 409 com o número que falta (AC#2, AC#3)", async () => {
      const { event, tank } = await openPaidEvent("Cobrada", "20");
      // Sem Buffunfa nenhuma: recusa, e a mensagem diz quanto falta.
      const broke = await join(terceiro, event.id, tank.id);
      expect(broke.status).toBe(409);
      expect(broke.body.message).toContain("20 BUF");
      expect(await list(caller, event.id)).toHaveLength(0);

      await giveBuffunfa(membroId, 50n);
      expect((await join(membro, event.id, tank.id)).status).toBe(200);
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(30n);

      expect((await leave(membro, event.id)).status).toBe(200);
      expect(await getLedgerBalance(handle.db, membroId, "buffunfa")).toBe(50n);
    });

    it("cancelar o evento devolve a taxa a todos os inscritos (AC#4)", async () => {
      const { event, healer } = await openPaidEvent("Cancelada", "15");
      await giveBuffunfa(outroId, 15n);
      await giveBuffunfa(terceiroId, 15n);
      expect((await join(outro, event.id, healer.id)).status).toBe(200);
      expect((await join(terceiro, event.id, healer.id)).status).toBe(200);
      expect(await getLedgerBalance(handle.db, outroId, "buffunfa")).toBe(0n);

      expect((await send("post", `/api/events/${event.id}/transitions/cancel`, caller, { reason: "chuva" })).status).toBe(200);
      expect(await getLedgerBalance(handle.db, outroId, "buffunfa")).toBe(15n);
      expect(await getLedgerBalance(handle.db, terceiroId, "buffunfa")).toBe(15n);
    });
  });

  it("sem sessão 401; de outra origem 403 (CSRF)", async () => {
    const { event, tank } = await openEvent("CSRF");
    expect((await http().get(`/api/events/${event.id}/signups`)).status).toBe(401);
    expect((await send("post", `/api/events/${event.id}/signups`, null, { slotId: tank.id })).status).toBe(401);
    expect((await send("post", `/api/events/${event.id}/signups`, membro, { slotId: tank.id }, "http://evil.example")).status).toBe(403);
  });

  it("membro entra na role e a lista fica visível (AC#1)", async () => {
    const { event, tank } = await openEvent("Entrada simples");
    const res = await join(membro, event.id, tank.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: membroId, slotId: tank.id, roleName: "Tank", status: "confirmed", position: 0, decidedByUserId: null });
    expect(await list(membro, event.id)).toHaveLength(1);
    expect((await join(membro, event.id, tank.id)).status).toBe(409);
    expect((await join(membro, event.id, MISSING)).status).toBe(400);
    expect((await join(membro, MISSING, tank.id)).status).toBe(404);
    expect((await join(membro, "nao-e-uuid", tank.id)).status).toBe(400);
    expect((await send("post", `/api/events/${event.id}/signups`, membro, { slotId: "tank" })).status).toBe(400);
  });

  it("role lotada joga na lista de espera (AC#2)", async () => {
    const { event, tank } = await openEvent("Tank lotado");
    expect((await join(membro, event.id, tank.id)).body.status).toBe("confirmed");
    const waiting = await join(outro, event.id, tank.id);
    expect(waiting.status).toBe(200);
    expect(waiting.body).toMatchObject({ status: "waitlist", position: 1 });
  });

  it("sair promove o primeiro da espera da role (AC#3)", async () => {
    const { event, tank } = await openEvent("Sai e promove");
    await join(membro, event.id, tank.id);
    await join(outro, event.id, tank.id);
    expect((await leave(membro, event.id)).status).toBe(200);
    const after = await list(staff, event.id);
    expect(after.find((s) => s.userId === outroId)).toMatchObject({ status: "confirmed", position: 0 });
    expect(after.find((s) => s.userId === membroId)).toMatchObject({ status: "cancelled" });
    expect((await leave(membro, event.id)).status).toBe(409);
  });

  it("trocar de role mantém uma inscrição ativa só (AC#3)", async () => {
    const { event, tank, healer } = await openEvent("Troca de role");
    await join(membro, event.id, tank.id);
    expect((await join(membro, event.id, healer.id)).body).toMatchObject({ roleName: "Healer", status: "confirmed" });
    const active = (await list(membro, event.id)).filter((s) => s.status !== "cancelled");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ userId: membroId, roleName: "Healer" });
  });

  it("inscrição recusada com 409 quando o evento não está open (AC#5)", async () => {
    const { event, tank } = await openEvent("Já fechou");
    await join(membro, event.id, tank.id);
    expect((await send("post", `/api/events/${event.id}/transitions/close`, caller)).status).toBe(200);
    const refused = await join(outro, event.id, tank.id);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("inscrições não estão abertas");
    expect((await leave(membro, event.id)).status).toBe(409);
  });

  it("caller move inscrito entre role e espera; membro comum não (AC#4)", async () => {
    const { event, tank, healer } = await openEvent("Caller organiza");
    await join(membro, event.id, tank.id);
    await join(outro, event.id, tank.id);

    // Membro comum não move ninguém, nem a si mesmo da espera para a vaga.
    expect((await send("patch", `/api/events/${event.id}/signups/${outroId}`, outro, { target: "role", slotId: healer.id })).status).toBe(403);
    expect((await send("patch", `/api/events/${event.id}/signups/${membroId}`, outro, { target: "waitlist" })).status).toBe(403);

    // Caller (owner) move quem espera para outra role e manda o confirmado para a espera.
    const promoted = await send("patch", `/api/events/${event.id}/signups/${outroId}`, caller, { target: "role", slotId: healer.id });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ status: "confirmed", roleName: "Healer" });
    const benched = await send("patch", `/api/events/${event.id}/signups/${membroId}`, caller, { target: "waitlist" });
    expect(benched.status).toBe(200);
    expect(benched.body).toMatchObject({ status: "waitlist", roleName: "Tank" });

    // Staff também intervém; corpo inválido e gente de fora são recusados.
    expect((await send("patch", `/api/events/${event.id}/signups/${membroId}`, staff, { target: "role", slotId: tank.id })).status).toBe(200);
    expect((await send("patch", `/api/events/${event.id}/signups/${membroId}`, caller, { target: "banco" })).status).toBe(400);
    expect((await send("patch", `/api/events/${event.id}/signups/nao-e-uuid`, caller, { target: "waitlist" })).status).toBe(400);
    expect((await send("patch", `/api/events/${event.id}/signups/${terceiroId}`, caller, { target: "waitlist" })).status).toBe(409);
  });

  it("caller não estoura a vaga: role lotada recusa o move com 409 (AC#4)", async () => {
    const { event, tank, healer } = await openEvent("Sem estourar vaga");
    await join(membro, event.id, healer.id);
    await join(outro, event.id, healer.id);
    await join(terceiro, event.id, tank.id);
    const full = await send("patch", `/api/events/${event.id}/signups/${terceiroId}`, caller, { target: "role", slotId: healer.id });
    expect(full.status).toBe(409);
    expect(full.body.message).toContain("lotada");
  });

  /** TASK-023: o painel monta a tela com uma chamada só, então a listagem carrega ocupação e a minha inscrição. */
  it("listagem devolve ocupação por vaga e a inscrição de quem pediu (TASK-023, AC#1/AC#4)", async () => {
    const { event, tank } = await openEvent("Painel");
    await join(membro, event.id, tank.id);
    await join(outro, event.id, tank.id);

    const doMembro = await http().get(`/api/events?status=open`).set("Cookie", membro);
    expect(doMembro.status).toBe(200);
    expect(doMembro.headers["cache-control"]).toBe("no-store");
    const occupancy = (doMembro.body.occupancy as { eventId: string; slotId: string; confirmed: number; waitlist: number }[]).find(
      (o) => o.eventId === event.id && o.slotId === tank.id,
    );
    expect(occupancy).toMatchObject({ confirmed: 1, waitlist: 1 });
    const minhas = (doMembro.body.mySignups as EventSignupDto[]).filter((s) => s.eventId === event.id);
    expect(minhas).toMatchObject([{ userId: membroId, slotId: tank.id, status: "confirmed" }]);

    // `mySignups` é de quem pediu: a mesma listagem vista por outra pessoa traz a inscrição dela.
    const doOutro = await http().get(`/api/events?status=open`).set("Cookie", outro);
    expect((doOutro.body.mySignups as EventSignupDto[]).filter((s) => s.eventId === event.id)).toMatchObject([{ userId: outroId, status: "waitlist" }]);
    // Quem não se inscreveu não recebe inscrição de ninguém.
    expect((await http().get(`/api/events?status=open`).set("Cookie", staff)).body.mySignups).toEqual([]);
  });

  it("lista de inscritos vem com o nick de cada pessoa e o do owner (TASK-023)", async () => {
    const { event, tank } = await openEvent("Nicks");
    await join(membro, event.id, tank.id);
    const res = await http().get(`/api/events/${event.id}/signups`).set("Cookie", caller);
    expect(res.status).toBe(200);
    const members = res.body.members as { userId: string; nick: string }[];
    expect(members.find((m) => m.userId === membroId)?.nick).toBe("u003");
    expect(members.some((m) => m.userId === event.ownerUserId)).toBe(true);
    expect(res.body.events).toBeUndefined();
    expect((await http().get(`/api/events/${event.id}`).set("Cookie", membro)).body.ownerNick).toBe("u001");
  });

  it("caller de outro evento não mexe na lista alheia", async () => {
    const { event, tank } = await openEvent("Evento do outro caller");
    await join(membro, event.id, tank.id);
    const outroCaller = await login("740000000000000006", ["member", "caller"]);
    expect((await send("patch", `/api/events/${event.id}/signups/${membroId}`, outroCaller, { target: "waitlist" })).status).toBe(403);
  });

  it("banido não se inscreve em evento pelo painel (TASK-050)", async () => {
    const { event, tank, healer } = await openEvent("Banido não entra");
    // Sessão criada antes do banimento: prova que o corte é imediato e não espera o próximo login.
    const staffId = await userId("740000000000000002");
    const signups = app.get(EventSignupsService);
    const banidoCookie = await login("740000000000000009", ["member"]);
    const banidoId = await userId("740000000000000009");
    expect((await join(banidoCookie, event.id, healer.id)).status).toBe(200);

    const banido = await banUser(handle.db, { userId: banidoId, actorId: staffId, reason: "roubou o loot do split" });
    expect(banido.ok).toBe(true);

    // O cookie que ele tinha na mão morreu junto com o banimento.
    expect((await join(banidoCookie, event.id, tank.id)).status).toBe(401);

    // Com uma sessão nova forjada à mão (o cenário do banimento feito fora do fluxo), o guard recusa.
    const sobrevivente = await login("740000000000000009", []);
    const recusa = await join(sobrevivente, event.id, tank.id);
    expect(recusa.status).toBe(403);
    expect(recusa.body.message).toContain("banida");

    // O serviço recusa por conta própria, mesmo sem passar pelo guard: é a trava que o bot também usa.
    const direto = await signups.join(event.id, banidoId, tank.id);
    expect(direto).toMatchObject({ ok: false, reason: "banned", banReason: "roubou o loot do split" });

    // Desbanido, entra de novo.
    expect((await unbanUser(handle.db, banidoId)).ok).toBe(true);
    const volta = await login("740000000000000009", ["member"]);
    expect((await join(volta, event.id, tank.id)).status).toBe(200);
  });

});
