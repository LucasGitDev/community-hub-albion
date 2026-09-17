import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelShopOrder,
  claimShopOrder,
  createShopItem,
  createDb,
  deliverShopOrder,
  getShopOrder,
  refundShopOrder,
  rejectShopOrder,
  releaseShopOrder,
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

  /**
   * A fila que a staff trabalha (TASK-060, F6-21 a F6-24). O que estes testes provam é o que quebra
   * dinheiro: a entrega lança **uma vez só**, o cancelamento concorrente com a entrega não deixa os dois
   * acontecerem, e todo encerramento devolve moeda **e** estoque — nunca só um dos dois (F6-19).
   */
  describe("fila da staff: estados do pedido (TASK-060)", () => {
    /** Um pedido `reserved` de um membro novo, com o item já criado. */
    const ordered = async (over: Partial<{ price: bigint; stock: number | null }> = {}) => {
      const price = over.price ?? 300n;
      const userId = await memberWith(price * 4n);
      const created = await item({ price, stock: over.stock === undefined ? 3 : over.stock });
      const bought = await purchaseShopItem(handle.db, { userId, itemId: created.id });
      expect(bought.ok).toBe(true);
      if (!bought.ok) throw new Error("compra falhou");
      return { userId, itemId: created.id, orderId: bought.order.id, price };
    };
    const staff = () => nextUser();
    const stockOf = async (itemId: string) => (await getShopItem(handle.db, itemId))?.stock ?? null;

    describe("reserved → claimed → delivered (AC#1, AC#3)", () => {
      it("a staff pega o pedido, e pode devolvê-lo à fila voltando para reserved (F6-22)", async () => {
        const { orderId, userId, itemId } = await ordered();
        const quem = await staff();

        const claimed = await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });
        expect(claimed.ok && claimed.order).toMatchObject({ status: "claimed", handledByUserId: quem, ledgerEntryId: null });
        expect(claimed.ok && claimed.order.handledAt).toBeTruthy();
        // Pegar não mexe em moeda nem em estoque: a Buffunfa segue reservada e o item segue fora.
        expect(await getShopBalance(handle.db, userId)).toMatchObject({ reserved: 300n });
        expect(await stockOf(itemId)).toBe(2);
        expect((await listLedgerEntries(handle.db, userId, "buffunfa")).entries).toHaveLength(1);

        const released = await releaseShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });
        expect(released.ok && released.order).toMatchObject({ status: "reserved", handledByUserId: null, handledAt: null });
        // Voltou pra fila sem soltar a reserva: o membro não recuperou Buffunfa nenhuma nem perdeu o item.
        expect(await getShopBalance(handle.db, userId)).toMatchObject({ reserved: 300n });
        expect(await stockOf(itemId)).toBe(2);
      });

      it("a entrega lança o débito e amarra o lançamento ao pedido (AC#5)", async () => {
        const { orderId, userId, price } = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });

        const delivered = await deliverShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "banco de Martlock, para Fulano" });
        expect(delivered.ok).toBe(true);
        if (!delivered.ok) return;
        expect(delivered.order).toMatchObject({ status: "delivered", handledByUserId: quem, note: "banco de Martlock, para Fulano" });
        expect(delivered.order.ledgerEntryId).toBeTruthy();

        // O débito: um lançamento `purchase` de Buffunfa, negativo, apontando para o pedido.
        const statement = await listLedgerEntries(handle.db, userId, "buffunfa");
        const debit = statement.entries.find((e) => e.kind === "purchase");
        expect(debit).toMatchObject({ amount: -price, currency: "buffunfa", referenceType: "shop_order", referenceId: orderId });
        expect(debit!.id).toBe(delivered.order.ledgerEntryId);
        // A Buffunfa saiu do saldo e a reserva caiu junto: o disponível não muda duas vezes.
        expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 900n, reserved: 0n, available: 900n });
      });

      it("entrega exige nota dizendo onde e para quem (AC#4)", async () => {
        const { orderId } = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });
        expect(await deliverShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "   " })).toEqual({ ok: false, reason: "note_required" });
        expect((await getShopOrder(handle.db, orderId))?.status).toBe("claimed");
      });

      it("recusa a transição inválida: entregar sem ter pegado, e pegar duas vezes (AC#2)", async () => {
        const { orderId } = await ordered();
        const quem = await staff();
        expect(await deliverShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "no banco" })).toEqual({ ok: false, reason: "invalid", from: "reserved" });
        await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });
        expect(await claimShopOrder(handle.db, orderId, { actorUserId: await staff(), isStaff: true })).toEqual({ ok: false, reason: "invalid", from: "claimed" });
      });

      it("pedido inexistente é not_found, não erro", async () => {
        const quem = await staff();
        expect(await claimShopOrder(handle.db, "11111111-1111-4111-8111-111111111111", { actorUserId: quem, isStaff: true })).toEqual({ ok: false, reason: "not_found" });
      });
    });

    describe("o banco recusa a linha incoerente, no mesmo padrão dos saques (AC#2)", () => {
      const raw = (values: Record<string, unknown>, orderId: string) =>
        handle.db
          .update(schema.shopOrders)
          .set(values as never)
          .where(eq(schema.shopOrders.id, orderId));

      it("delivered sem lançamento, lançamento fora de delivered, carimbo em reserved e fim de linha sem nota", async () => {
        const { orderId } = await ordered();
        // delivered exige o lançamento (e o lançamento só existe em delivered).
        await expect(raw({ status: "delivered", handledAt: new Date(), handledBy: null, note: "entreguei" }, orderId)).rejects.toThrow();
        // Carimbo é proibido em reserved e obrigatório fora dele.
        await expect(raw({ handledAt: new Date() }, orderId)).rejects.toThrow();
        await expect(raw({ status: "rejected", note: "sem estoque" }, orderId)).rejects.toThrow();
        // Recusa e cancelamento exigem nota escrita.
        const quem = await staff();
        await expect(raw({ status: "rejected", handledBy: quem, handledAt: new Date(), note: "  " }, orderId)).rejects.toThrow();
        await expect(raw({ status: "cancelled", handledBy: quem, handledAt: new Date() }, orderId)).rejects.toThrow();
        expect((await getShopOrder(handle.db, orderId))?.status).toBe("reserved");
      });
    });

    describe("cancelar e recusar devolvem moeda e estoque juntos (AC#6, AC#7, F6-19)", () => {
      it("o comprador cancela enquanto está reserved: reserva liberada e estoque de volta", async () => {
        const { orderId, userId, itemId } = await ordered();
        expect(await stockOf(itemId)).toBe(2);

        const cancelled = await cancelShopOrder(handle.db, orderId, { actorUserId: userId });
        expect(cancelled.ok && cancelled.order).toMatchObject({ status: "cancelled", handledByUserId: userId, ledgerEntryId: null });
        expect(cancelled.ok && cancelled.order.note).toContain("Cancelado pelo próprio comprador");
        // Os dois de uma vez: Buffunfa disponível de novo e a unidade de volta na estante.
        expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 1_200n, reserved: 0n, available: 1_200n });
        expect(await stockOf(itemId)).toBe(3);
        // Nada no ledger: não houve débito, então não há o que estornar.
        expect((await listLedgerEntries(handle.db, userId, "buffunfa")).entries.filter((e) => e.kind !== "split_payout")).toHaveLength(0);
      });

      it("depois de claimed o comprador não cancela mais; a staff sim (F6-24)", async () => {
        const { orderId, userId, itemId } = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });

        expect(await cancelShopOrder(handle.db, orderId, { actorUserId: userId })).toEqual({ ok: false, reason: "not_yours" });
        expect((await getShopOrder(handle.db, orderId))?.status).toBe("claimed");

        const byStaff = await cancelShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "membro desistiu no voice" });
        expect(byStaff.ok && byStaff.order).toMatchObject({ status: "cancelled", note: "membro desistiu no voice" });
        expect(await stockOf(itemId)).toBe(3);
        expect(await getShopBalance(handle.db, userId)).toMatchObject({ reserved: 0n });
      });

      it("um membro não cancela o pedido de outro", async () => {
        const { orderId } = await ordered();
        expect(await cancelShopOrder(handle.db, orderId, { actorUserId: await nextUser() })).toEqual({ ok: false, reason: "not_yours" });
      });

      it("a recusa da staff devolve moeda e estoque e exige motivo", async () => {
        const { orderId, userId, itemId } = await ordered();
        const quem = await staff();
        expect(await rejectShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "" })).toEqual({ ok: false, reason: "note_required" });

        const rejected = await rejectShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "item saiu do jogo" });
        expect(rejected.ok && rejected.order).toMatchObject({ status: "rejected", note: "item saiu do jogo", ledgerEntryId: null });
        expect(await getShopBalance(handle.db, userId)).toMatchObject({ reserved: 0n });
        expect(await stockOf(itemId)).toBe(3);
      });

      it("estoque ilimitado não ganha unidade ao cancelar: null continua null", async () => {
        const { orderId, userId, itemId } = await ordered({ stock: null });
        await cancelShopOrder(handle.db, orderId, { actorUserId: userId });
        expect(await stockOf(itemId)).toBeNull();
      });
    });

    describe("estorno do pedido entregue: estorno no ledger e estoque, juntos (AC#7, F6-19)", () => {
      const delivered = async () => {
        const base = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true });
        const res = await deliverShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true, note: "banco de Martlock" });
        expect(res.ok).toBe(true);
        return { ...base, staffId: quem };
      };

      it("estorna o lançamento (nunca edita) e devolve a unidade ao estoque", async () => {
        const { orderId, userId, itemId, staffId, price } = await delivered();
        expect(await stockOf(itemId)).toBe(2);

        const refunded = await refundShopOrder(handle.db, orderId, { actorUserId: staffId, isStaff: true, note: "entreguei o item errado" });
        expect(refunded.ok).toBe(true);
        if (!refunded.ok) return;
        // O pedido continua entregue: o que mudou é que agora existe um estorno apontando pro débito.
        expect(refunded.order).toMatchObject({ status: "delivered" });
        expect(refunded.order.reversalEntryId).toBeTruthy();
        expect(refunded.order.note).toContain("Estornado: entreguei o item errado");

        const statement = await listLedgerEntries(handle.db, userId, "buffunfa");
        const reversal = statement.entries.find((e) => e.kind === "reversal");
        expect(reversal).toMatchObject({ amount: price, reversalOf: refunded.order.ledgerEntryId, referenceType: "shop_order" });
        // O débito original segue lá, intacto: ledger é append-only.
        expect(statement.entries.find((e) => e.kind === "purchase")?.amount).toBe(-price);
        // Moeda e estoque voltaram: saldo cheio de novo e a unidade na estante.
        expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 1_200n, reserved: 0n, available: 1_200n });
        expect(await stockOf(itemId)).toBe(3);
      });

      it("um pedido tem um estorno só, e pedido não entregue não é estornável", async () => {
        const { orderId, staffId, itemId } = await delivered();
        await refundShopOrder(handle.db, orderId, { actorUserId: staffId, isStaff: true, note: "primeiro" });
        expect(await refundShopOrder(handle.db, orderId, { actorUserId: staffId, isStaff: true, note: "segundo" })).toEqual({ ok: false, reason: "already_refunded" });
        // O estoque não ganhou uma segunda unidade de graça.
        expect(await stockOf(itemId)).toBe(3);

        const aberto = await ordered();
        expect(await refundShopOrder(handle.db, aberto.orderId, { actorUserId: staffId, isStaff: true, note: "nem entregou" })).toEqual({ ok: false, reason: "invalid", from: "reserved" });
      });
    });

    describe("concorrência: a trava e a releitura decidem quem ganha (AC#2, AC#7)", () => {
      it("dois membros da staff entregando o mesmo pedido: um lançamento só", async () => {
        const { orderId, userId } = await ordered();
        const [a, b] = [await staff(), await staff()];
        await claimShopOrder(handle.db, orderId, { actorUserId: a, isStaff: true });

        const [um, dois] = await Promise.all([
          deliverShopOrder(handle.db, orderId, { actorUserId: a, isStaff: true, note: "banco de Martlock" }),
          deliverShopOrder(handle.db, orderId, { actorUserId: b, isStaff: true, note: "banco de Bridgewatch" }),
        ]);
        expect([um.ok, dois.ok].filter(Boolean)).toHaveLength(1);
        expect(um.ok ? dois : um).toMatchObject({ ok: false, reason: "invalid", from: "delivered" });

        // O que importa: a Buffunfa saiu **uma** vez.
        const debits = (await listLedgerEntries(handle.db, userId, "buffunfa")).entries.filter((e) => e.kind === "purchase");
        expect(debits).toHaveLength(1);
        expect(await getShopBalance(handle.db, userId)).toEqual({ balance: 900n, reserved: 0n, available: 900n });
      });

      it("cancelamento concorrente com a entrega: um dos dois, nunca os dois", async () => {
        const { orderId, userId, itemId } = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true });

        const [entrega, cancelamento] = await Promise.all([
          deliverShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "banco de Martlock" }),
          cancelShopOrder(handle.db, orderId, { actorUserId: quem, isStaff: true, note: "membro desistiu" }),
        ]);
        expect([entrega.ok, cancelamento.ok].filter(Boolean)).toHaveLength(1);

        const order = await getShopOrder(handle.db, orderId);
        const debits = (await listLedgerEntries(handle.db, userId, "buffunfa")).entries.filter((e) => e.kind === "purchase");
        if (entrega.ok) {
          // Entregou: o débito existe, o estoque **não** voltou.
          expect(order).toMatchObject({ status: "delivered" });
          expect(debits).toHaveLength(1);
          expect(await stockOf(itemId)).toBe(2);
        } else {
          // Cancelou: nada no ledger e a unidade de volta. Nunca o item de volta **e** o débito lançado.
          expect(order).toMatchObject({ status: "cancelled", ledgerEntryId: null });
          expect(debits).toHaveLength(0);
          expect(await stockOf(itemId)).toBe(3);
        }
        expect(await getShopBalance(handle.db, userId)).toMatchObject({ reserved: 0n });
      });

      it("dois estornos simultâneos do mesmo pedido: um estorno só e uma unidade só de volta", async () => {
        const base = await ordered();
        const quem = await staff();
        await claimShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true });
        await deliverShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true, note: "banco de Martlock" });

        const [um, dois] = await Promise.all([
          refundShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true, note: "errado" }),
          refundShopOrder(handle.db, base.orderId, { actorUserId: quem, isStaff: true, note: "errado de novo" }),
        ]);
        expect([um.ok, dois.ok].filter(Boolean)).toHaveLength(1);
        const reversals = (await listLedgerEntries(handle.db, base.userId, "buffunfa")).entries.filter((e) => e.kind === "reversal");
        expect(reversals).toHaveLength(1);
        expect(await stockOf(base.itemId)).toBe(3);
      });
    });
  });
});
