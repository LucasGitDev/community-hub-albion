import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, insertLedgerEntry, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { shopItemCreateSchema, type ShopCatalogResponse, type ShopItemDto } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { ShopService } from "./shop.service.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da timeline da loja não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

/**
 * Timeline da loja (TASK-079, T5/T14): cada operação que muda item ou pedido publica **uma** linha
 * depois de a transação resolver, com ator, alvo, valor em Buffunfa e ID; recusa não publica nada.
 * Os registros só são lidos depois de a requisição responder — é assim que se prova "depois do commit".
 */
describe.skipIf(!baseUrl)("timeline da loja (TASK-079)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let seq = 0;
  const timeline = new FakeTimelinePublisher();

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_shop_timeline`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false, timeline })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  async function member(roles: ("member" | "staff")[] = ["member"], buffunfa = 0n) {
    const discordId = `9610000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `loja${seq}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (buffunfa !== 0n) await insertLedgerEntry(handle.db, { currency: "buffunfa", userId: user.id, amount: buffunfa, kind: "split_payout", memo: "presença" });
    const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 3_600_000));
    return { id: user.id, cookie: `ah_session=${token}` };
  }

  const post = (path: string, cookie: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body as object);

  const patch = (path: string, cookie: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set("Cookie", cookie).set("Origin", PUBLIC_URL).send(body as object);

  async function item(cookie: string, body: Record<string, unknown>): Promise<ShopItemDto> {
    const res = await post("/api/shop/items", cookie, body);
    expect(res.status).toBe(201);
    return res.body as ShopItemDto;
  }

  /** Pedido `reserved` com a timeline limpa: o teste só enxerga o que a transição seguinte publicou. */
  async function ordered() {
    const staff = await member(["member", "staff"]);
    const it_ = await item(staff.cookie, { name: "Bolsa T8", price: "300", stock: 2 });
    const comprador = await member(["member"], 5_000n);
    const order = ((await post("/api/shop/orders", comprador.cookie, { itemId: it_.id }).expect(201)).body as ShopCatalogResponse).orders[0]!;
    timeline.clear();
    return { staff, comprador, item: it_, order };
  }

  const buf = (value: bigint) => [expect.objectContaining({ value, currency: "buffunfa" })];
  const user = (id: string) => expect.objectContaining({ kind: "user", userId: id, name: expect.any(String) });
  const target = (id: string) => expect.objectContaining({ id, name: expect.any(String) });
  const detail = (name: string, value: string) => expect.arrayContaining([{ name, value }]);

  it("item criado, editado e despublicado publicam ator, preço e ID (AC#1)", async () => {
    const staff = await member(["member", "staff"]);
    timeline.clear();
    const created = await item(staff.cookie, { name: "Ping de evento", price: "340", stock: 3 });
    expect(timeline.only("shop.item_created")).toMatchObject({ actor: user(staff.id), amounts: buf(340n), recordId: created.id, summary: "Item criado: Ping de evento" });

    timeline.clear();
    await patch(`/api/shop/items/${created.id}`, staff.cookie, { price: "400" }).expect(200);
    const edited = timeline.only("shop.item_updated");
    expect(edited).toMatchObject({ actor: user(staff.id), amounts: buf(400n), recordId: created.id });
    expect(edited.details).toEqual(detail("Preço anterior", "340"));

    timeline.clear();
    await patch(`/api/shop/items/${created.id}`, staff.cookie, { published: false }).expect(200);
    expect(timeline.only("shop.item_unpublished")).toMatchObject({ actor: user(staff.id), amounts: buf(400n), recordId: created.id });
    expect(timeline.actions()).toEqual(["shop.item_unpublished"]);
  });

  it("recusa de item não publica: corpo inválido, sem permissão, item inexistente", async () => {
    const staff = await member(["member", "staff"]);
    const plebe = await member(["member"]);
    timeline.clear();
    await post("/api/shop/items", staff.cookie, { name: "", price: "10" }).expect(400);
    await post("/api/shop/items", plebe.cookie, { name: "x", price: "10" }).expect(403);
    await patch("/api/shop/items/11111111-1111-4111-8111-111111111111", staff.cookie, { price: "5" }).expect(404);
    expect(timeline.entries).toEqual([]);
  });

  it("compra publica o pedido reservado com comprador como ator e alvo; compra recusada não publica (AC#2)", async () => {
    const staff = await member(["member", "staff"]);
    const it_ = await item(staff.cookie, { name: "Criação de evento", price: "300", stock: 1 });
    const comprador = await member(["member"], 500n);
    timeline.clear();
    const order = ((await post("/api/shop/orders", comprador.cookie, { itemId: it_.id }).expect(201)).body as ShopCatalogResponse).orders[0]!;
    const entry = timeline.only("shop.order_reserved");
    expect(entry).toMatchObject({ actor: user(comprador.id), target: target(comprador.id), amounts: buf(300n), recordId: order.id });
    expect(entry.details).toEqual(detail("Item", "Criação de evento"));

    timeline.clear();
    await post("/api/shop/orders", comprador.cookie, { itemId: it_.id }).expect(409); // esgotado
    await post("/api/shop/orders", comprador.cookie, { itemId: "11111111-1111-4111-8111-111111111111" }).expect(404);
    expect(timeline.entries).toEqual([]);
  });

  it("pegar, devolver, pegar e entregar: uma linha por transição, com a staff como ator (AC#2)", async () => {
    const { staff, comprador, order } = await ordered();
    await post(`/api/shop/orders/${order.id}/claim`, staff.cookie, {}).expect(200);
    await post(`/api/shop/orders/${order.id}/release`, staff.cookie, {}).expect(200);
    await post(`/api/shop/orders/${order.id}/claim`, staff.cookie, {}).expect(200);
    await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, { note: "banco de Martlock" }).expect(200);

    expect(timeline.actions()).toEqual(["shop.order_claimed", "shop.order_released", "shop.order_claimed", "shop.order_delivered"]);
    for (const e of timeline.entries) {
      expect(e).toMatchObject({ actor: user(staff.id), target: target(comprador.id), amounts: buf(300n), recordId: order.id });
      expect(e.details).toEqual(detail("Item", "Bolsa T8"));
    }
    expect(timeline.only("shop.order_delivered").details).toEqual(detail("Nota", "banco de Martlock"));
  });

  it("cancelamento pelo comprador e pela staff dizem quem cancelou (AC#2)", async () => {
    const a = await ordered();
    await post(`/api/shop/orders/${a.order.id}/cancel`, a.comprador.cookie, {}).expect(200);
    const byBuyer = timeline.only("shop.order_cancelled");
    expect(byBuyer).toMatchObject({ actor: user(a.comprador.id), target: target(a.comprador.id), amounts: buf(300n), recordId: a.order.id });
    expect(byBuyer.details).toEqual(detail("Cancelado por", "comprador"));

    const b = await ordered();
    await post(`/api/shop/orders/${b.order.id}/claim`, b.staff.cookie, {}).expect(200);
    timeline.clear();
    await post(`/api/shop/orders/${b.order.id}/cancel`, b.comprador.cookie, {}).expect(403);
    expect(timeline.entries).toEqual([]);
    await post(`/api/shop/orders/${b.order.id}/cancel`, b.staff.cookie, { note: "desistiu no voice" }).expect(200);
    const byStaff = timeline.only("shop.order_cancelled");
    expect(byStaff).toMatchObject({ actor: user(b.staff.id), target: target(b.comprador.id), recordId: b.order.id });
    expect(byStaff.details).toEqual(detail("Cancelado por", "staff"));
    expect(byStaff.details).toEqual(detail("Nota", "desistiu no voice"));
  });

  it("recusa e estorno publicam com o motivo; transição inválida não publica (AC#2)", async () => {
    const a = await ordered();
    await post(`/api/shop/orders/${a.order.id}/reject`, a.staff.cookie, {}).expect(400);
    await post(`/api/shop/orders/${a.order.id}/refund`, a.staff.cookie, { note: "nem entreguei" }).expect(409);
    await post(`/api/shop/orders/${a.order.id}/deliver`, a.staff.cookie, { note: "sem pegar" }).expect(409);
    expect(timeline.entries).toEqual([]);
    await post(`/api/shop/orders/${a.order.id}/reject`, a.staff.cookie, { note: "item saiu do jogo" }).expect(200);
    const rejected = timeline.only("shop.order_rejected");
    expect(rejected).toMatchObject({ actor: user(a.staff.id), target: target(a.comprador.id), amounts: buf(300n), recordId: a.order.id });
    expect(rejected.details).toEqual(detail("Nota", "item saiu do jogo"));

    const b = await ordered();
    await post(`/api/shop/orders/${b.order.id}/claim`, b.staff.cookie, {}).expect(200);
    await post(`/api/shop/orders/${b.order.id}/deliver`, b.staff.cookie, { note: "banco" }).expect(200);
    timeline.clear();
    await post(`/api/shop/orders/${b.order.id}/refund`, b.staff.cookie, { note: "item errado" }).expect(200);
    await post(`/api/shop/orders/${b.order.id}/refund`, b.staff.cookie, { note: "de novo" }).expect(409);
    const refunded = timeline.only("shop.order_refunded");
    expect(refunded).toMatchObject({ actor: user(b.staff.id), target: target(b.comprador.id), amounts: buf(300n), recordId: b.order.id });
    expect(refunded.details).toEqual(detail("Motivo do estorno", "item errado"));
  });

  it("falha ao publicar nunca derruba a operação já commitada (T6)", async () => {
    const staff = await member(["member", "staff"]);
    const broken = new ShopService(handle, {
      publish() {
        throw new Error("Discord fora");
      },
    });
    const created = await broken.create(shopItemCreateSchema.parse({ name: "Item resiliente", price: "10" }), staff.id);
    expect(created.name).toBe("Item resiliente");
    const comprador = await member(["member"], 100n);
    const bought = await broken.purchase(comprador.id, created.id);
    expect(bought.ok).toBe(true);
  });
});
