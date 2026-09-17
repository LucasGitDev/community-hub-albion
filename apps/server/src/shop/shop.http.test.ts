import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, insertLedgerEntry, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { ShopCatalogResponse, ShopItemDto } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP da loja não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/**
 * Loja pela API (TASK-059). O foco aqui é o que só o HTTP prova: quem enxerga o quê, quem pode cadastrar,
 * e que a compra é sempre do dono da sessão — a regra da reserva em si é testada no repo, contra o banco.
 */
describe.skipIf(!baseUrl)("/api/shop (TASK-059)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_shop`;
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

  async function member(roles: ("member" | "staff")[] = ["member"], buffunfa = 0n) {
    const discordId = `9600000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `loja${seq}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (buffunfa !== 0n) await insertLedgerEntry(handle.db, { currency: "buffunfa", userId: user.id, amount: buffunfa, kind: "split_payout", memo: "presença" });
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { id: user.id, cookie: `ah_session=${token}` };
  }

  const get = (path: string, cookie: string | null) => {
    const req = request(app.getHttpServer()).get(path);
    if (cookie) req.set("Cookie", cookie);
    return req;
  };

  const post = (path: string, cookie: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body as object);

  const patch = (path: string, cookie: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body as object);

  /** Cria um item pela API da staff e devolve o DTO (AC#1). */
  async function publish(cookie: string, body: Record<string, unknown>): Promise<ShopItemDto> {
    const res = await post("/api/shop/items", cookie, body);
    expect(res.status).toBe(201);
    return res.body as ShopItemDto;
  }

  it("exige sessão: catálogo e compra não respondem deslogado", async () => {
    await get("/api/shop", null).expect(401);
    await request(app.getHttpServer()).post("/api/shop/orders").set("Origin", PUBLIC_URL).send({ itemId: "11111111-1111-4111-8111-111111111111" }).expect(401);
  });

  it("staff cadastra, edita e despublica; membro comum leva 403 (AC#1, AC#6)", async () => {
    const staff = await member(["member", "staff"]);
    const plebe = await member(["member"]);

    const item = await publish(staff.cookie, { name: "Ping de evento", description: "a staff pinga a guilda", price: "340", stock: 3 });
    expect(item).toMatchObject({ name: "Ping de evento", price: "340", stock: 3, published: true });

    const repriced = await patch(`/api/shop/items/${item.id}`, staff.cookie, { price: "400" }).expect(200);
    expect(repriced.body).toMatchObject({ price: "400", description: "a staff pinga a guilda" });

    await post("/api/shop/items", plebe.cookie, { name: "Meu item", price: "1" }).expect(403);
    await patch(`/api/shop/items/${item.id}`, plebe.cookie, { price: "1" }).expect(403);
  });

  it("despublicado some do catálogo do membro e continua no da staff (AC#1)", async () => {
    const staff = await member(["member", "staff"]);
    const plebe = await member(["member"]);
    const item = await publish(staff.cookie, { name: "Set de trilha", price: "50" });
    await patch(`/api/shop/items/${item.id}`, staff.cookie, { published: false }).expect(200);

    const asMember = await get("/api/shop", plebe.cookie).expect(200);
    const asStaff = await get("/api/shop", staff.cookie).expect(200);
    expect((asMember.body as ShopCatalogResponse).items.map((i) => i.id)).not.toContain(item.id);
    expect((asStaff.body as ShopCatalogResponse).items.map((i) => i.id)).toContain(item.id);
  });

  it("o membro vê catálogo e o próprio saldo de Buffunfa (AC#2)", async () => {
    const staff = await member(["member", "staff"]);
    await publish(staff.cookie, { name: "Bolsa T8", price: "300" });
    const rico = await member(["member"], 500n);

    const res = await get("/api/shop", rico.cookie).expect(200);
    const body = res.body as ShopCatalogResponse;
    expect(body.balance).toEqual({ balance: "500", reserved: "0", available: "500" });
    expect(body.items.some((i) => i.name === "Bolsa T8")).toBe(true);
    expect(body.orders).toEqual([]);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("item esgotado continua no catálogo, marcado por stock 0 (AC#3, F6-18)", async () => {
    const staff = await member(["member", "staff"]);
    const item = await publish(staff.cookie, { name: "Nome no mural", price: "10", stock: 0 });
    const plebe = await member(["member"], 1_000n);

    const body = (await get("/api/shop", plebe.cookie).expect(200)).body as ShopCatalogResponse;
    expect(body.items.find((i) => i.id === item.id)).toMatchObject({ stock: 0, published: true });
    // E comprar mesmo assim é 409, não 404: o item existe, só acabou.
    const refused = await post("/api/shop/orders", plebe.cookie, { itemId: item.id }).expect(409);
    expect(refused.body.message).toContain("esgotou");
  });

  it("compra reserva, devolve o catálogo novo e cai no 409 quando falta Buffunfa (AC#4, AC#5)", async () => {
    const staff = await member(["member", "staff"]);
    const item = await publish(staff.cookie, { name: "Criação de evento", price: "300", stock: 2 });
    const plebe = await member(["member"], 500n);

    const bought = await post("/api/shop/orders", plebe.cookie, { itemId: item.id }).expect(201);
    const body = bought.body as ShopCatalogResponse;
    expect(body.balance).toEqual({ balance: "500", reserved: "300", available: "200" });
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({ status: "reserved", itemName: "Criação de evento", price: "300", ledgerEntryId: null });
    expect(body.items.find((i) => i.id === item.id)?.stock).toBe(1);

    const refused = await post("/api/shop/orders", plebe.cookie, { itemId: item.id }).expect(409);
    expect(refused.body.message).toContain("Faltam 100 BUF");
  });

  it("a compra é sempre do dono da sessão: userId no corpo é ignorado", async () => {
    const staff = await member(["member", "staff"]);
    const item = await publish(staff.cookie, { name: "Doação beneficente", price: "10" });
    const alvo = await member(["member"], 1_000n);
    const comprador = await member(["member"], 1_000n);

    await post("/api/shop/orders", comprador.cookie, { itemId: item.id, userId: alvo.id }).expect(201);
    expect(((await get("/api/shop", alvo.cookie).expect(200)).body as ShopCatalogResponse).orders).toEqual([]);
    const meus = ((await get("/api/shop", comprador.cookie).expect(200)).body as ShopCatalogResponse).orders;
    expect(meus).toHaveLength(1);
    expect(meus[0]!.userId).toBe(comprador.id);
  });

  it("recusa corpo inválido com 400 PT-BR", async () => {
    const staff = await member(["member", "staff"]);
    expect((await post("/api/shop/items", staff.cookie, { name: "", price: "10" }).expect(400)).body.message).toContain("nome");
    expect((await post("/api/shop/items", staff.cookie, { name: "x", price: "0" }).expect(400)).body.message).toContain("maior que zero");
    await post("/api/shop/orders", staff.cookie, { itemId: "não-é-uuid" }).expect(400);
    await patch("/api/shop/items/nao-uuid", staff.cookie, { price: "5" }).expect(400);
  });

  it("compra de item inexistente é 404", async () => {
    const plebe = await member(["member"], 100n);
    await post("/api/shop/orders", plebe.cookie, { itemId: "11111111-1111-4111-8111-111111111111" }).expect(404);
  });
});
