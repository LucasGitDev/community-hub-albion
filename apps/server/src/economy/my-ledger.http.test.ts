import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, insertLedgerEntry, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { LedgerEntryDto } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP do extrato não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

interface Page {
  entries: LedgerEntryDto[];
  nextCursor: string | null;
}

/** Extrato do membro (TASK-031, AC#1/AC#2). O foco aqui é: cada um só vê a própria prata. */
describe.skipIf(!baseUrl)("GET /api/me/ledger (TASK-031)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_my_ledger`;
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

  async function member(entries: bigint[] = []) {
    const discordId = `9500000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `l${seq}` });
    await grantRole(handle.db, user.id, "member");
    for (const amount of entries) await insertLedgerEntry(handle.db, { userId: user.id, amount, kind: amount > 0n ? "split_payout" : "withdrawal", memo: "teste" });
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { id: user.id, cookie: `ah_session=${token}` };
  }

  const get = (path: string, cookie: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    if (cookie) req.set("Cookie", cookie);
    return req;
  };

  it("devolve o extrato do dono da sessão, do mais novo pro mais antigo, com prata em string (Q20)", async () => {
    const me = await member([1_000_000n, -400_000n, 250_000n]);
    const res = await get("/api/me/ledger", me.cookie);
    expect(res.status).toBe(200);
    const body = res.body as Page;
    expect(body.entries).toHaveLength(3);
    expect(body.entries.map((e) => e.amount)).toEqual(["250000", "-400000", "1000000"]);
    expect(body.entries[0]!.kind).toBe("split_payout");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("extrato vazio é 200 com lista vazia, não erro", async () => {
    const me = await member();
    const res = await get("/api/me/ledger", me.cookie);
    expect(res.status).toBe(200);
    expect((res.body as Page).entries).toEqual([]);
    expect((res.body as Page).nextCursor).toBeNull();
  });

  it("ignora ?userId= de outro membro: o dono vem da sessão (AC#2)", async () => {
    const outro = await member([9_999_999n]);
    const me = await member([7n]);
    const res = await get(`/api/me/ledger?userId=${outro.id}`, me.cookie);
    expect(res.status).toBe(200);
    const body = res.body as Page;
    expect(body.entries.map((e) => e.amount)).toEqual(["7"]);
    expect(JSON.stringify(body)).not.toContain("9999999");
  });

  it("sem sessão é 401 (AC#2)", async () => {
    const res = await get("/api/me/ledger", null);
    expect(res.status).toBe(401);
  });

  it("pagina por cursor sem repetir nem pular lançamento", async () => {
    const me = await member([1n, 2n, 3n, 4n, 5n]);
    const first = await get("/api/me/ledger?limit=2", me.cookie);
    const page1 = first.body as Page;
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const second = await get(`/api/me/ledger?limit=10&cursor=${encodeURIComponent(page1.nextCursor!)}`, me.cookie);
    const page2 = second.body as Page;
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.entries, ...page2.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("recusa limite e cursor inválidos em PT-BR", async () => {
    const me = await member();
    const limit = await get("/api/me/ledger?limit=0", me.cookie);
    expect(limit.status).toBe(400);
    expect((limit.body as { message: string }).message).toMatch(/limite do extrato/i);
    const cursor = await get("/api/me/ledger?cursor=lixo", me.cookie);
    expect(cursor.status).toBe(400);
    expect((cursor.body as { message: string }).message).toMatch(/Cursor/i);
  });
});
