import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createShopItem,
  createDb,
  getShopBalance,
  getShopItem,
  insertLedgerEntry,
  listLedgerEntries,
  listShopItems,
  listShopOrders,
  purchaseShopItem,
  runMigrations,
  schema,
  updateShopItem,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da loja não podem ser pulados");

describe.skipIf(!baseUrl)("loja: catálogo e compra (TASK-059, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;

  const nextUser = async () => {
    const discordId = `9400000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `loja${seq}` });
    return user.id;
  };

  /** Membro com Buffunfa já creditada no ledger. */
  const memberWith = async (buffunfa: bigint) => {
    const userId = await nextUser();
    if (buffunfa !== 0n) await insertLedgerEntry(handle.db, { currency: "buffunfa", userId, amount: buffunfa, kind: "split_payout", memo: "presença" });
    return userId;
  };

  const item = (over: Partial<{ name: string; price: bigint; stock: number | null; published: boolean }> = {}) =>
    createShopItem(handle.db, { name: "Bolsa T8", description: null, price: 300n, stock: null, published: true, ...over });

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_shop`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    // Pool folgado: o teste de concorrência precisa de conexões simultâneas de verdade.
    handle = createDb(target.toString(), { max: 10 });
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  describe("catálogo da staff (AC#1)", () => {
    it("cadastra item de texto livre com estoque opcional (F6-17)", async () => {
      const created = await item({ name: "Ping de evento", price: 340n, stock: 5 });
      expect(created).toMatchObject({ name: "Ping de evento", price: "340", stock: 5, published: true });
      expect(await getShopItem(handle.db, created.id)).toMatchObject({ id: created.id });
    });

    it("edita preço sem apagar o resto, e despublica sem apagar o item", async () => {
      const created = await createShopItem(handle.db, { name: "Set de trilha", description: "com montaria", price: 100n, stock: null, published: true });
      const repriced = await updateShopItem(handle.db, created.id, { price: 250n });
      expect(repriced).toMatchObject({ price: "250", description: "com montaria", name: "Set de trilha" });

      const unpublished = await updateShopItem(handle.db, created.id, { published: false });
      expect(unpublished?.published).toBe(false);
      // Sai do catálogo do membro, continua no da staff.
      const memberView = await listShopItems(handle.db);
      const staffView = await listShopItems(handle.db, { includeUnpublished: true });
      expect(memberView.map((i) => i.id)).not.toContain(created.id);
      expect(staffView.map((i) => i.id)).toContain(created.id);
    });

    it("o banco recusa preço zero e estoque negativo (Q20)", async () => {
      await expect(item({ price: 0n })).rejects.toThrow();
      await expect(item({ stock: -1 })).rejects.toThrow();
    });
  });

  describe("compra: reserva sem lançar no ledger (AC#5)", () => {
    it("desconta do disponível e do estoque, e o extrato do membro não muda", async () => {
      const userId = await memberWith(500n);
      const created = await item({ price: 300n, stock: 2 });

      const result = await purchaseShopItem(handle.db, { userId, itemId: created.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.order).toMatchObject({ status: "reserved", price: "300", itemName: "Bolsa T8", ledgerEntryId: null });
      // Reserva: saldo intacto, disponível menor.
      expect(result.balance).toEqual({ balance: 500n, reserved: 300n, available: 200n });
      expect(result.item.stock).toBe(1);

      // Nada no ledger: o débito é da entrega (TASK-060).
      const statement = await listLedgerEntries(handle.db, userId, "buffunfa");
      expect(statement.entries).toHaveLength(1);
      expect(statement.entries[0]!.kind).toBe("split_payout");
      const orders = await listShopOrders(handle.db, { userId });
      expect(orders).toHaveLength(1);
      expect(orders[0]!.status).toBe("reserved");
    });

    it("estoque null não é decrementado: ilimitado continua ilimitado", async () => {
      const userId = await memberWith(1_000n);
      const created = await item({ price: 10n, stock: null });
      await purchaseShopItem(handle.db, { userId, itemId: created.id });
      expect((await getShopItem(handle.db, created.id))?.stock).toBeNull();
    });

    it("congela nome e preço: reprecificar depois não reescreve o pedido", async () => {
      const userId = await memberWith(1_000n);
      const created = await item({ name: "Ping", price: 100n });
      const bought = await purchaseShopItem(handle.db, { userId, itemId: created.id });
      await updateShopItem(handle.db, created.id, { name: "Ping premium", price: 900n });
      const [order] = await listShopOrders(handle.db, { userId });
      expect(bought.ok && order).toMatchObject({ itemName: "Ping", price: "100" });
    });
  });

  describe("compra: recusa revalidando dentro da transação (AC#4)", () => {
    it("recusa saldo insuficiente contando o que já está reservado (F6-7)", async () => {
      const userId = await memberWith(500n);
      const caro = await item({ price: 300n });
      await purchaseShopItem(handle.db, { userId, itemId: caro.id });
      // Sobraram 200 disponíveis, mesmo com 500 de saldo.
      const second = await purchaseShopItem(handle.db, { userId, itemId: caro.id });
      expect(second).toEqual({ ok: false, reason: "insufficient", available: 200n, price: 300n });
      expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 500n, reserved: 300n, available: 200n });
    });

    it("recusa item esgotado e item despublicado", async () => {
      const userId = await memberWith(10_000n);
      const esgotado = await item({ price: 10n, stock: 0 });
      expect(await purchaseShopItem(handle.db, { userId, itemId: esgotado.id })).toEqual({ ok: false, reason: "sold_out" });
      // Esgotado continua no catálogo (F6-18).
      expect((await listShopItems(handle.db)).map((i) => i.id)).toContain(esgotado.id);

      const fora = await item({ price: 10n, published: false });
      expect(await purchaseShopItem(handle.db, { userId, itemId: fora.id })).toEqual({ ok: false, reason: "unavailable" });
    });

    it("recusa item e usuário inexistentes", async () => {
      const userId = await memberWith(100n);
      expect(await purchaseShopItem(handle.db, { userId, itemId: "11111111-1111-4111-8111-111111111111" })).toEqual({ ok: false, reason: "not_found" });
      const created = await item();
      expect(await purchaseShopItem(handle.db, { userId: "11111111-1111-4111-8111-111111111111", itemId: created.id })).toEqual({ ok: false, reason: "unknown_user" });
    });
  });

  describe("concorrência: a trava e a releitura decidem (AC#4)", () => {
    it("duas compras simultâneas de 300 com 500 de saldo: uma passa, uma é recusada", async () => {
      const userId = await memberWith(500n);
      const created = await item({ price: 300n, stock: null });
      const [a, b] = await Promise.all([purchaseShopItem(handle.db, { userId, itemId: created.id }), purchaseShopItem(handle.db, { userId, itemId: created.id })]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const refused = a.ok ? b : a;
      expect(refused).toMatchObject({ ok: false, reason: "insufficient" });
      expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 500n, reserved: 300n, available: 200n });
    });

    it("dois membros disputando a última unidade: o estoque não fica negativo", async () => {
      const [um, dois] = await Promise.all([memberWith(1_000n), memberWith(1_000n)]);
      const created = await item({ price: 10n, stock: 1 });
      const [a, b] = await Promise.all([purchaseShopItem(handle.db, { userId: um, itemId: created.id }), purchaseShopItem(handle.db, { userId: dois, itemId: created.id })]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect((a.ok ? b : a)).toMatchObject({ ok: false, reason: "sold_out" });
      const [row] = await handle.db.select({ stock: schema.shopItems.stock }).from(schema.shopItems).where(eq(schema.shopItems.id, created.id));
      expect(row?.stock).toBe(0);
    });
  });
});
