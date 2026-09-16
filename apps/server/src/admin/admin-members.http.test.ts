import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, runMigrations, schema, setAlbionCheck, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { emptyImportSummary, IMPORT_MEMBERS_HTTP_ERRORS, type MemberImportSummary } from "../domain/member-import.js";
import type { MemberImporter } from "../members/member-importer.token.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da lista de membros não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/** Dublê do import: nenhum teste toca no Discord nem na API do Albion (AC#3). */
class FakeImporter implements MemberImporter {
  result: MemberImportSummary | Error = emptyImportSummary();
  calls = 0;
  async import(): Promise<MemberImportSummary> {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe.skipIf(!baseUrl)("lista de membros do admin (TASK-043)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  const importer = new FakeImporter();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_admin_members`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false, memberImporter: importer })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function session(discordId: string, username: string, roles: string[] = []) {
    const res = await http().post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send({ discordId, username, roles });
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ah_session="))!.split(";")[0];
    const [user] = await handle.db.select().from(schema.users).where(eq(schema.users.discordId, discordId));
    return { cookie, id: user!.id };
  }

  const list = (cookie: string, query = "") => http().get(`/api/admin/members${query}`).set("Cookie", cookie);

  it("sem sessão 401; member e staff 403 na lista e no import (AC#5)", async () => {
    expect((await http().get("/api/admin/members")).status).toBe(401);
    expect((await http().post("/api/admin/members/import").set("Origin", PUBLIC_URL)).status).toBe(401);
    for (const who of [await session("560000000000000001", "membro"), await session("560000000000000002", "staffer", ["staff"])]) {
      expect((await list(who.cookie)).status).toBe(403);
      expect((await http().post("/api/admin/members/import").set("Cookie", who.cookie).set("Origin", PUBLIC_URL)).status).toBe(403);
    }
    expect(importer.calls).toBe(0);
  });

  it("admin vê nick, tag de guilda, papéis, entrada e status do Albion (AC#1, AC#2)", async () => {
    const boss = await session("560000000000000010", "chefe", ["admin"]);
    const target = await session("560000000000000011", "erijj-discord", ["caller"]);
    await handle.db.update(schema.users).set({ gameNick: "Erijj", guildTag: "GENEI" }).where(eq(schema.users.id, target.id));
    await setAlbionCheck(handle.db, target.id, { status: "found", playerId: "abc123", guildName: "Genei Rin", checkedAt: new Date("2026-09-15T12:00:00Z") });

    const res = await list(boss.cookie, "?search=erijj");
    expect(res.status).toBe(200);
    const member = res.body.members.find((m: { id: string }) => m.id === target.id);
    expect(member).toMatchObject({
      discordId: "560000000000000011",
      discordUsername: "erijj-discord",
      gameNick: "Erijj",
      guildTag: "GENEI",
      albion: { status: "found", playerId: "abc123", guildName: "Genei Rin" },
    });
    expect(member.roles.sort()).toEqual(["caller", "member"]);
    expect(Date.parse(member.createdAt)).toBeGreaterThan(0);
    expect(member.albion.checkedAt).toBe("2026-09-15T12:00:00.000Z");
  });

  it("busca acha por nick ou por usuário do Discord, e trata % como texto (AC#4)", async () => {
    const boss = await session("560000000000000020", "chefe-busca", ["admin"]);
    const byNick = await session("560000000000000021", "usuario-um");
    await handle.db.update(schema.users).set({ gameNick: "ZircaoBusca" }).where(eq(schema.users.id, byNick.id));
    const byUser = await session("560000000000000022", "zircaobusca-user");

    const nick = await list(boss.cookie, "?search=ZIRCAOBUSCA");
    expect(nick.body.members.map((m: { id: string }) => m.id).sort()).toEqual([byNick.id, byUser.id].sort());
    expect((await list(boss.cookie, "?search=%25")).body.members).toHaveLength(0);
    expect((await list(boss.cookie, "?search=naoexistemesmo")).body.total).toBe(0);
  });

  it("filtra não encontrados e sem nick, e devolve a contagem de cada chip (AC#4)", async () => {
    await handle.db.delete(schema.users).where(sql`${schema.users.discordUsername} like 'filtro-%'`);
    const boss = await session("560000000000000030", "filtro-chefe", ["admin"]);
    const perdido = await session("560000000000000031", "filtro-perdido");
    await handle.db.update(schema.users).set({ gameNick: "FiltroPerdido" }).where(eq(schema.users.id, perdido.id));
    await setAlbionCheck(handle.db, perdido.id, { status: "not_found", checkedAt: new Date() });
    const semNick = await session("560000000000000032", "filtro-semnick");

    const todos = await list(boss.cookie, "?search=filtro-");
    expect(todos.body.counts).toEqual({ todos: 3, nao_encontrados: 1, sem_nick: 2 });
    expect(todos.body.total).toBe(3);

    const naoEncontrados = await list(boss.cookie, "?search=filtro-&filter=nao_encontrados");
    expect(naoEncontrados.body.members.map((m: { id: string }) => m.id)).toEqual([perdido.id]);
    expect(naoEncontrados.body.total).toBe(1);

    const sem = await list(boss.cookie, "?search=filtro-&filter=sem_nick");
    expect(sem.body.members.map((m: { id: string }) => m.id).sort()).toEqual([boss.id, semNick.id].sort());

    // Filtro desconhecido não quebra: cai em todos.
    expect((await list(boss.cookie, "?search=filtro-&filter=banidos")).body.total).toBe(3);
  });

  it("pagina com total estável e não repete membro entre páginas (AC#1)", async () => {
    await handle.db.delete(schema.users).where(sql`${schema.users.discordUsername} like 'pagina-%'`);
    const boss = await session("560000000000000040", "pagina-chefe", ["admin"]);
    for (let i = 1; i <= 4; i++) await session(`56000000000000005${i}`, `pagina-${i}`);

    const first = await list(boss.cookie, "?search=pagina-&page=1&pageSize=2");
    expect(first.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(first.body.members).toHaveLength(2);
    const second = await list(boss.cookie, "?search=pagina-&page=2&pageSize=2");
    expect(second.body.members).toHaveLength(2);
    const third = await list(boss.cookie, "?search=pagina-&page=3&pageSize=2");
    expect(third.body.members).toHaveLength(1);
    const ids = [...first.body.members, ...second.body.members, ...third.body.members].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(5);
    // Página fora do fim devolve lista vazia sem erro.
    expect((await list(boss.cookie, "?search=pagina-&page=9&pageSize=2")).body.members).toHaveLength(0);
  });

  it("import de admin devolve o resumo do serviço e exige mesma origem (AC#1 da TASK-042)", async () => {
    const boss = await session("560000000000000060", "chefe-import", ["admin"]);
    importer.calls = 0;
    importer.result = { ...emptyImportSummary(), created: 3, updated: 2, skipped: 7, conflicts: ["`[X] ??` — apelido inválido"] };

    const res = await http().post("/api/admin/members/import").set("Cookie", boss.cookie).set("Origin", PUBLIC_URL);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 3, updated: 2, skipped: 7, conflicts: ["`[X] ??` — apelido inválido"] });
    expect(importer.calls).toBe(1);

    const crossOrigin = await http().post("/api/admin/members/import").set("Cookie", boss.cookie).set("Origin", "https://evil.example");
    expect(crossOrigin.status).toBe(403);
    expect(importer.calls).toBe(1);
  });

  it("403 do Discord vira instrução PT-BR de ligar o Server Members Intent", async () => {
    const boss = await session("560000000000000061", "chefe-intent", ["admin"]);
    importer.result = Object.assign(new Error("Missing Access"), { status: 403 });
    const res = await http().post("/api/admin/members/import").set("Cookie", boss.cookie).set("Origin", PUBLIC_URL);
    expect(res.status).toBe(502);
    expect(res.body.message).toBe(IMPORT_MEMBERS_HTTP_ERRORS.forbidden);
    expect(res.body.message).toContain("Server Members Intent");

    importer.result = new Error("banco fora do ar");
    const other = await http().post("/api/admin/members/import").set("Cookie", boss.cookie).set("Origin", PUBLIC_URL);
    expect(other.status).toBe(502);
    expect(other.body.message).toBe(IMPORT_MEMBERS_HTTP_ERRORS.failed);
    importer.result = emptyImportSummary();
  });
});
