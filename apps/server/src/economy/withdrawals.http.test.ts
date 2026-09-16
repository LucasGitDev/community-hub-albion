import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, getLedgerBalance, getWithdrawalBalance, grantRole, insertLedgerEntry, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de saque não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

describe.skipIf(!baseUrl)("saque HTTP (TASK-030, Q11/Q12/Q24/Q25)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_withdrawals`;
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

  /** Usuário com papéis e, opcionalmente, saldo de prata já no ledger. */
  async function actor(roles: Role[], silver = 0n) {
    const discordId = `9400000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `w${seq}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (silver !== 0n) await insertLedgerEntry(handle.db, { userId: user.id, amount: silver, kind: "split_payout", memo: "saldo" });
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { id: user.id, cookie: `ah_session=${token}` };
  }

  const server = () => app.getHttpServer();
  const post = (path: string, cookie: string | null, body: unknown = {}, origin: string | null = PUBLIC_URL) => {
    const req = request(server()).post(path);
    if (origin) req.set("Origin", origin);
    if (cookie) req.set("Cookie", cookie);
    return req.send(body as object);
  };
  const get = (path: string, cookie: string | null) => {
    const req = request(server()).get(path);
    if (cookie) req.set("Cookie", cookie);
    return req;
  };

  /** Membro com saldo que já pediu um saque `pending`. */
  async function pendingOf(silver: bigint, amount: string) {
    const member = await actor(["member"], silver);
    const res = await post("/api/me/withdrawals", member.cookie, { amount });
    expect(res.status).toBe(201);
    return { member, id: (res.body as { withdrawals: { id: string }[] }).withdrawals[0]!.id };
  }

  describe("pedido do membro (AC#1, AC#2)", () => {
    it("cria o pendente, reserva o saldo e não mexe no ledger", async () => {
      const member = await actor(["member"], 1_000_000n);
      const res = await post("/api/me/withdrawals", member.cookie, { amount: "400000" });
      expect(res.status).toBe(201);
      expect(res.body.balance).toEqual({ balance: "1000000", reserved: "400000", available: "600000" });
      expect(res.body.withdrawals).toHaveLength(1);
      expect(res.body.withdrawals[0]).toMatchObject({ amount: "400000", status: "pending", userId: member.id, ledgerEntryId: null });
      expect(await getLedgerBalance(handle.db, member.id)).toBe(1_000_000n);
    });

    it("aceita 1 de prata: não existe valor mínimo (Q12 revisado)", async () => {
      const member = await actor(["member"], 10n);
      expect((await post("/api/me/withdrawals", member.cookie, { amount: 1 })).status).toBe(201);
    });

    it("409 acima do disponível e 400 em valor inválido", async () => {
      const member = await actor(["member"], 100n);
      const over = await post("/api/me/withdrawals", member.cookie, { amount: "101" });
      expect(over.status).toBe(409);
      expect(over.body.message).toContain("100");
      expect((await post("/api/me/withdrawals", member.cookie, { amount: 0 })).status).toBe(400);
      expect((await post("/api/me/withdrawals", member.cookie, { amount: "abc" })).status).toBe(400);
      expect((await post("/api/me/withdrawals", member.cookie, { amount: 1.5 })).status).toBe(400);
    });

    it("409 com saldo negativo (Q24)", async () => {
      const member = await actor(["member"], 1_000n);
      await insertLedgerEntry(handle.db, { userId: member.id, amount: -2_000n, kind: "adjustment", memo: "estorno" });
      const res = await post("/api/me/withdrawals", member.cookie, { amount: "1" });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain("negativo");
    });

    it("401 sem sessão e 403 de outra origem (CSRF)", async () => {
      const member = await actor(["member"], 1_000n);
      expect((await post("/api/me/withdrawals", null, { amount: "1" })).status).toBe(401);
      expect((await post("/api/me/withdrawals", member.cookie, { amount: "1" }, "https://evil.example")).status).toBe(403);
      expect((await get("/api/me/withdrawals", null)).status).toBe(401);
    });
  });

  describe("segurança: ninguém age nem lê no nome de outro (AC#6)", () => {
    it("userId no corpo do pedido é ignorado: o saque nasce do dono da sessão", async () => {
      const vitima = await actor(["member"], 1_000_000n);
      const atacante = await actor(["member"], 5_000n);
      const res = await post("/api/me/withdrawals", atacante.cookie, { amount: "5000", userId: vitima.id });
      expect(res.status).toBe(201);
      expect(res.body.withdrawals[0].userId).toBe(atacante.id);
      // O saldo da vítima não foi tocado.
      expect(await getWithdrawalBalance(handle.db, vitima.id)).toMatchObject({ reserved: 0n, available: 1_000_000n });
    });

    it("GET /me/withdrawals só devolve os saques e o saldo de quem está logado", async () => {
      const { member: outro } = await pendingOf(500_000n, "200000");
      const atacante = await actor(["member"], 0n);
      const res = await get("/api/me/withdrawals", atacante.cookie);
      expect(res.status).toBe(200);
      expect(res.body.withdrawals).toEqual([]);
      expect(res.body.balance).toEqual({ balance: "0", reserved: "0", available: "0" });
      expect(JSON.stringify(res.body)).not.toContain(outro.id);
    });

    it("membro pedindo a lista de outro leva 403, e sem filtro só vê a própria", async () => {
      const { member: dono } = await pendingOf(300_000n, "100000");
      const atacante = await actor(["member"], 50_000n);
      await post("/api/me/withdrawals", atacante.cookie, { amount: "50000" });
      expect((await get(`/api/withdrawals?userId=${dono.id}`, atacante.cookie)).status).toBe(403);
      const mine = await get("/api/withdrawals", atacante.cookie);
      expect(mine.status).toBe(200);
      expect(mine.body.withdrawals.every((w: { userId: string }) => w.userId === atacante.id)).toBe(true);
    });

    it("saque de outro membro responde 404: nem a existência do id vaza", async () => {
      const { id } = await pendingOf(300_000n, "100000");
      const atacante = await actor(["member"], 0n);
      expect((await get(`/api/withdrawals/${id}`, atacante.cookie)).status).toBe(404);
      // A staff, essa sim, enxerga.
      const staff = await actor(["member", "staff"]);
      expect((await get(`/api/withdrawals/${id}`, staff.cookie)).status).toBe(200);
    });

    it("membro não aprova, não recusa e não liquida (403), inclusive o próprio saque", async () => {
      const { member, id } = await pendingOf(300_000n, "100000");
      for (const action of ["approve", "reject", "settle"]) {
        const res = await post(`/api/withdrawals/${id}/${action}`, member.cookie, { note: "libera pra mim" });
        expect(res.status).toBe(403);
      }
      // Nada aconteceu: continua pendente e sem lançamento.
      expect(await getLedgerBalance(handle.db, member.id)).toBe(300_000n);
      const staff = await actor(["member", "staff"]);
      expect((await get(`/api/withdrawals/${id}`, staff.cookie)).body.status).toBe("pending");
    });
  });

  describe("decisão da staff (AC#3, AC#4)", () => {
    it("aprovar debita no ledger e some da reserva", async () => {
      const { member, id } = await pendingOf(1_000_000n, "250000");
      const staff = await actor(["member", "staff"]);
      const res = await post(`/api/withdrawals/${id}/approve`, staff.cookie, { note: "conferido" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "approved", decidedByUserId: staff.id });
      expect(res.body.ledgerEntryId).not.toBeNull();
      expect(await getLedgerBalance(handle.db, member.id)).toBe(750_000n);
      expect(await getWithdrawalBalance(handle.db, member.id)).toMatchObject({ reserved: 0n, available: 750_000n });
    });

    it("recusar libera a reserva sem lançamento, e o motivo é obrigatório", async () => {
      const { member, id } = await pendingOf(1_000_000n, "900000");
      const staff = await actor(["member", "staff"]);
      expect((await post(`/api/withdrawals/${id}/reject`, staff.cookie, {})).status).toBe(400);
      expect((await post(`/api/withdrawals/${id}/reject`, staff.cookie, { note: "   " })).status).toBe(400);
      const res = await post(`/api/withdrawals/${id}/reject`, staff.cookie, { note: "valor errado" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "rejected", decisionNote: "valor errado", ledgerEntryId: null });
      expect(await getLedgerBalance(handle.db, member.id)).toBe(1_000_000n);
      expect(await getWithdrawalBalance(handle.db, member.id)).toMatchObject({ reserved: 0n, available: 1_000_000n });
    });

    it("liquidar exige nota e grava quem liquidou (Q11)", async () => {
      const { id } = await pendingOf(300_000n, "300000");
      const staff = await actor(["member", "staff"]);
      expect((await post(`/api/withdrawals/${id}/settle`, staff.cookie, {})).status).toBe(400);
      await post(`/api/withdrawals/${id}/approve`, staff.cookie, {});
      const res = await post(`/api/withdrawals/${id}/settle`, staff.cookie, { note: "transferido 21h" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "settled", settledByUserId: staff.id, settlementNote: "transferido 21h" });
      expect(res.body.settledAt).not.toBeNull();
    });

    it("409 PT-BR em transição fora da máquina", async () => {
      const { id } = await pendingOf(100_000n, "100000");
      const staff = await actor(["member", "staff"]);
      const early = await post(`/api/withdrawals/${id}/settle`, staff.cookie, { note: "pago" });
      expect(early.status).toBe(409);
      expect(early.body.message).toContain("aguardando aprovação");
      await post(`/api/withdrawals/${id}/reject`, staff.cookie, { note: "não" });
      const late = await post(`/api/withdrawals/${id}/approve`, staff.cookie, {});
      expect(late.status).toBe(409);
      expect(late.body.message).toContain("estado final");
    });

    it("a fila da staff mostra todo mundo e filtra por estado", async () => {
      const staff = await actor(["member", "staff"]);
      const { id } = await pendingOf(80_000n, "80000");
      await pendingOf(90_000n, "90000");
      await post(`/api/withdrawals/${id}/reject`, staff.cookie, { note: "não" });
      const pending = await get("/api/withdrawals?status=pending", staff.cookie);
      expect(pending.status).toBe(200);
      expect(pending.body.withdrawals.every((w: { status: string }) => w.status === "pending")).toBe(true);
      expect(pending.body.withdrawals.map((w: { id: string }) => w.id)).not.toContain(id);
      expect(pending.body.withdrawals[0].userNick).toBeTruthy();
      expect((await get("/api/withdrawals?status=nope", staff.cookie)).status).toBe(400);
    });
  });
});
