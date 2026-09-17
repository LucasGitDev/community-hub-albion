import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, runMigrations, schema, setAlbionCheck, type DbHandle } from "@albion-hub/db";
import type { AlbionLookupResult } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de gestão de membro não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/** Dublê da API do Albion: nenhum teste sai para a rede (a porta já promete nunca lançar). */
class FakeLookup implements AlbionPlayerLookup {
  result: AlbionLookupResult = { status: "disabled" };
  nicks: string[] = [];
  lookup(nick: string): Promise<AlbionLookupResult> {
    this.nicks.push(nick);
    return Promise.resolve(this.result);
  }
}

describe.skipIf(!baseUrl)("gestão de membro do admin (TASK-045)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  const albion = new FakeLookup();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_member_profile`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] })
      .overrideProvider(ALBION_PLAYER_LOOKUP)
      .useValue(albion)
      .compile();
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

  const setNick = (id: string, gameNick: string | null, guildTag: string | null = null) =>
    handle.db.update(schema.users).set({ gameNick, guildTag }).where(eq(schema.users.id, id));

  const check = (cookie: string, id: string) => http().post(`/api/admin/members/${id}/albion-check`).set("Cookie", cookie).set("Origin", PUBLIC_URL);
  const patch = (cookie: string, id: string, body: object) => http().patch(`/api/admin/members/${id}`).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body);
  const notes = (cookie: string, id: string) => http().get(`/api/admin/members/${id}/notes`).set("Cookie", cookie);
  const addNote = (cookie: string, id: string, body: object) => http().post(`/api/admin/members/${id}/notes`).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body);

  it("sem sessão 401; member e caller 403 nas quatro ações (TASK-047 AC#3)", async () => {
    const alvo = await session("450000000000000001", "alvo-perm");
    expect((await http().post(`/api/admin/members/${alvo.id}/albion-check`).set("Origin", PUBLIC_URL)).status).toBe(401);
    expect((await http().get(`/api/admin/members/${alvo.id}/notes`)).status).toBe(401);
    expect((await http().patch(`/api/admin/members/${alvo.id}`).set("Origin", PUBLIC_URL).send({ nick: "Qualquer" })).status).toBe(401);

    for (const [discordId, roles] of [
      ["450000000000000010", []],
      ["450000000000000011", ["caller"]],
    ] as const) {
      const who = await session(discordId, `curioso-${roles[0] ?? "membro"}`, [...roles]);
      expect((await check(who.cookie, alvo.id)).status).toBe(403);
      expect((await patch(who.cookie, alvo.id, { nick: "Invadido" })).status).toBe(403);
      expect((await notes(who.cookie, alvo.id)).status).toBe(403);
      expect((await addNote(who.cookie, alvo.id, { body: "não devia entrar" })).status).toBe(403);
      // A lista também: quem não gere ficha de membro não descobre quem existe (TASK-047 AC#3).
      expect((await http().get("/api/admin/members").set("Cookie", who.cookie)).status).toBe(403);
    }
    // Nada foi gravado por quem levou 403.
    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, alvo.id));
    expect(row!.gameNick).toBeNull();
    expect((await handle.db.select().from(schema.userNotes).where(eq(schema.userNotes.userId, alvo.id))).length).toBe(0);
  });

  it("staff alcança as quatro capacidades da gestão de usuários (TASK-047 AC#1)", async () => {
    const chefe = await session("450000000000000015", "staff-gestao", ["staff"]);
    const alvo = await session("450000000000000016", "alvo-staff");
    await setNick(alvo.id, "AlvoStaff");
    albion.result = { status: "found", region: "americas", playerId: "p-staff", name: "AlvoStaff", guildName: "Guilda", checkedAt: "2026-09-17T00:00:00.000Z" };

    // 1. buscar/revalidar o nick na API do Albion.
    const revalidado = await check(chefe.cookie, alvo.id);
    expect(revalidado.status).toBe(201);
    expect(revalidado.body.albion).toMatchObject({ status: "found", playerId: "p-staff" });

    // 2. editar nick e tag de guilda.
    const editado = await patch(chefe.cookie, alvo.id, { nick: "AlvoRenomeado", guildTag: "ABC" });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({ nick: "AlvoRenomeado", guildTag: "ABC" });

    // 3. escrever nota interna.
    const escrita = await addNote(chefe.cookie, alvo.id, { body: "conversei com ele no Discord" });
    expect(escrita.status).toBe(201);
    expect(escrita.body.note).toMatchObject({ kind: "staff", body: "conversei com ele no Discord" });

    // 4. ler as notas existentes (a do sistema, da edição, e a que a staff acabou de escrever).
    const lidas = await notes(chefe.cookie, alvo.id);
    expect(lidas.status).toBe(200);
    expect(lidas.body.notes.map((n: { body: string }) => n.body)).toContain("conversei com ele no Discord");
    expect(lidas.body.notes.some((n: { kind: string }) => n.kind === "system")).toBe(true);

    // E a lista de membros, que é por onde ela chega nas quatro.
    expect((await http().get("/api/admin/members").set("Cookie", chefe.cookie)).status).toBe(200);
  });

  it("staff não concede nem revoga papel: /admin/users segue só do admin (TASK-047 AC#2)", async () => {
    const chefe = await session("450000000000000017", "staff-sem-papel", ["staff"]);
    const alvo = await session("450000000000000018", "alvo-papel");

    // Ler a lista de papéis, conceder e revogar: as três portas que criariam outro admin.
    expect((await http().get("/api/admin/users").set("Cookie", chefe.cookie)).status).toBe(403);
    expect((await http().put(`/api/admin/users/${alvo.id}/roles/admin`).set("Cookie", chefe.cookie).set("Origin", PUBLIC_URL)).status).toBe(403);
    expect((await http().delete(`/api/admin/users/${alvo.id}/roles/caller`).set("Cookie", chefe.cookie).set("Origin", PUBLIC_URL)).status).toBe(403);

    // Nenhum papel foi criado por quem levou 403.
    const papeis = await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, alvo.id));
    expect(papeis.map((r) => r.role)).not.toContain("admin");
  });

  it("revalida o nick na API do Albion e grava status, player id, guilda e data (AC#1)", async () => {
    const boss = await session("450000000000000020", "chefe-check", ["admin"]);
    const alvo = await session("450000000000000021", "alvo-check");
    await setNick(alvo.id, "Erijj");
    albion.nicks = [];
    albion.result = { status: "found", region: "americas", playerId: "p-1", name: "Erijj", guildName: "Genei Rin", checkedAt: "2026-09-16T10:00:00.000Z" };

    const res = await check(boss.cookie, alvo.id);
    expect(res.status).toBe(201);
    expect(res.body.albion).toEqual({ status: "found", playerId: "p-1", guildName: "Genei Rin", checkedAt: "2026-09-16T10:00:00.000Z" });
    expect(albion.nicks).toEqual(["Erijj"]);

    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, alvo.id));
    expect(row!.albionStatus).toBe("found");
    expect(row!.albionPlayerId).toBe("p-1");
    expect(row!.albionGuildName).toBe("Genei Rin");
    expect(row!.albionCheckedAt?.toISOString()).toBe("2026-09-16T10:00:00.000Z");
  });

  it("nick que sumiu do Albion limpa player id e guilda; API fora do ar não derruba a requisição (AC#1)", async () => {
    const boss = await session("450000000000000022", "chefe-check2", ["admin"]);
    const alvo = await session("450000000000000023", "alvo-check2");
    await setNick(alvo.id, "Sumido");
    await setAlbionCheck(handle.db, alvo.id, { status: "found", playerId: "antigo", guildName: "Antiga", checkedAt: new Date("2026-01-01T00:00:00Z") });

    albion.result = { status: "not_found", region: "americas", checkedAt: "2026-09-16T11:00:00.000Z" };
    const gone = await check(boss.cookie, alvo.id);
    expect(gone.status).toBe(201);
    expect(gone.body.albion).toEqual({ status: "not_found", playerId: null, guildName: null, checkedAt: "2026-09-16T11:00:00.000Z" });

    albion.result = { status: "unavailable", region: "americas", checkedAt: "2026-09-16T12:00:00.000Z" };
    const down = await check(boss.cookie, alvo.id);
    expect(down.status).toBe(201);
    expect(down.body.albion.status).toBe("unavailable");
  });

  it("sem nick é 400 e consulta desligada é 503, os dois em PT-BR (AC#1)", async () => {
    const boss = await session("450000000000000024", "chefe-check3", ["admin"]);
    const semNick = await session("450000000000000025", "alvo-sem-nick");
    albion.nicks = [];
    const semNickRes = await check(boss.cookie, semNick.id);
    expect(semNickRes.status).toBe(400);
    expect(semNickRes.body.message).toContain("nick registrado");
    expect(albion.nicks).toEqual([]);

    const comNick = await session("450000000000000026", "alvo-desligado");
    await setNick(comNick.id, "Desligado");
    albion.result = { status: "disabled" };
    const off = await check(boss.cookie, comNick.id);
    expect(off.status).toBe(503);
    expect(off.body.message).toContain("desligada");
    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, comNick.id));
    expect(row!.albionStatus).toBeNull();
  });

  it("edita nick e tag, registra quem editou numa nota e zera a conferência antiga (AC#2)", async () => {
    const boss = await session("450000000000000030", "chefe-edita", ["admin"]);
    const alvo = await session("450000000000000031", "alvo-edita");
    await setNick(alvo.id, "NickVelho", "OLD");
    await setAlbionCheck(handle.db, alvo.id, { status: "found", playerId: "x", guildName: "Velha", checkedAt: new Date() });

    const res = await patch(boss.cookie, alvo.id, { nick: "NickNovo", guildTag: "[NEW]" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nick: "NickNovo", guildTag: "NEW" });
    expect(res.body.note.kind).toBe("system");
    expect(res.body.note.body).toBe("Editou nick NickVelho → NickNovo e tag de guilda OLD → NEW.");
    expect(res.body.note.author).toMatchObject({ id: boss.id, name: "chefe-edita" });

    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, alvo.id));
    expect(row!.gameNick).toBe("NickNovo");
    expect(row!.guildTag).toBe("NEW");
    // Nick trocado invalida a conferência: o "Encontrado" era de outro personagem.
    expect(row!.albionStatus).toBeNull();
    expect(row!.albionCheckedAt).toBeNull();

    // Salvar sem mudar nada não gera linha nova no histórico.
    const again = await patch(boss.cookie, alvo.id, { nick: "NickNovo", guildTag: "NEW" });
    expect(again.status).toBe(200);
    expect(again.body.note).toBeNull();
    expect((await notes(boss.cookie, alvo.id)).body.notes).toHaveLength(1);
  });

  it("recusa nick e tag fora do formato, usuário inexistente e nick de outro membro (AC#2)", async () => {
    const boss = await session("450000000000000032", "chefe-valida", ["admin"]);
    const alvo = await session("450000000000000033", "alvo-valida");
    const outro = await session("450000000000000034", "outro-valida");
    await setNick(outro.id, "JaUsado");

    for (const body of [{ nick: "ab" }, { nick: "nick com espaço" }, { nick: "A".repeat(17) }, { nick: "" }, { nick: "Valido", guildTag: "TAG COM ESPACO" }]) {
      const res = await patch(boss.cookie, alvo.id, body);
      expect(res.status).toBe(400);
      expect(typeof res.body.message).toBe("string");
    }
    expect((await patch(boss.cookie, "nao-e-uuid", { nick: "Valido" })).status).toBe(400);
    expect((await patch(boss.cookie, "00000000-0000-4000-8000-000000000000", { nick: "Valido" })).status).toBe(404);

    // Nick de outro membro, mesmo com outra caixa, é conflito: a lista ficaria ambígua.
    const clash = await patch(boss.cookie, alvo.id, { nick: "jausado" });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toContain("já usa esse nick");

    // Tag vazia é edição legítima: significa "saiu da guilda".
    const semGuilda = await patch(boss.cookie, alvo.id, { nick: "SemGuilda", guildTag: "" });
    expect(semGuilda.status).toBe(200);
    expect(semGuilda.body.guildTag).toBeNull();
  });

  it("notas ficam em ordem cronológica, com autor e data, e não têm rota de editar nem apagar (AC#3)", async () => {
    const boss = await session("450000000000000040", "chefe-nota", ["admin"]);
    const alvo = await session("450000000000000041", "alvo-nota");

    expect((await notes(boss.cookie, alvo.id)).body.notes).toEqual([]);
    const first = await addNote(boss.cookie, alvo.id, { body: "  avisei sobre o nick  " });
    expect(first.status).toBe(201);
    expect(first.body.note).toMatchObject({ kind: "staff", body: "avisei sobre o nick" });
    expect(first.body.note.author).toMatchObject({ id: boss.id, name: "chefe-nota" });
    expect(Date.parse(first.body.note.createdAt)).toBeGreaterThan(0);
    await addNote(boss.cookie, alvo.id, { body: "segunda nota" });

    const listed = await notes(boss.cookie, alvo.id);
    expect(listed.body.notes.map((n: { body: string }) => n.body)).toEqual(["avisei sobre o nick", "segunda nota"]);

    // Append-only: não existe rota de edição nem de remoção da nota.
    const noteId = first.body.note.id;
    for (const req of [
      http().patch(`/api/admin/members/${alvo.id}/notes/${noteId}`),
      http().put(`/api/admin/members/${alvo.id}/notes/${noteId}`),
      http().delete(`/api/admin/members/${alvo.id}/notes/${noteId}`),
    ])
      expect((await req.set("Cookie", boss.cookie).set("Origin", PUBLIC_URL)).status).toBe(404);
    expect((await notes(boss.cookie, alvo.id)).body.notes).toHaveLength(2);
  });

  it("nota vazia ou longa demais é 400 e não entra no histórico (AC#3)", async () => {
    const boss = await session("450000000000000042", "chefe-nota2", ["admin"]);
    const alvo = await session("450000000000000043", "alvo-nota2");
    for (const body of [{ body: "" }, { body: "   " }, { body: "x".repeat(1001) }, {}]) {
      expect((await addNote(boss.cookie, alvo.id, body)).status).toBe(400);
    }
    expect((await notes(boss.cookie, alvo.id)).body.notes).toEqual([]);
  });

  it("escrita de outra origem é 403 e não altera nada (AC#4)", async () => {
    const boss = await session("450000000000000050", "chefe-origem", ["admin"]);
    const alvo = await session("450000000000000051", "alvo-origem");
    const evil = "https://evil.example";
    expect((await http().patch(`/api/admin/members/${alvo.id}`).set("Cookie", boss.cookie).set("Origin", evil).send({ nick: "Roubado" })).status).toBe(403);
    expect((await http().post(`/api/admin/members/${alvo.id}/notes`).set("Cookie", boss.cookie).set("Origin", evil).send({ body: "oi" })).status).toBe(403);
    expect((await http().post(`/api/admin/members/${alvo.id}/albion-check`).set("Cookie", boss.cookie).set("Origin", evil)).status).toBe(403);

    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, alvo.id));
    expect(row!.gameNick).toBeNull();
    expect((await notes(boss.cookie, alvo.id)).body.notes).toEqual([]);
  });
});
