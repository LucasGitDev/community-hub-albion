import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { EventRoleDto, EventTemplateDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de templates não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!baseUrl)("catálogo de roles e templates HTTP (TASK-020, Q8)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let staff: string;
  let caller: string;
  let member: string;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_templates`;
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
      PUBLIC_URL,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    staff = await login("620000000000000001", ["member", "staff"]);
    caller = await login("620000000000000002", ["member", "caller"]);
    member = await login("620000000000000003", ["member"]);
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
  const roles = async () => (await http().get("/api/event-roles").set("Cookie", staff)).body.roles as EventRoleDto[];
  const roleId = async (name: string) => (await roles()).find((r) => r.name === name)!.id;

  it("sem sessão 401 em leitura e escrita", async () => {
    expect((await http().get("/api/event-roles")).status).toBe(401);
    expect((await http().get("/api/event-templates")).status).toBe(401);
    expect((await send("post", "/api/event-roles", null, { name: "X" })).status).toBe(401);
    expect((await send("delete", `/api/event-templates/${MISSING}`, null)).status).toBe(401);
  });

  it("membro 403 em tudo; caller só lê (AC#4)", async () => {
    expect((await http().get("/api/event-roles").set("Cookie", member)).status).toBe(403);
    expect((await http().get("/api/event-templates").set("Cookie", member)).status).toBe(403);
    const tank = await roleId("Tank");
    const tpl = { name: "Proibido", minPartySize: 1, maxPartySize: null, roles: [{ roleId: tank, slots: 1 }] };
    for (const cookie of [member, caller]) {
      expect((await send("post", "/api/event-roles", cookie, { name: "Hacker" })).status).toBe(403);
      expect((await send("patch", `/api/event-roles/${tank}`, cookie, { name: "Hacker" })).status).toBe(403);
      expect((await send("delete", `/api/event-roles/${tank}`, cookie)).status).toBe(403);
      expect((await send("post", "/api/event-templates", cookie, tpl)).status).toBe(403);
      expect((await send("patch", `/api/event-templates/${MISSING}`, cookie, { active: false })).status).toBe(403);
      expect((await send("delete", `/api/event-templates/${MISSING}`, cookie)).status).toBe(403);
    }
    const read = await http().get("/api/event-roles").set("Cookie", caller);
    expect(read.status).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect((read.body.roles as EventRoleDto[]).map((r) => r.name)).toEqual(["Tank", "Healer", "DPS Melee", "DPS Range", "Support", "Scout"]);
    expect((await http().get("/api/event-templates").set("Cookie", caller)).status).toBe(200);
    expect((await roles()).map((r) => r.name)).not.toContain("Hacker");
  });

  it("staff cria e edita role; duplicado 409, inválido 400, outra origem 403 (AC#1)", async () => {
    const created = await send("post", "/api/event-roles", staff, { name: "  Batedor ", description: "abre caminho" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Batedor", description: "abre caminho", templateCount: 0 });
    const edited = await send("patch", `/api/event-roles/${created.body.id}`, staff, { name: "Batedor Rápido", description: "" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Batedor Rápido", description: null });
    const dup = await send("post", "/api/event-roles", staff, { name: "tank" });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("Já existe uma role com esse nome.");
    expect((await send("patch", `/api/event-roles/${created.body.id}`, staff, { name: "HEALER" })).status).toBe(409);
    const blank = await send("post", "/api/event-roles", staff, { name: " " });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe("Digite o nome da role.");
    expect((await send("patch", "/api/event-roles/nao-uuid", staff, { name: "X" })).status).toBe(400);
    expect((await send("patch", `/api/event-roles/${MISSING}`, staff, { name: "X" })).status).toBe(404);
    expect((await send("post", "/api/event-roles", staff, { name: "Evil" }, "https://evil.example")).status).toBe(403);
    expect((await roles()).map((r) => r.name)).not.toContain("Evil");
  });

  it("staff cria template com roles e vagas, edita parcial e valida party (AC#2)", async () => {
    const [tank, healer, dps] = [await roleId("Tank"), await roleId("Healer"), await roleId("DPS Melee")];
    const body = { name: "DG de grupo", description: "Dungeon em grupo", minPartySize: 4, maxPartySize: 9, roles: [{ roleId: tank, slots: 1 }, { roleId: healer, slots: 1 }, { roleId: dps, slots: 5 }] };
    const created = await send("post", "/api/event-templates", staff, body);
    expect(created.status).toBe(201);
    const tpl = created.body as EventTemplateDto;
    expect(tpl).toMatchObject({ name: "DG de grupo", active: true, totalSlots: 7, roles: [{ name: "Tank", slots: 1 }, { name: "Healer", slots: 1 }, { name: "DPS Melee", slots: 5 }] });

    const over = await send("post", "/api/event-templates", staff, { ...body, name: "Cheio", roles: [{ roleId: dps, slots: 10 }] });
    expect(over.status).toBe(400);
    expect(over.body.message).toContain("acima do máximo de 9");
    expect((await send("post", "/api/event-templates", staff, { ...body, roles: [{ roleId: tank, slots: 0 }] })).status).toBe(400);
    expect((await send("post", "/api/event-templates", staff, { ...body, name: "dg DE GRUPO" })).status).toBe(409);
    expect((await send("post", "/api/event-templates", staff, { ...body, name: "Fantasma", roles: [{ roleId: MISSING, slots: 4 }] })).status).toBe(400);

    const patched = await send("patch", `/api/event-templates/${tpl.id}`, staff, { active: false, maxPartySize: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ active: false, maxPartySize: null, totalSlots: 7, name: "DG de grupo" });
    const badPatch = await send("patch", `/api/event-templates/${tpl.id}`, staff, { minPartySize: 8 });
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.message).toContain("abaixo do mínimo de 8");
    expect((await send("patch", `/api/event-templates/${MISSING}`, staff, { active: true })).status).toBe(404);

    const list = await http().get("/api/event-templates").set("Cookie", caller);
    expect((list.body.templates as EventTemplateDto[]).find((t) => t.id === tpl.id)).toMatchObject({ totalSlots: 7, active: false });
  });

  it("role em uso por template não pode ser apagada: 409 PT-BR; depois de liberar, apaga (AC#3)", async () => {
    const created = await send("post", "/api/event-roles", staff, { name: "Arqueiro" });
    const tank = await roleId("Tank");
    const tpl = await send("post", "/api/event-templates", staff, { name: "Caçada", minPartySize: 3, maxPartySize: 7, roles: [{ roleId: created.body.id, slots: 2 }, { roleId: tank, slots: 1 }] });
    expect(tpl.status).toBe(201);
    expect((await roles()).find((r) => r.id === created.body.id)!.templateCount).toBe(1);

    const blocked = await send("delete", `/api/event-roles/${created.body.id}`, staff);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("em uso por um template");
    expect((await roles()).map((r) => r.id)).toContain(created.body.id);

    expect((await send("patch", `/api/event-templates/${tpl.body.id}`, staff, { roles: [{ roleId: tank, slots: 3 }] })).status).toBe(200);
    expect((await send("delete", `/api/event-roles/${created.body.id}`, staff)).status).toBe(204);
    expect((await send("delete", `/api/event-roles/${created.body.id}`, staff)).status).toBe(404);
    expect((await send("delete", `/api/event-templates/${tpl.body.id}`, staff)).status).toBe(204);
    expect((await send("delete", `/api/event-templates/${tpl.body.id}`, staff)).status).toBe(404);
    expect((await send("delete", "/api/event-templates/nao-uuid", staff)).status).toBe(400);
  });
});
