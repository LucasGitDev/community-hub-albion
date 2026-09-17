import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, insertLedgerEntry, requestWithdrawal, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { MAINTENANCE_LEDGER_REFERENCE, type Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import type { MemberLedgerResponse } from "./member-ledger.controller.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP do extrato da staff não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/**
 * Extrato de um jogador lido pela staff (TASK-051, G10).
 *
 * O teste que importa é o de permissão: na TASK-027 gatear por uma ação que todo membro logado tem vazou
 * ganho alheio. Aqui member e caller **têm** `read Wallet`, só que condicionada ao próprio id — então o
 * caso "membro pedindo extrato de outro" tem que ser 403, e é isso que AC#3 exige.
 */
describe.skipIf(!baseUrl)("GET /api/admin/members/:userId/ledger (TASK-051)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_member_ledger`;
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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function user(roles: Role[], nick?: string) {
    const discordId = `9600000000000000${String(++seq).padStart(2, "0")}`;
    const u = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${seq}` });
    for (const role of roles) await grantRole(handle.db, u.id, role);
    if (nick) await handle.db.execute(sql`update users set game_nick = ${nick} where id = ${u.id}`);
    const { token } = await createSession(handle.db, u.id, new Date(Date.now() + 3_600_000));
    return { id: u.id, cookie: `ah_session=${token}`, username: `u${seq}` };
  }

  const get = (path: string, cookie: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    if (cookie) req.set("Cookie", cookie);
    return req;
  };

  it("staff lê o extrato de qualquer jogador, com saldo, autor e prata em string (AC#1/AC#2/AC#4)", async () => {
    const staff = await user(["member", "staff"], "StaffNick");
    const alvo = await user(["member"], "AlvoNick");
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 1_000_000n, kind: "split_payout", createdBy: staff.id, memo: "Split do evento" });

    const res = await get(`/api/admin/members/${alvo.id}/ledger`, staff.cookie);
    expect(res.status).toBe(200);
    const body = res.body as MemberLedgerResponse;
    expect(body.member).toEqual({ id: alvo.id, name: "AlvoNick" });
    expect(body.balance).toEqual({ balance: "1000000", reserved: "0", available: "1000000" });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.amount).toBe("1000000");
    expect(typeof body.entries[0]!.amount).toBe("string");
    expect(body.entries[0]!.author).toEqual({ id: staff.id, name: "StaffNick" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("admin também lê (AC#1)", async () => {
    const admin = await user(["member", "admin"]);
    const alvo = await user(["member"]);
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 50n, kind: "split_payout" });
    const res = await get(`/api/admin/members/${alvo.id}/ledger`, admin.cookie);
    expect(res.status).toBe(200);
    expect((res.body as MemberLedgerResponse).entries).toHaveLength(1);
  });

  it("membro comum pedindo extrato alheio é 403 — a regra dele é condicionada ao próprio id (AC#3)", async () => {
    const alvo = await user(["member"]);
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 9_999_999n, kind: "split_payout", memo: "prata do outro" });
    const bisbilhoteiro = await user(["member"]);

    const res = await get(`/api/admin/members/${alvo.id}/ledger`, bisbilhoteiro.cookie);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("9999999");
  });

  it("caller pedindo extrato alheio também é 403: `read Event` não abre carteira (regressão da TASK-027) (AC#3)", async () => {
    const alvo = await user(["member"]);
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 8_888_888n, kind: "split_payout" });
    const caller = await user(["member", "caller"]);

    const res = await get(`/api/admin/members/${alvo.id}/ledger`, caller.cookie);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("8888888");
  });

  it("sem sessão é 401 (AC#3)", async () => {
    const alvo = await user(["member"]);
    const res = await get(`/api/admin/members/${alvo.id}/ledger`, null);
    expect(res.status).toBe(401);
  });

  it("reserva conta só saque pendente: aprovado já debitou no ledger e não é descontado duas vezes", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 1_000_000n, kind: "split_payout" });
    const pedido = await requestWithdrawal(handle.db, { userId: alvo.id, amount: 300_000n });
    expect(pedido.ok).toBe(true);

    const res = await get(`/api/admin/members/${alvo.id}/ledger`, staff.cookie);
    expect(res.body as MemberLedgerResponse).toMatchObject({ balance: { balance: "1000000", reserved: "300000", available: "700000" } });
  });

  it("ajuste da manutenção aparece com origem manual/maintenance, motivo e sem autor (TASK-048)", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    await insertLedgerEntry(handle.db, {
      userId: alvo.id,
      amount: -25_000n,
      kind: "adjustment",
      reference: MAINTENANCE_LEDGER_REFERENCE,
      createdBy: null,
      memo: "Acerto do split duplicado do dia 12",
    });

    const res = await get(`/api/admin/members/${alvo.id}/ledger`, staff.cookie);
    const entry = (res.body as MemberLedgerResponse).entries[0]!;
    expect(entry.kind).toBe("adjustment");
    expect(entry.referenceType).toBe("manual");
    expect(entry.referenceId).toBe("maintenance");
    expect(entry.author).toBeNull();
    expect(entry.memo).toBe("Acerto do split duplicado do dia 12");
  });

  it("extrato vazio é 200 com lista vazia e saldo zero, não erro", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    const res = await get(`/api/admin/members/${alvo.id}/ledger`, staff.cookie);
    expect(res.status).toBe(200);
    const body = res.body as MemberLedgerResponse;
    expect(body.entries).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.balance).toEqual({ balance: "0", reserved: "0", available: "0" });
  });

  it("pagina por cursor sem repetir nem pular lançamento (AC#2)", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    for (const amount of [1n, 2n, 3n, 4n, 5n]) await insertLedgerEntry(handle.db, { userId: alvo.id, amount, kind: "split_payout" });

    const first = await get(`/api/admin/members/${alvo.id}/ledger?limit=2`, staff.cookie);
    const page1 = first.body as MemberLedgerResponse;
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const second = await get(`/api/admin/members/${alvo.id}/ledger?limit=10&cursor=${encodeURIComponent(page1.nextCursor!)}`, staff.cookie);
    const page2 = second.body as MemberLedgerResponse;
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.entries, ...page2.entries].map((e) => e.id)).size).toBe(5);
  });

  it("recusa usuário, limite e cursor inválidos em PT-BR, e 404 para quem não existe", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    expect((await get("/api/admin/members/nao-e-uuid/ledger", staff.cookie)).status).toBe(400);
    expect((await get(`/api/admin/members/${alvo.id}/ledger?limit=0`, staff.cookie)).status).toBe(400);
    expect((await get(`/api/admin/members/${alvo.id}/ledger?cursor=lixo`, staff.cookie)).status).toBe(400);
    expect((await get("/api/admin/members/00000000-0000-4000-8000-000000000000/ledger", staff.cookie)).status).toBe(404);
  });

  it("a rota não escreve nada: só GET existe (leitura apenas)", async () => {
    const staff = await user(["member", "staff"]);
    const alvo = await user(["member"]);
    const post = await request(app.getHttpServer()).post(`/api/admin/members/${alvo.id}/ledger`).set("Cookie", staff.cookie).send({ amount: "1000" });
    expect(post.status).toBe(404);
  });
});
