import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, grantRole, runMigrations, schema, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de gestão de papéis não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

describe.skipIf(!baseUrl)("gestão de papéis por admin (TASK-011)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_admin_roles`;
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
      AUTH_DEV_LOGIN: "true",
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  /** Sessão via dev-login; devolve cookie e id interno. */
  async function session(discordId: string, username: string, roles: string[] = []) {
    const res = await http().post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send({ discordId, username, roles });
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ah_session="))!.split(";")[0];
    const [user] = await handle.db.select().from(schema.users).where(eq(schema.users.discordId, discordId));
    return { cookie, id: user!.id };
  }

  const rolesOf = async (id: string) => (await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, id))).map((r) => r.role).sort();

  it("sem sessão 401; member e staff 403 para listar e alterar (AC#2)", async () => {
    const target = await session("500000000000000001", "alvo");
    expect((await http().get("/api/admin/users")).status).toBe(401);
    for (const who of [await session("500000000000000002", "membro"), await session("500000000000000003", "staffer", ["staff"])]) {
      expect((await http().get("/api/admin/users").set("Cookie", who.cookie)).status).toBe(403);
      const put = await http().put(`/api/admin/users/${target.id}/roles/caller`).set("Cookie", who.cookie).set("Origin", PUBLIC_URL);
      expect(put.status).toBe(403);
      const del = await http().delete(`/api/admin/users/${who.id}/roles/staff`).set("Cookie", who.cookie).set("Origin", PUBLIC_URL);
      expect(del.status).toBe(403);
    }
    expect(await rolesOf(target.id)).toEqual(["member"]);
  });

  it("admin lista usuários com papéis e concede/remove caller (AC#1)", async () => {
    const boss = await session("500000000000000010", "chefe", ["admin"]);
    const target = await session("500000000000000011", "novo-caller");
    const list = await http().get("/api/admin/users").set("Cookie", boss.cookie);
    expect(list.status).toBe(200);
    expect(list.body.users.find((u: { id: string }) => u.id === target.id).roles).toEqual(["member"]);

    const grant = await http().put(`/api/admin/users/${target.id}/roles/caller`).set("Cookie", boss.cookie).set("Origin", PUBLIC_URL);
    expect(grant.status).toBe(204);
    expect(await rolesOf(target.id)).toEqual(["caller", "member"]);
    const [row] = await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.role, "caller"));
    expect(row!.grantedBy).toBe(boss.id);

    const revoke = await http().delete(`/api/admin/users/${target.id}/roles/caller`).set("Cookie", boss.cookie).set("Origin", PUBLIC_URL);
    expect(revoke.status).toBe(204);
    expect(await rolesOf(target.id)).toEqual(["member"]);
  });

  it("valida alvo: member não gerenciável, uuid inválido, usuário inexistente, outra origem", async () => {
    const boss = await session("500000000000000020", "chefe2", ["admin"]);
    const put = (path: string, origin = PUBLIC_URL) => http().put(path).set("Cookie", boss.cookie).set("Origin", origin);
    expect((await put(`/api/admin/users/${boss.id}/roles/member`)).status).toBe(400);
    expect((await put(`/api/admin/users/${boss.id}/roles/dono`)).status).toBe(400);
    expect((await put("/api/admin/users/nao-uuid/roles/caller")).status).toBe(400);
    expect((await put("/api/admin/users/00000000-0000-4000-8000-000000000000/roles/caller")).status).toBe(404);
    expect((await put(`/api/admin/users/${boss.id}/roles/caller`, "https://evil.example")).status).toBe(403);
  });

  it("não remove o último admin, nem em remoções concorrentes (AC#3)", async () => {
    await handle.db.delete(schema.userRoles).where(eq(schema.userRoles.role, "admin"));
    const a = await session("500000000000000030", "admin-a", ["admin"]);
    const b = await session("500000000000000031", "admin-b", ["admin"]);

    const results = await Promise.all([
      http().delete(`/api/admin/users/${a.id}/roles/admin`).set("Cookie", b.cookie).set("Origin", PUBLIC_URL),
      http().delete(`/api/admin/users/${b.id}/roles/admin`).set("Cookie", a.cookie).set("Origin", PUBLIC_URL),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // Um dos dois pode perder o papel antes; o outro pedido falha (409 último admin ou 403 porque já não é admin).
    expect(statuses[0]).toBe(204);
    expect([403, 409]).toContain(statuses[1]);
    const admins = await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.role, "admin"));
    expect(admins).toHaveLength(1);

    const last = admins[0]!.userId;
    const lastCookie = last === a.id ? a.cookie : b.cookie;
    const self = await http().delete(`/api/admin/users/${last}/roles/admin`).set("Cookie", lastCookie).set("Origin", PUBLIC_URL);
    expect(self.status).toBe(409);
    expect(self.body.message).toBe("Não é possível remover o último admin.");
    await grantRole(handle.db, last, "admin");
  });
});
