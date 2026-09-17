import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, getLedgerBalance, insertLedgerEntry, runMigrations, schema, type DbHandle } from "@albion-hub/db";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de banimento não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/**
 * Banimento de jogador pela API (TASK-050).
 *
 * O foco é o que um banimento malfeito custaria: alguém se banindo sem perceber, a comunidade ficando sem
 * admin, uma sessão antiga continuando a valer, um banido virando não-banido por um caminho que não é o
 * desbanir, e prata saindo do sistema com o saldo que deveria estar congelado.
 */
describe.skipIf(!baseUrl)("banimento de jogador (TASK-050)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_member_ban`;
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

  async function session(discordId: string, username: string, roles: string[] = []) {
    const res = await http().post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send({ discordId, username, roles });
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ah_session="))!.split(";")[0];
    const [user] = await handle.db.select().from(schema.users).where(eq(schema.users.discordId, discordId));
    return { cookie, id: user!.id };
  }

  const ban = (cookie: string, id: string, body: object) => http().post(`/api/admin/members/${id}/ban`).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body);
  const unban = (cookie: string, id: string) => http().delete(`/api/admin/members/${id}/ban`).set("Cookie", cookie).set("Origin", PUBLIC_URL);
  const members = (cookie: string, query = "") => http().get(`/api/admin/members${query}`).set("Cookie", cookie);

  it("sem sessão 401; member e caller 403; staff e admin banem (AC#1, AC#2)", async () => {
    const alvo = await session("700000000000000001", "alvo-perm");
    expect((await http().post(`/api/admin/members/${alvo.id}/ban`).set("Origin", PUBLIC_URL).send({ reason: "qualquer motivo" })).status).toBe(401);

    for (const [discordId, roles] of [
      ["700000000000000010", []],
      ["700000000000000011", ["caller"]],
    ] as const) {
      const who = await session(discordId, `sem-poder-${discordId}`, [...roles]);
      expect((await ban(who.cookie, alvo.id, { reason: "motivo qualquer" })).status).toBe(403);
      expect((await unban(who.cookie, alvo.id)).status).toBe(403);
    }

    const staffer = await session("700000000000000012", "staffer", ["staff"]);
    expect((await ban(staffer.cookie, alvo.id, { reason: "roubou o loot do split" })).status).toBe(200);
    expect((await unban(staffer.cookie, alvo.id)).status).toBe(204);

    const boss = await session("700000000000000013", "chefe", ["admin"]);
    expect((await ban(boss.cookie, alvo.id, { reason: "roubou o loot do split" })).status).toBe(200);
    expect((await unban(boss.cookie, alvo.id)).status).toBe(204);
  });

  it("motivo é obrigatório e tem tamanho mínimo (AC#1)", async () => {
    const boss = await session("700000000000000020", "chefe-motivo", ["admin"]);
    const alvo = await session("700000000000000021", "alvo-motivo");
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x" }, { reason: 42 }]) {
      expect((await ban(boss.cookie, alvo.id, body)).status).toBe(400);
    }
    const [row] = await handle.db.select({ bannedAt: schema.users.bannedAt }).from(schema.users).where(eq(schema.users.id, alvo.id));
    expect(row!.bannedAt).toBeNull();
  });

  it("ninguém bane a si mesmo (AC#3)", async () => {
    const boss = await session("700000000000000030", "chefe-self", ["admin"]);
    const outro = await session("700000000000000031", "outro-admin", ["admin"]);
    expect(outro.id).toBeTruthy();
    const res = await ban(boss.cookie, boss.id, { reason: "engano de clique na própria linha" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("si mesmo");
    // Continua entrando: a sessão dele não foi revogada por engano.
    expect((await members(boss.cookie)).status).toBe(200);
  });

  it("o último admin ativo não pode ser banido (AC#4)", async () => {
    const boss = await session("700000000000000040", "chefe-ultimo", ["admin"]);
    const outro = await session("700000000000000041", "chefe-reserva", ["admin"]);
    const staffer = await session("700000000000000042", "staffer-ultimo", ["staff"]);
    // Os outros testes deixam admins pelo caminho: aqui a comunidade tem exatamente estes dois.
    const outrosAdmins = await handle.db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.role, "admin"));
    const guardados = outrosAdmins.map((a) => a.userId).filter((id) => id !== boss.id && id !== outro.id);
    for (const id of guardados) await handle.db.delete(schema.userRoles).where(and(eq(schema.userRoles.userId, id), eq(schema.userRoles.role, "admin")));

    // Com dois admins, banir um passa; o que sobrou vira o último e não pode mais ser banido.
    expect((await ban(boss.cookie, outro.id, { reason: "sumiu com a prata da tesouraria" })).status).toBe(200);
    const res = await ban(staffer.cookie, boss.id, { reason: "tentativa de decapitar a comunidade" });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("último admin");
    // O admin que sobrou continua entrando: a recusa não pode ter revogado a sessão dele.
    expect((await members(boss.cookie)).status).toBe(200);

    expect((await unban(boss.cookie, outro.id)).status).toBe(204);
    for (const id of guardados) await handle.db.insert(schema.userRoles).values({ userId: id, role: "admin" });
  });

  it("banir revoga as sessões na hora e a conta continua na lista, marcada (AC#5, AC#11)", async () => {
    const boss = await session("700000000000000050", "chefe-sessao", ["admin"]);
    const alvo = await session("700000000000000051", "alvo-sessao");
    await handle.db.update(schema.users).set({ gameNick: "Erijj" }).where(eq(schema.users.id, alvo.id));
    // Antes: a sessão do alvo vale.
    expect((await http().get("/api/auth/me").set("Cookie", alvo.cookie)).status).toBe(200);

    const res = await ban(boss.cookie, alvo.id, { reason: "roubou o loot do split de 12/09" });
    expect(res.status).toBe(200);
    expect(res.body.ban).toMatchObject({ banReason: "roubou o loot do split de 12/09", bannedByName: "chefe-sessao" });

    // Depois: o cookie que ele já tinha na mão não vale mais.
    expect((await http().get("/api/auth/me").set("Cookie", alvo.cookie)).status).toBe(401);

    const lista = await members(boss.cookie, "?search=alvo-sessao");
    const linha = (lista.body.members as { id: string; ban: { reason: string; byName: string } | null }[]).find((m) => m.id === alvo.id);
    expect(linha!.ban).toMatchObject({ reason: "roubou o loot do split de 12/09", byName: "chefe-sessao" });
    expect((await members(boss.cookie, "?filter=banidos&search=alvo-sessao")).body.total).toBe(1);

    // O nick continua ocupado: outro membro não consegue tomar o nick do banido.
    const outro = await session("700000000000000052", "outro-nick");
    const conflito = await http().patch(`/api/admin/members/${outro.id}`).set("Cookie", boss.cookie).set("Origin", PUBLIC_URL).send({ nick: "Erijj" });
    expect(conflito.status).toBe(409);
  });

  it("staff não bane staff nem admin: 403 e só um admin faz isso (TASK-050)", async () => {
    const chefe = await session("700000000000000100", "chefe-hierarquia", ["admin"]);
    const staffer = await session("700000000000000101", "staffer-hierarquia", ["staff"]);
    const outroStaffer = await session("700000000000000102", "staffer-alvo", ["staff"]);
    const membro = await session("700000000000000103", "membro-alvo");

    // Staff bane quem está abaixo dela.
    expect((await ban(staffer.cookie, membro.id, { reason: "roubou o loot do split" })).ok ?? true).toBeTruthy();
    expect((await unban(chefe.cookie, membro.id)).status).toBe(204);

    const par = await ban(staffer.cookie, outroStaffer.id, { reason: "briga interna no voice" });
    expect(par.status).toBe(403);
    expect(par.body.message).toContain("admin");
    expect((await ban(staffer.cookie, chefe.id, { reason: "golpe de estado" })).status).toBe(403);

    // Admin bane a staff sem problema.
    expect((await ban(chefe.cookie, outroStaffer.id, { reason: "decisão do admin" })).status).toBe(200);
    expect((await unban(chefe.cookie, outroStaffer.id)).status).toBe(204);
  });

  it("banir de novo é 409 e desbanir quem não está banido é 409 (AC#12)", async () => {
    const boss = await session("700000000000000060", "chefe-dupla", ["admin"]);
    const alvo = await session("700000000000000061", "alvo-dupla");
    expect((await unban(boss.cookie, alvo.id)).status).toBe(409);
    expect((await ban(boss.cookie, alvo.id, { reason: "motivo suficientemente longo" })).status).toBe(200);
    expect((await ban(boss.cookie, alvo.id, { reason: "outro motivo qualquer" })).status).toBe(409);
    expect((await unban(boss.cookie, alvo.id)).status).toBe(204);
    expect((await unban(boss.cookie, alvo.id)).status).toBe(409);
  });

  it("saldo congelado: banido não pede saque e o pendente dele não é aprovado; o ledger não muda (AC#9, AC#10)", async () => {
    const boss = await session("700000000000000070", "chefe-saque", ["admin"]);
    const alvo = await session("700000000000000071", "alvo-saque");
    await insertLedgerEntry(handle.db, { currency: "silver", userId: alvo.id, amount: 1_000_000n, kind: "adjustment", memo: "saldo de teste", createdBy: boss.id });

    const pedido = await http().post("/api/me/withdrawals").set("Cookie", alvo.cookie).set("Origin", PUBLIC_URL).send({ amount: "400000" });
    expect(pedido.status).toBe(201);
    const pendenteId = (pedido.body.withdrawals as { id: string }[])[0]!.id;
    const antes = await getLedgerBalance(handle.db, alvo.id, "silver");

    expect((await ban(boss.cookie, alvo.id, { reason: "vendeu prata da tesouraria fora" })).status).toBe(200);

    // Aprovar o saque pendente do banido é recusado, com o motivo do banimento na mensagem.
    const aprovar = await http().post(`/api/withdrawals/${pendenteId}/approve`).set("Cookie", boss.cookie).set("Origin", PUBLIC_URL).send({});
    expect(aprovar.status).toBe(409);
    expect(aprovar.body.message).toContain("congelado");

    // Nada foi lançado: ledger intacto, sem estorno automático.
    expect(await getLedgerBalance(handle.db, alvo.id, "silver")).toBe(antes);

    // E ele não consegue nem pedir um saque novo: o guard já barra a sessão revogada.
    const novoPedido = await http().post("/api/me/withdrawals").set("Cookie", alvo.cookie).set("Origin", PUBLIC_URL).send({ amount: "1000" });
    expect(novoPedido.status).toBe(401);

    // Desbanido, a aprovação volta a ser possível e o saldo continua o mesmo de antes.
    expect((await unban(boss.cookie, alvo.id)).status).toBe(204);
    expect(await getLedgerBalance(handle.db, alvo.id, "silver")).toBe(antes);
    expect((await http().post(`/api/withdrawals/${pendenteId}/approve`).set("Cookie", boss.cookie).set("Origin", PUBLIC_URL).send({})).status).toBe(200);
  });

  it("o banimento vira nota no histórico do membro, e desbanir também (AC#11)", async () => {
    const boss = await session("700000000000000080", "chefe-nota", ["admin"]);
    const alvo = await session("700000000000000081", "alvo-nota");
    await ban(boss.cookie, alvo.id, { reason: "brigou com metade da guilda no voice" });
    await unban(boss.cookie, alvo.id);
    const res = await http().get(`/api/admin/members/${alvo.id}/notes`).set("Cookie", boss.cookie);
    const bodies = (res.body.notes as { kind: string; body: string }[]).map((n) => n.body);
    expect(bodies.some((b) => b.startsWith("Banido. Motivo: brigou com metade"))).toBe(true);
    expect(bodies.some((b) => b.startsWith("Desbanido."))).toBe(true);
  });

  it("id fora do formato é 400 e usuário inexistente é 404", async () => {
    const boss = await session("700000000000000090", "chefe-id", ["admin"]);
    expect((await ban(boss.cookie, "nao-e-uuid", { reason: "motivo qualquer" })).status).toBe(400);
    expect((await ban(boss.cookie, "00000000-0000-0000-0000-000000000000", { reason: "motivo qualquer" })).status).toBe(404);
    expect((await unban(boss.cookie, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
