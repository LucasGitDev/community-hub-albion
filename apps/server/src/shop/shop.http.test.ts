import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, grantRole, insertLedgerEntry, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { ShopCatalogResponse, ShopItemDto, ShopOrderDto, ShopOrderQueueResponse } from "@albion-hub/shared";
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

  /**
   * A fila da staff pela API (TASK-060). O foco é o que só o HTTP prova: **quem** pode mexer no pedido de
   * quem. A máquina de estados, o débito e a devolução de moeda e estoque são testados no repo, contra o
   * banco, onde a transação existe de verdade.
   */
  describe("fila de pedidos (TASK-060)", () => {
    /** Um pedido `reserved` de um membro com Buffunfa sobrando, e o item por trás dele. */
    async function ordered(opts: { price?: string; stock?: number | null } = {}) {
      const staff = await member(["member", "staff"]);
      const item = await publish(staff.cookie, { name: "Bolsa T8", price: opts.price ?? "300", stock: opts.stock === undefined ? 2 : opts.stock });
      const comprador = await member(["member"], 5_000n);
      const bought = await post("/api/shop/orders", comprador.cookie, { itemId: item.id }).expect(201);
      const order = (bought.body as ShopCatalogResponse).orders[0]!;
      return { staff, comprador, item, order };
    }

    it("a staff pega, entrega com nota, e o débito aparece no pedido (AC#1, AC#4, AC#5)", async () => {
      const { staff, comprador, order } = await ordered();

      const claimed = (await post(`/api/shop/orders/${order.id}/claim`, staff.cookie, {}).expect(200)).body as ShopOrderDto;
      expect(claimed).toMatchObject({ status: "claimed", handledByUserId: staff.id, ledgerEntryId: null });
      expect(claimed.handledByNick).toBeTruthy();

      // Sem nota não entrega: 400 PT-BR, e o pedido fica onde estava.
      expect((await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, {}).expect(400)).body.message).toContain("Escreva");

      const delivered = (await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, { note: "banco de Martlock, para Fulano" }).expect(200)).body as ShopOrderDto;
      expect(delivered).toMatchObject({ status: "delivered", note: "banco de Martlock, para Fulano" });
      expect(delivered.ledgerEntryId).toBeTruthy();
      // O membro enxerga o pedido entregue e a Buffunfa já saiu do saldo.
      const catalogo = (await get("/api/shop", comprador.cookie).expect(200)).body as ShopCatalogResponse;
      expect(catalogo.balance).toEqual({ balance: "4700", reserved: "0", available: "4700" });
    });

    it("a staff devolve o pedido à fila, e a segunda entrega do mesmo pedido é 409 (AC#2, AC#3)", async () => {
      const { staff, order } = await ordered();
      await post(`/api/shop/orders/${order.id}/claim`, staff.cookie, {}).expect(200);
      const released = (await post(`/api/shop/orders/${order.id}/release`, staff.cookie, {}).expect(200)).body as ShopOrderDto;
      expect(released).toMatchObject({ status: "reserved", handledByUserId: null, handledAt: null });

      // Entregar sem ter pegado é 409 com a frase que diz o que dá pra fazer.
      expect((await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, { note: "no banco" }).expect(409)).body.message).toContain("aguardando entrega");

      await post(`/api/shop/orders/${order.id}/claim`, staff.cookie, {}).expect(200);
      await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, { note: "no banco" }).expect(200);
      expect((await post(`/api/shop/orders/${order.id}/deliver`, staff.cookie, { note: "de novo" }).expect(409)).body.message).toContain("estado final");
    });

    it("o comprador cancela enquanto está reserved; depois de claimed leva 403 (AC#6, F6-24)", async () => {
      const { staff, comprador, order } = await ordered();
      const cancelled = (await post(`/api/shop/orders/${order.id}/cancel`, comprador.cookie, {}).expect(200)).body as ShopOrderDto;
      expect(cancelled).toMatchObject({ status: "cancelled" });
      expect(cancelled.note).toContain("comprador");

      const outro = await ordered();
      await post(`/api/shop/orders/${outro.order.id}/claim`, outro.staff.cookie, {}).expect(200);
      expect((await post(`/api/shop/orders/${outro.order.id}/cancel`, outro.comprador.cookie, {}).expect(403)).body.message).toContain("staff já pegou");
      // A staff cancela o mesmo pedido, com motivo.
      const byStaff = (await post(`/api/shop/orders/${outro.order.id}/cancel`, staff.cookie, { note: "membro desistiu no voice" }).expect(200)).body as ShopOrderDto;
      expect(byStaff).toMatchObject({ status: "cancelled", note: "membro desistiu no voice" });
    });

    it("pedido de outro membro é 404 para o membro: a resposta não diz nem que o id existe", async () => {
      const { order } = await ordered();
      const estranho = await member(["member"], 100n);
      await post(`/api/shop/orders/${order.id}/cancel`, estranho.cookie, {}).expect(404);
    });

    it("membro comum não pega, não entrega, não recusa e não estorna (AC#6, F6-25)", async () => {
      const { comprador, order } = await ordered();
      for (const action of ["claim", "release", "deliver", "reject", "refund"]) {
        await post(`/api/shop/orders/${order.id}/${action}`, comprador.cookie, { note: "eu mesmo entrego" }).expect(403);
      }
      // Nem deslogado.
      await request(app.getHttpServer()).post(`/api/shop/orders/${order.id}/claim`).set("Origin", PUBLIC_URL).send({}).expect(401);
    });

    it("a fila da staff mostra todos os pedidos; o membro só enxerga os próprios (AC#8)", async () => {
      const { staff, comprador, order } = await ordered();

      const fila = (await get("/api/shop/orders?status=reserved", staff.cookie).expect(200)).body as ShopOrderQueueResponse;
      expect(fila.orders.some((o) => o.id === order.id)).toBe(true);
      expect(fila.orders.every((o) => o.status === "reserved")).toBe(true);
      // Nick do dono: é o contexto de quem entrega.
      expect(fila.orders.find((o) => o.id === order.id)?.userNick).toBeTruthy();

      const minha = (await get("/api/shop/orders", comprador.cookie).expect(200)).body as ShopOrderQueueResponse;
      expect(minha.orders.map((o) => o.userId)).toEqual([comprador.id]);
      // Pedir o de outro, sem shop:fulfill, é 403 em vez de vazar.
      await get(`/api/shop/orders?userId=${staff.id}`, comprador.cookie).expect(403);
      // Filtro inválido é 400, nunca silenciosamente ignorado.
      await get("/api/shop/orders?status=entregando", staff.cookie).expect(400);
    });

    it("a recusa da staff exige motivo, e o estorno só vale em pedido entregue (AC#7)", async () => {
      const { staff, order } = await ordered();
      await post(`/api/shop/orders/${order.id}/reject`, staff.cookie, {}).expect(400);
      const rejected = (await post(`/api/shop/orders/${order.id}/reject`, staff.cookie, { note: "item saiu do jogo" }).expect(200)).body as ShopOrderDto;
      expect(rejected).toMatchObject({ status: "rejected", note: "item saiu do jogo" });

      const entregue = await ordered();
      await post(`/api/shop/orders/${entregue.order.id}/refund`, entregue.staff.cookie, { note: "nem entreguei" }).expect(409);
      await post(`/api/shop/orders/${entregue.order.id}/claim`, entregue.staff.cookie, {}).expect(200);
      await post(`/api/shop/orders/${entregue.order.id}/deliver`, entregue.staff.cookie, { note: "banco de Martlock" }).expect(200);
      const refunded = (await post(`/api/shop/orders/${entregue.order.id}/refund`, entregue.staff.cookie, { note: "item errado" }).expect(200)).body as ShopOrderDto;
      expect(refunded.reversalEntryId).toBeTruthy();
      expect((await post(`/api/shop/orders/${entregue.order.id}/refund`, entregue.staff.cookie, { note: "de novo" }).expect(409)).body.message).toContain("já foi estornado");
    });

    it("recusa id fora de formato com 400 PT-BR", async () => {
      const staff = await member(["member", "staff"]);
      expect((await post("/api/shop/orders/nao-uuid/claim", staff.cookie, {}).expect(400)).body.message).toContain("pedido");
    });
  });
});
