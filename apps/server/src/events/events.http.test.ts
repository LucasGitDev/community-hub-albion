import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventDto, EventOwnerChangeDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { EVENTS_CLOCK, EventSignupsCloseService } from "./events-signups-close.service.js";
import { EventsService, type EventTransitionEvent } from "./events.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de eventos não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!baseUrl)("eventos e máquina de estados HTTP (TASK-021, Q9/Q21/Q26)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let caller2: string;
  let member: string;
  let callerId: string;
  let caller2Id: string;
  let templateId: string;
  let now = new Date("2026-10-01T22:00:00.000Z");

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_events`;
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
      .overrideProvider(EVENTS_CLOCK)
      .useValue(() => now)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    [staff, caller, caller2, member] = await Promise.all([
      login("720000000000000001", ["member", "staff"]),
      login("720000000000000002", ["member", "caller"]),
      login("720000000000000003", ["member", "caller"]),
      login("720000000000000004", ["member"]),
    ]);
    callerId = (await upsertUserByDiscordId(handle.db, { discordId: "720000000000000002", discordUsername: "u002" })).id;
    caller2Id = (await upsertUserByDiscordId(handle.db, { discordId: "720000000000000003", discordUsername: "u003" })).id;
    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string; name: string }[];
    const template = await send("post", "/api/event-templates", staff, {
      name: "Roads",
      minPartySize: 1,
      maxPartySize: null,
      roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1 }, { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2 }],
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
  const send = (method: "post" | "patch" | "delete", path: string, cookie: string | null, body: object = {}, origin = PUBLIC_URL) => {
    const req = http()[method](path).set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body);
  };
  const create = (cookie: string, body: object = {}) => send("post", "/api/events", cookie, { templateId, name: "Roads das 21h", ...body });
  const go = (cookie: string, id: string, transition: string, body: object = {}) => send("post", `/api/events/${id}/transitions/${transition}`, cookie, body);
  const createdBy = async (cookie: string, body: object = {}) => {
    const res = await create(cookie, body);
    expect(res.status).toBe(201);
    return res.body as EventDto;
  };

  it("sem sessão 401; de outra origem 403 (CSRF)", async () => {
    expect((await http().get("/api/events")).status).toBe(401);
    expect((await send("post", "/api/events", null, { templateId, name: "X" })).status).toBe(401);
    expect((await create(caller, {})).status).toBe(201);
    expect((await send("post", "/api/events", caller, { templateId, name: "X" }, "http://evil.example")).status).toBe(403);
  });

  it("caller cria evento a partir do template e vira owner, com snapshot das roles (AC#1)", async () => {
    const event = await createdBy(caller, { name: "  Roads de ouro  ", description: "Leve capa de bandido", startsAt: "2026-10-01T23:00:00.000Z", signupsCloseAt: "2026-10-01T22:45:00.000Z" });
    expect(event).toMatchObject({
      name: "Roads de ouro",
      description: "Leve capa de bandido",
      status: "draft",
      ownerUserId: callerId,
      createdByUserId: callerId,
      templateId,
      templateName: "Roads",
      totalSlots: 3,
      voiceChannelId: null,
    });
    expect(event.roles.map((r) => `${r.name}:${r.slots}`)).toEqual(["Tank:1", "Healer:2"]);

    const detail = await http().get(`/api/events/${event.id}`).set("Cookie", member);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(event.id);
    const history = (await http().get(`/api/events/${event.id}/owner-history`).set("Cookie", caller)).body.history as EventOwnerChangeDto[];
    expect(history).toMatchObject([{ fromUserId: null, toUserId: callerId, changedByUserId: callerId }]);
  });

  it("membro não cria evento: 403 (AC#2, Q9); staff cria", async () => {
    expect((await create(member)).status).toBe(403);
    expect((await create(staff)).status).toBe(201);
  });

  it("recusa corpo inválido, template inexistente e template inativo", async () => {
    expect((await create(caller, { name: "   " })).status).toBe(400);
    const bad = await create(caller, { startsAt: "2026-10-01T22:00:00.000Z", signupsCloseAt: "2026-10-01T23:00:00.000Z" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("fechar até o início");
    expect((await create(caller, { templateId: MISSING })).status).toBe(400);
    expect((await create(caller, { templateId: "nao-uuid" })).status).toBe(400);

    const roles = (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as { id: string }[];
    const inativo = await send("post", "/api/event-templates", staff, { name: "Aposentado", minPartySize: 1, maxPartySize: null, active: false, roles: [{ roleId: roles[0]!.id, slots: 1 }] });
    const blocked = await create(caller, { templateId: inativo.body.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("inativo");
  });

  it("owner percorre draft→open→closed→running→finished e cada estado ganha seu carimbo (AC#3, Q26)", async () => {
    const event = await createdBy(caller);
    for (const [transition, status] of [["open", "open"], ["close", "closed"], ["start", "running"], ["finish", "finished"]] as const) {
      const res = await go(caller, event.id, transition);
      expect(res.status, transition).toBe(200);
      expect(res.body.status).toBe(status);
    }
    const final = (await http().get(`/api/events/${event.id}`).set("Cookie", caller)).body as EventDto;
    for (const stamp of ["openedAt", "closedAt", "startedAt", "finishedAt"] as const) expect(final[stamp], stamp).not.toBeNull();
    expect(final.cancelledAt).toBeNull();
  });

  describe("cancelamento (TASK-025, Q26)", () => {
    /** Leva o evento até o estado pedido pelo caminho da máquina e devolve o evento. */
    const at = async (status: "draft" | "open" | "closed" | "running") => {
      const event = await createdBy(caller);
      const path = { draft: [], open: ["open"], closed: ["open", "close"], running: ["open", "start"] }[status];
      for (const step of path) expect((await go(caller, event.id, step)).status, step).toBe(200);
      return event;
    };
    const signups = async (id: string) => (await http().get(`/api/events/${id}/signups`).set("Cookie", caller)).body.signups as { userId: string; status: string }[];

    it("cancela de qualquer estado antes de finished e guarda o motivo (AC#3)", async () => {
      for (const status of ["draft", "open", "closed", "running"] as const) {
        const event = await at(status);
        const res = await go(caller, event.id, "cancel", { reason: `caiu em ${status}` });
        expect(res.status, status).toBe(200);
        expect(res.body as EventDto).toMatchObject({ status: "cancelled", cancelReason: `caiu em ${status}` });
        expect((res.body as EventDto).cancelledAt).not.toBeNull();
      }
    });

    it("cancelar marca todas as inscrições ativas como canceladas (AC#1)", async () => {
      const event = await at("open");
      const tank = event.roles.find((r) => r.name === "Tank")!;
      const healer = event.roles.find((r) => r.name === "Healer")!;
      expect((await send("post", `/api/events/${event.id}/signups`, member, { slotId: tank.id })).status).toBe(200);
      expect((await send("post", `/api/events/${event.id}/signups`, caller2, { slotId: healer.id })).status).toBe(200);
      expect((await signups(event.id)).filter((s) => s.status !== "cancelled")).toHaveLength(2);

      expect((await go(caller, event.id, "cancel")).status).toBe(200);
      expect((await signups(event.id)).every((s) => s.status === "cancelled")).toBe(true);
      // O membro deixa de ter inscrição ativa na carga do painel (AC#4).
      const board = await http().get("/api/events").set("Cookie", member);
      expect((board.body.mySignups as { eventId: string }[]).some((s) => s.eventId === event.id)).toBe(false);
      // E ninguém entra mais: o evento não está aberto.
      expect((await send("post", `/api/events/${event.id}/signups`, member, { slotId: tank.id })).status).toBe(409);
    });

    it("evento finalizado não pode ser cancelado: 409 PT-BR e nada muda (AC#3)", async () => {
      const event = await at("running");
      expect((await go(caller, event.id, "finish")).status).toBe(200);
      const res = await go(caller, event.id, "cancel", { reason: "mudei de ideia" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("O evento está finalizado e não pode ir para cancelado. Daqui só dá para ir para: arquivado.");
      const after = (await http().get(`/api/events/${event.id}`).set("Cookie", caller)).body as EventDto;
      expect(after).toMatchObject({ status: "finished", cancelReason: null, cancelledAt: null });
    });

    it("quem cancela é o owner ou a staff; membro e caller de outro evento tomam 403", async () => {
      const event = await at("open");
      expect((await go(member, event.id, "cancel")).status).toBe(403);
      expect((await go(caller2, event.id, "cancel")).status).toBe(403);
      expect((await go(staff, event.id, "cancel")).status).toBe(200);
      expect((await send("post", `/api/events/${event.id}/transitions/cancel`, caller, {}, "http://evil.example")).status).toBe(403);
    });

    it("motivo com mais de 300 caracteres é 400 e o evento continua de pé", async () => {
      const event = await at("open");
      const res = await go(caller, event.id, "cancel", { reason: "x".repeat(301) });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("O motivo tem no máximo 300 caracteres.");
      expect((await http().get(`/api/events/${event.id}`).set("Cookie", caller)).body.status).toBe("open");
      // Sem motivo continua valendo, e o campo fica nulo.
      expect((await go(caller, event.id, "cancel")).body).toMatchObject({ status: "cancelled", cancelReason: null });
    });
  });

  it("transição fora da máquina responde 409 PT-BR sem mudar o estado (AC#3)", async () => {
    const event = await createdBy(caller);
    const invalid = await go(caller, event.id, "finish");
    expect(invalid.status).toBe(409);
    expect(invalid.body.message).toContain("está rascunho e não pode ir para finalizado");
    expect((await http().get(`/api/events/${event.id}`).set("Cookie", caller)).body.status).toBe("draft");

    expect((await go(caller, event.id, "cancel")).status).toBe(200);
    const again = await go(caller, event.id, "cancel");
    expect(again.status).toBe(409);
    expect(again.body.message).toContain("Esse é um estado final");
    expect((await go(caller, event.id, "destroy")).status).toBe(400);
    expect((await go(caller, MISSING, "open")).status).toBe(404);
    expect((await go(caller, "nao-uuid", "open")).status).toBe(400);
  });

  it("caller que não é owner leva 403; staff manda em evento alheio (Q21)", async () => {
    const event = await createdBy(caller);
    for (const transition of ["open", "start", "finish", "cancel"]) {
      const res = await go(caller2, event.id, transition);
      expect(res.status, transition).toBe(403);
      expect(res.body.message).toContain("owner do evento ou a staff");
    }
    expect((await go(member, event.id, "open")).status).toBe(403);
    expect((await go(staff, event.id, "open")).status).toBe(200);
    expect((await go(staff, event.id, "cancel")).status).toBe(200);
  });

  it("staff transfere o owner e o histórico guarda a troca; caller não transfere (AC#4, Q21)", async () => {
    const event = await createdBy(caller);
    expect((await send("post", `/api/events/${event.id}/owner`, caller, { ownerUserId: caller2Id })).status).toBe(403);
    expect((await send("post", `/api/events/${event.id}/owner`, member, { ownerUserId: caller2Id })).status).toBe(403);

    const moved = await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: caller2Id });
    expect(moved.status).toBe(200);
    expect(moved.body.ownerUserId).toBe(caller2Id);
    const history = (await http().get(`/api/events/${event.id}/owner-history`).set("Cookie", staff)).body.history as EventOwnerChangeDto[];
    expect(history).toMatchObject([
      { fromUserId: null, toUserId: callerId },
      { fromUserId: callerId, toUserId: caller2Id },
    ]);

    // Owner novo manda; o antigo perde o comando.
    expect((await go(caller, event.id, "open")).status).toBe(403);
    expect((await go(caller2, event.id, "open")).status).toBe(200);

    expect((await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: caller2Id })).status).toBe(409);
    expect((await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: MISSING })).status).toBe(400);
    expect((await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: "eu" })).status).toBe(400);
    expect((await send("post", `/api/events/${MISSING}/owner`, staff, { ownerUserId: caller2Id })).status).toBe(404);
  });

  it("fechamento automático fecha só os eventos open com horário vencido e é idempotente (AC#5)", async () => {
    const vencido = await createdBy(caller, { name: "Fecha sozinho", signupsCloseAt: "2026-10-01T21:59:00.000Z" });
    const futuro = await createdBy(caller, { name: "Ainda dá tempo", signupsCloseAt: "2026-10-01T22:30:00.000Z" });
    const semPrazo = await createdBy(caller, { name: "Fecha na mão" });
    const rascunho = await createdBy(caller, { name: "Rascunho vencido", signupsCloseAt: "2026-10-01T21:59:00.000Z" });
    for (const e of [vencido, futuro, semPrazo]) expect((await go(caller, e.id, "open")).status).toBe(200);

    const job = app.get(EventSignupsCloseService);
    expect(await job.sweep()).toBe(1);
    expect(await job.sweep()).toBe(0);
    const status = async (id: string) => (await http().get(`/api/events/${id}`).set("Cookie", caller)).body.status;
    expect(await status(vencido.id)).toBe("closed");
    expect(await status(futuro.id)).toBe("open");
    expect(await status(semPrazo.id)).toBe("open");
    expect(await status(rascunho.id)).toBe("draft");

    // O relógio avança: agora o outro também vence.
    now = new Date("2026-10-01T23:00:00.000Z");
    expect(await job.sweep()).toBe(1);
    expect(await status(futuro.id)).toBe("closed");
    // Inscrição também fecha na mão (AC#5).
    expect((await go(caller, semPrazo.id, "close")).body.status).toBe("closed");
  });

  it("emite onEventTransition depois de cada transição, para TASK-022/024 assinarem (doc-002)", async () => {
    const seen: EventTransitionEvent[] = [];
    const unsubscribe = app.get(EventsService).onEventTransition((e) => {
      seen.push(e);
      if (e.transition === "start") throw new Error("listener quebrado");
    });
    try {
      const event = await createdBy(caller, { name: "Com listener", signupsCloseAt: "2026-10-01T21:00:00.000Z" });
      expect((await go(caller, event.id, "open")).status).toBe(200);
      // Listener que estoura não desfaz a transição (o start segue valendo).
      expect((await go(caller, event.id, "start")).status).toBe(200);
      expect(seen.map((e) => `${e.from}->${e.to}:${e.transition}`)).toEqual(["draft->open:open", "open->running:start"]);
      expect(seen[0]).toMatchObject({ actorUserId: callerId, event: { id: event.id, status: "open" } });

      // O fechamento automático emite a mesma transição, sem ator.
      seen.length = 0;
      const auto = await createdBy(caller, { name: "Auto com listener", signupsCloseAt: "2026-10-01T21:00:00.000Z" });
      await go(caller, auto.id, "open");
      seen.length = 0;
      await app.get(EventSignupsCloseService).sweep();
      expect(seen).toMatchObject([{ from: "open", to: "closed", transition: "auto-close", actorUserId: null, event: { id: auto.id } }]);
    } finally {
      unsubscribe();
    }
  });

  describe("arquivamento (TASK-044, Q26 revisada)", () => {
    /** Leva um evento novo até `finished` pelo caminho da máquina. */
    const finished = async (name = "Para arquivar") => {
      const event = await createdBy(caller, { name });
      for (const step of ["open", "start", "finish"] as const) expect((await go(caller, event.id, step)).status, step).toBe(200);
      return event;
    };
    const get = async (id: string) => (await http().get(`/api/events/${id}`).set("Cookie", caller)).body as EventDto;

    it("owner arquiva o evento finalizado e o carimbo fica gravado (AC#1)", async () => {
      const event = await finished();
      const res = await go(caller, event.id, "archive");
      expect(res.status).toBe(200);
      expect(res.body as EventDto).toMatchObject({ status: "archived" });
      expect((res.body as EventDto).archivedAt).not.toBeNull();
      // O carimbo do fim de jogo continua lá: arquivar fecha o evento, não apaga a história.
      expect((res.body as EventDto).finishedAt).not.toBeNull();
    });

    it("staff também arquiva; membro e caller de outro evento tomam 403 (AC#3)", async () => {
      const doStaff = await finished("Staff arquiva");
      expect((await go(member, doStaff.id, "archive")).status).toBe(403);
      expect((await go(caller2, doStaff.id, "archive")).status).toBe(403);
      expect((await go(staff, doStaff.id, "archive")).status).toBe(200);
    });

    it("de archived não sai nenhuma transição: 409 PT-BR e nada muda (AC#1)", async () => {
      const event = await finished("Arquivado trancado");
      expect((await go(caller, event.id, "archive")).status).toBe(200);
      for (const transition of ["archive", "cancel", "finish", "start", "close", "open"] as const) {
        const res = await go(caller, event.id, transition);
        expect(res.status, transition).toBe(409);
        expect(res.body.message, transition).toContain("O evento está arquivado");
        expect(res.body.message, transition).toContain("Esse é um estado final.");
      }
      expect((await get(event.id)).status).toBe("archived");
    });

    it("evento finalizado ainda aceita edição; arquivado devolve 409 com a frase do arquivamento (AC#2)", async () => {
      const event = await finished("Edição depois do jogo");
      const tank = event.roles.find((r) => r.name === "Tank")!;
      // `finished` é o momento do acerto (taxa, splits): trocar o owner continua valendo.
      expect((await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: caller2Id })).status).toBe(200);
      expect((await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: callerId })).status).toBe(200);

      expect((await go(caller, event.id, "archive")).status).toBe(200);
      const blocked = [
        await send("post", `/api/events/${event.id}/owner`, staff, { ownerUserId: caller2Id }),
        await send("post", `/api/events/${event.id}/signups`, member, { slotId: tank.id }),
        await send("delete", `/api/events/${event.id}/signups/me`, member),
        await send("patch", `/api/events/${event.id}/signups/${callerId}`, caller, { target: "waitlist" }),
      ];
      for (const res of blocked) {
        expect(res.status).toBe(409);
        expect(res.body.message).toBe("Evento arquivado não pode mais ser editado.");
      }
      expect((await get(event.id)).ownerUserId).toBe(callerId);
    });

    it("split em rascunho barra o arquivamento: 409 e o evento continua finalizado (AC#4)", async () => {
      const event = await finished("Com split pendente");
      const events = app.get(EventsService);
      // A F5 (TASK-027/028) pluga aqui a consulta real de splits; o teste usa o mesmo encaixe.
      events.setArchivePrecondition(() => Promise.resolve("Esse evento ainda tem um loot split em rascunho. Confirme ou descarte antes de arquivar."));
      try {
        const res = await go(caller, event.id, "archive");
        expect(res.status).toBe(409);
        expect(res.body.message).toBe("Esse evento ainda tem um loot split em rascunho. Confirme ou descarte antes de arquivar.");
        const after = await get(event.id);
        expect(after).toMatchObject({ status: "finished", archivedAt: null });
      } finally {
        events.setArchivePrecondition(() => Promise.resolve(null));
      }
      // Sem pendência, arquiva.
      expect((await go(caller, event.id, "archive")).status).toBe(200);
    });
  });

  it("listagem filtra por estado, owner e template", async () => {
    const list = async (query: string, cookie = caller) => (await http().get(`/api/events${query}`).set("Cookie", cookie)).body.events as EventDto[];
    expect((await list("?status=closed")).every((e) => e.status === "closed")).toBe(true);
    expect((await list("?status=open&status=closed")).every((e) => e.status === "open" || e.status === "closed")).toBe(true);
    expect((await list(`?ownerUserId=${caller2Id}`)).every((e) => e.ownerUserId === caller2Id)).toBe(true);
    expect((await list(`?templateId=${templateId}`, member)).length).toBeGreaterThan(0);
    expect((await http().get("/api/events?status=aberto").set("Cookie", caller)).status).toBe(400);
    expect((await http().get("/api/events?ownerUserId=eu").set("Cookie", caller)).status).toBe(400);
  });
});
