import {
  checkShopPurchase,
  RESERVING_SHOP_ORDER_STATUSES,
  SHOP_CURRENCY,
  type ShopItemCreateInput,
  type ShopItemDto,
  type ShopItemUpdateInput,
  type ShopOrderDto,
  type ShopPurchaseRefusal,
} from "@albion-hub/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { memberNick } from "./member-nick.js";
import { ledgerEntries, shopItems, shopOrders, users } from "./schema.js";

/**
 * Loja (TASK-059): catálogo de itens de texto livre (F6-17) e compra que **reserva** Buffunfa e estoque
 * sem lançar nada no ledger (AC#5).
 *
 * O desenho é copiado do saque (TASK-030) de propósito, e a trava é a mesma: a regra a serializar é sobre
 * o **saldo do membro**, então a transação começa travando a linha dele (`select ... for update`) e relê
 * saldo, reserva e estoque **lá dentro** (AC#4). Duas compras simultâneas travam a mesma linha de `users`,
 * então a segunda só roda depois que a primeira já está gravada.
 *
 * A linha do **item** é travada logo em seguida, sempre nessa ordem (usuário → item), para dois membros
 * comprando o mesmo item não fecharem um deadlock com dois membros comprando dois itens.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const itemColumns = {
  id: shopItems.id,
  name: shopItems.name,
  description: shopItems.description,
  price: shopItems.price,
  stock: shopItems.stock,
  published: shopItems.published,
  createdAt: shopItems.createdAt,
  updatedAt: shopItems.updatedAt,
};

type ItemRow = { [K in keyof typeof itemColumns]: (typeof shopItems.$inferSelect)[K] };

/** Preço em string: JSON não tem inteiro grande o bastante (Q20). */
const toItemDto = (row: ItemRow): ShopItemDto => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: row.price.toString(),
  stock: row.stock,
  published: row.published,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const orderColumns = {
  id: shopOrders.id,
  userId: shopOrders.userId,
  itemId: shopOrders.itemId,
  itemName: shopOrders.itemName,
  price: shopOrders.price,
  status: shopOrders.status,
  ledgerEntryId: shopOrders.ledgerEntryId,
  handledBy: shopOrders.handledBy,
  handledAt: shopOrders.handledAt,
  note: shopOrders.note,
  createdAt: shopOrders.createdAt,
  updatedAt: shopOrders.updatedAt,
};

type OrderRow = { [K in keyof typeof orderColumns]: (typeof shopOrders.$inferSelect)[K] };

const toOrderDto = (row: OrderRow, userNick: string | null = null): ShopOrderDto => ({
  id: row.id,
  userId: row.userId,
  userNick,
  itemId: row.itemId,
  itemName: row.itemName,
  price: row.price.toString(),
  status: row.status,
  ledgerEntryId: row.ledgerEntryId,
  handledByUserId: row.handledBy,
  handledAt: row.handledAt ? row.handledAt.toISOString() : null,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Catálogo. `includeUnpublished` é a visão da staff (AC#1); o membro recebe só o que está publicado.
 *
 * Ordem: publicados primeiro, depois do mais novo pro mais antigo. Item **esgotado não sai daqui** — ele
 * aparece marcado na tela (F6-18), e ordenar por estoque o empurraria pro fim, que é quase sumir.
 */
export async function listShopItems(db: Database, options: { includeUnpublished?: boolean } = {}): Promise<ShopItemDto[]> {
  const rows = await db
    .select(itemColumns)
    .from(shopItems)
    .where(options.includeUnpublished ? undefined : eq(shopItems.published, true))
    .orderBy(desc(shopItems.published), desc(shopItems.createdAt), asc(shopItems.id));
  return rows.map(toItemDto);
}

export async function getShopItem(db: Database, id: string): Promise<ShopItemDto | null> {
  const [row] = await db.select(itemColumns).from(shopItems).where(eq(shopItems.id, id));
  return row ? toItemDto(row) : null;
}

/** Cadastra um item (AC#1). Nasce publicado, a menos que a staff diga o contrário. */
export async function createShopItem(db: Database, input: ShopItemCreateInput & { createdBy?: string | null }): Promise<ShopItemDto> {
  const [row] = await db
    .insert(shopItems)
    .values({
      name: input.name,
      description: input.description,
      price: input.price,
      stock: input.stock,
      published: input.published,
      createdBy: input.createdBy ?? null,
    })
    .returning(itemColumns);
  return toItemDto(row!);
}

/**
 * Edita o item (AC#1): preço, texto, estoque e publicação. Só os campos enviados mudam — reprecificar não
 * pode apagar a descrição.
 *
 * Editar **não** reescreve pedido nenhum: nome e preço ficam congelados na linha do pedido.
 */
export async function updateShopItem(db: Database, id: string, patch: ShopItemUpdateInput): Promise<ShopItemDto | null> {
  const values = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.price !== undefined ? { price: patch.price } : {}),
    ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
    ...(patch.published !== undefined ? { published: patch.published } : {}),
    updatedAt: new Date(),
  };
  const [row] = await db.update(shopItems).set(values).where(eq(shopItems.id, id)).returning(itemColumns);
  return row ? toItemDto(row) : null;
}

export interface ShopBalance {
  /** Saldo de Buffunfa no ledger. */
  balance: bigint;
  /** Buffunfa presa em pedidos que ainda não viraram lançamento (AC#5). */
  reserved: bigint;
  /** `balance - reserved`: teto de uma compra nova. */
  available: bigint;
}

/**
 * **A conta única de Buffunfa disponível** (AC#4/AC#5): o que o ledger diz na moeda da loja menos o que já
 * está preso em pedidos `reserved`. API, painel e o próprio `purchaseShopItem` dentro da transação passam
 * por aqui, então não existe uma segunda versão da verdade sobre quanto o membro pode gastar.
 *
 * Os dois `sum` são feitos no banco e voltam como `bigint` (o driver lê int8 como BigInt): Q20.
 */
export async function getShopBalance(db: Database | Tx, userId: string): Promise<ShopBalance> {
  const reserving = sql.join(
    RESERVING_SHOP_ORDER_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const [row] = await db.execute<{ balance: bigint; reserved: bigint }>(sql`
    select
      (select coalesce(sum(${ledgerEntries.amount}), 0)::int8 from ${ledgerEntries}
        where ${ledgerEntries.userId} = ${userId} and ${ledgerEntries.currency} = ${SHOP_CURRENCY}) as balance,
      (select coalesce(sum(${shopOrders.price}), 0)::int8 from ${shopOrders}
        where ${shopOrders.userId} = ${userId} and ${shopOrders.status} in (${reserving})) as reserved
  `);
  const balance = row?.balance ?? 0n;
  const reserved = row?.reserved ?? 0n;
  return { balance, reserved, available: balance - reserved };
}

export type PurchaseShopItemResult =
  | { ok: true; order: ShopOrderDto; balance: ShopBalance; item: ShopItemDto }
  | { ok: false; reason: "unknown_user" }
  | { ok: false; reason: "not_found" }
  | ({ ok: false } & ShopPurchaseRefusal);

/**
 * Compra (AC#4, AC#5). Numa transação só:
 *
 * 1. trava a linha do usuário e a do item (nessa ordem);
 * 2. **relê** saldo, reserva, estoque e publicação lá dentro — a tela pode estar velha, e é aqui que a
 *    regra vale (`checkShopPurchase`, a mesma função que o painel usa pra desabilitar o botão);
 * 3. decrementa o estoque (a reserva do estoque **é** o decremento) e grava o pedido `reserved`.
 *
 * O que ela **não** faz: lançar no ledger. A Buffunfa fica reservada e o extrato do membro não muda até a
 * entrega (TASK-060) — exatamente o desenho do `pending` do saque (Q25). É por isso que a compra não passa
 * pelo `spendCurrency`: aquela porta é a do débito, e o débito é da entrega.
 */
export async function purchaseShopItem(db: Database, input: { userId: string; itemId: string }): Promise<PurchaseShopItemResult> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    if (!owner) return { ok: false as const, reason: "unknown_user" as const };
    const [item] = await tx.select(itemColumns).from(shopItems).where(eq(shopItems.id, input.itemId)).for("update");
    if (!item) return { ok: false as const, reason: "not_found" as const };

    const balance = await getShopBalance(tx, input.userId);
    const refusal = checkShopPurchase(item, balance.balance, balance.reserved);
    if (refusal) return { ok: false as const, ...refusal };

    const [updated] = await tx
      .update(shopItems)
      .set({ ...(item.stock === null ? {} : { stock: item.stock - 1 }), updatedAt: new Date() })
      .where(eq(shopItems.id, item.id))
      .returning(itemColumns);
    const [order] = await tx
      .insert(shopOrders)
      .values({ userId: input.userId, itemId: item.id, itemName: item.name, price: item.price, status: "reserved" })
      .returning(orderColumns);
    const after = await getShopBalance(tx, input.userId);
    return { ok: true as const, order: toOrderDto(order!), balance: after, item: toItemDto(updated!) };
  });
}

/**
 * Lista pedidos, do mais novo pro mais antigo. `userId` é o que a visão do membro usa — e o controller
 * **sempre** o preenche com o id da sessão, nunca com algo vindo do cliente.
 */
export async function listShopOrders(db: Database, filters: { userId?: string; status?: readonly ("reserved" | "delivered" | "cancelled")[] } = {}): Promise<ShopOrderDto[]> {
  const where = [...(filters.userId ? [eq(shopOrders.userId, filters.userId)] : []), ...(filters.status?.length ? [inArray(shopOrders.status, [...filters.status])] : [])];
  const rows = await db
    .select({ ...orderColumns, nick: memberNick(users) })
    .from(shopOrders)
    .innerJoin(users, eq(users.id, shopOrders.userId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(shopOrders.createdAt), desc(shopOrders.id));
  return rows.map((r) => toOrderDto(r, r.nick));
}
