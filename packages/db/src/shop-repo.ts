import {
  canOwnerCancelShopOrder,
  canTransitionShopOrder,
  checkShopPurchase,
  RESERVING_SHOP_ORDER_STATUSES,
  SHOP_CURRENCY,
  SHOP_ORDER_OWNER_CANCEL_NOTE,
  type ShopItemCreateInput,
  type ShopItemDto,
  type ShopItemUpdateInput,
  type ShopOrderDto,
  type ShopOrderListQuery,
  type ShopOrderStatus,
  type ShopPurchaseRefusal,
} from "@albion-hub/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "./client.js";
import { insertLedgerEntry, reverseLedgerEntry } from "./ledger-repo.js";
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
  reversalEntryId: shopOrders.reversalEntryId,
  handledBy: shopOrders.handledBy,
  handledAt: shopOrders.handledAt,
  note: shopOrders.note,
  createdAt: shopOrders.createdAt,
  updatedAt: shopOrders.updatedAt,
};

type OrderRow = { [K in keyof typeof orderColumns]: (typeof shopOrders.$inferSelect)[K] };

const toOrderDto = (row: OrderRow, userNick: string | null = null, handledByNick: string | null = null): ShopOrderDto => ({
  id: row.id,
  userId: row.userId,
  userNick,
  itemId: row.itemId,
  itemName: row.itemName,
  price: row.price.toString(),
  status: row.status,
  ledgerEntryId: row.ledgerEntryId,
  reversalEntryId: row.reversalEntryId,
  handledByUserId: row.handledBy,
  handledByNick,
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
 *
 * O nick de quem tratou o pedido vem junto (segundo `join` em `users`): sem ele a fila diria "em entrega"
 * sem dizer **por quem**, que é a única informação que faz o `claimed` servir pra algo (F6-22).
 */
export async function listShopOrders(db: Database, filters: ShopOrderListQuery = {}): Promise<ShopOrderDto[]> {
  const handler = alias(users, "shop_order_handler");
  const where = [...(filters.userId ? [eq(shopOrders.userId, filters.userId)] : []), ...(filters.status?.length ? [inArray(shopOrders.status, [...filters.status])] : [])];
  const rows = await db
    .select({ ...orderColumns, nick: memberNick(users), handlerNick: memberNick(handler) })
    .from(shopOrders)
    .innerJoin(users, eq(users.id, shopOrders.userId))
    .leftJoin(handler, eq(handler.id, shopOrders.handledBy))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(shopOrders.createdAt), desc(shopOrders.id));
  return rows.map((r) => toOrderDto(r, r.nick, r.handlerNick));
}

/** Um pedido pelo id, com os dois nicks. Quem pode vê-lo é decisão do controller (CASL), não daqui. */
export async function getShopOrder(db: Database, id: string): Promise<ShopOrderDto | null> {
  const handler = alias(users, "shop_order_handler");
  const [row] = await db
    .select({ ...orderColumns, nick: memberNick(users), handlerNick: memberNick(handler) })
    .from(shopOrders)
    .innerJoin(users, eq(users.id, shopOrders.userId))
    .leftJoin(handler, eq(handler.id, shopOrders.handledBy))
    .where(eq(shopOrders.id, id));
  return row ? toOrderDto(row, row.nick, row.handlerNick) : null;
}

/**
 * ---------------------------------------------------------------------------------------------------
 * A fila da staff (TASK-060, F6-21 a F6-24)
 * ---------------------------------------------------------------------------------------------------
 *
 * Tudo que muda o estado de um pedido passa por aqui, numa transação que trava **usuário → pedido →
 * item**, sempre nessa ordem. A ordem é a mesma da compra (F6-40) e por isso não existe deadlock entre
 * uma compra nova e uma entrega do mesmo item.
 *
 * A trava do **usuário** é o que serializa de verdade: a regra em jogo é sobre a Buffunfa dele (a reserva
 * de hoje, o débito da entrega), não sobre a linha do pedido. Travado o usuário, o estado é **relido
 * dentro** da transação — é isso que faz duas entregas simultâneas do mesmo pedido terminarem em um
 * lançamento só, e um cancelamento concorrente com a entrega terminar em um dos dois, nunca nos dois.
 */

/** O que uma decisão da staff (ou do comprador) precisa dizer. */
export interface ShopOrderActionOptions {
  /** Quem agiu. Nunca null: todo carimbo tem dono (o banco exige `handled_by` junto de `handled_at`). */
  actorUserId: string;
  /** `true` quando quem age tem `shop:fulfill`. Decide quem pode cancelar depois de `claimed` (F6-24). */
  isStaff?: boolean;
  note?: string | null;
  at?: Date;
}

export type ShopOrderActionResult =
  | { ok: true; order: ShopOrderDto }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "note_required" }
  /** Transição que a máquina de estados não permite (AC#2): `from` é o estado lido sob trava. */
  | { ok: false; reason: "invalid"; from: ShopOrderStatus }
  /** Comprador tentando cancelar um pedido que a staff já pegou (F6-24), ou pedido de outra pessoa. */
  | { ok: false; reason: "not_yours" }
  /** Estorno de pedido que já foi estornado: o ledger é append-only, e um pedido tem um estorno só. */
  | { ok: false; reason: "already_refunded" };

const trimmed = (note: string | null | undefined) => (typeof note === "string" && note.trim() ? note.trim() : null);

/** Trava usuário → pedido (sempre nessa ordem) e devolve a linha atual do pedido. */
async function lockOrder(tx: Tx, id: string): Promise<OrderRow | null> {
  const [owner] = await tx.select({ userId: shopOrders.userId }).from(shopOrders).where(eq(shopOrders.id, id));
  if (!owner) return null;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, owner.userId)).for("update");
  const [row] = await tx.select(orderColumns).from(shopOrders).where(eq(shopOrders.id, id)).for("update");
  return row ?? null;
}

/**
 * Devolve a unidade ao estoque, na **mesma transação** de quem encerrou o pedido (F6-19, AC#7). Item de
 * estoque ilimitado (`null`) não tem o que devolver.
 *
 * Isto nunca é chamado sozinho: separar a devolução do estoque da devolução da moeda é exatamente o que
 * faz item sumir do estoque sem ninguém receber nada.
 */
async function restoreStock(tx: Tx, itemId: string): Promise<void> {
  const [item] = await tx.select({ id: shopItems.id, stock: shopItems.stock }).from(shopItems).where(eq(shopItems.id, itemId)).for("update");
  if (!item || item.stock === null) return;
  await tx.update(shopItems).set({ stock: item.stock + 1, updatedAt: new Date() }).where(eq(shopItems.id, item.id));
}

const dto = async (tx: Tx, row: OrderRow): Promise<ShopOrderDto> => {
  const [names] = await tx
    .select({ nick: memberNick(users) })
    .from(users)
    .where(eq(users.id, row.userId));
  const [handler] = row.handledBy ? await tx.select({ nick: memberNick(users) }).from(users).where(eq(users.id, row.handledBy)) : [];
  return toOrderDto(row, names?.nick ?? null, handler?.nick ?? null);
};

/**
 * "Peguei este" (`reserved → claimed`, F6-22). Não mexe em moeda nem em estoque: a Buffunfa segue
 * reservada e o item segue fora do estoque. O que ele grava é **quem** pegou e **quando**, e é isso que
 * impede dois membros da staff de entregarem o mesmo item sem nunca descobrir.
 */
export async function claimShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionShopOrder(current.status, "claimed")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const [row] = await tx
      .update(shopOrders)
      .set({ status: "claimed", handledBy: options.actorUserId, handledAt: at, updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}

/**
 * Devolve o pedido à fila (`claimed → reserved`, F6-22): o staff que pegou desistiu, ou sumiu. Limpa
 * `handled_by`/`handled_at` porque o banco exige que `reserved` não tenha carimbo — e porque um pedido
 * que voltou pra fila com o nome de alguém em cima continuaria parecendo pego.
 */
export async function releaseShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionShopOrder(current.status, "reserved")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const [row] = await tx
      .update(shopOrders)
      .set({ status: "reserved", handledBy: null, handledAt: null, note: null, updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}

/**
 * Entrega (`claimed → delivered`, AC#4/AC#5): **lança o débito** de Buffunfa no ledger e amarra o
 * lançamento ao pedido, na mesma transação. Ou os dois acontecem ou nenhum — nunca existe pedido
 * entregue sem lançamento (o check do banco garante a recíproca) nem lançamento órfão.
 *
 * O saldo **não** é reconferido aqui, de propósito, pelo mesmo motivo da aprovação do saque: a Buffunfa
 * já estava reservada desde a compra, e um estorno no meio do caminho pode ter deixado o saldo negativo.
 * Recusar a entrega aqui deixaria o item entregue no jogo sem débito nenhum no painel.
 *
 * É por isso que a entrega não passa pelo `spendCurrency`: aquela porta abre a **própria** transação e
 * recusa saldo negativo, então usá-la deixaria o débito e o carimbo do pedido em transações diferentes —
 * exatamente o que não pode acontecer com dinheiro.
 */
export async function deliverShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  const note = trimmed(options.note);
  if (!note) return { ok: false, reason: "note_required" };
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionShopOrder(current.status, "delivered")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    const entry = await insertLedgerEntry(tx, {
      userId: current.userId,
      // Débito: a loja cobra em Buffunfa e só (F6-37).
      amount: -current.price,
      currency: SHOP_CURRENCY,
      kind: "purchase",
      reference: { type: "shop_order", id: current.id },
      createdBy: options.actorUserId,
      memo: `${current.itemName}: ${note}`,
    });
    const [row] = await tx
      .update(shopOrders)
      .set({ status: "delivered", ledgerEntryId: entry.id, handledBy: options.actorUserId, handledAt: at, note, updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}

/**
 * Cancelamento (`cancelled`). Quem cancela é o **comprador**, enquanto ninguém pegou o pedido (F6-24);
 * depois de `claimed`, só a staff. A decisão é tomada **dentro** da transação, com o pedido já travado:
 * checar antes deixaria a janela em que a staff pega o pedido entre a checagem e o cancelamento.
 *
 * Devolve moeda **e** estoque na mesma transação (F6-19): como nada foi lançado no ledger, devolver a
 * moeda é deixar a reserva cair — e a unidade volta ao estoque aqui, não num segundo passo que pode falhar.
 */
export async function cancelShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    const isStaff = options.isStaff === true;
    if (!isStaff && current.userId !== options.actorUserId) return { ok: false as const, reason: "not_yours" as const };
    if (!isStaff && !canOwnerCancelShopOrder(current.status)) {
      // Pedido já pego: o comprador não desfaz mais nada, mas o estado atual é uma transição válida — a
      // recusa aqui é de **quem** pode, não de para onde vai, e a frase da API precisa dizer isso.
      if (canTransitionShopOrder(current.status, "cancelled")) return { ok: false as const, reason: "not_yours" as const };
      return { ok: false as const, reason: "invalid" as const, from: current.status };
    }
    if (!canTransitionShopOrder(current.status, "cancelled")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    // Nota: a staff escreve o motivo; o comprador que desiste recebe a frase pronta (o banco exige nota).
    const note = trimmed(options.note) ?? (isStaff ? null : SHOP_ORDER_OWNER_CANCEL_NOTE);
    if (!note) return { ok: false as const, reason: "note_required" as const };
    await restoreStock(tx, current.itemId);
    const [row] = await tx
      .update(shopOrders)
      .set({ status: "cancelled", handledBy: options.actorUserId, handledAt: at, note, updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}

/**
 * Recusa da staff (`rejected`): o pedido não vai ser entregue (item que não existe mais, pedido feito por
 * engano). Devolve moeda e estoque na mesma transação, igual ao cancelamento, e exige motivo — é a única
 * explicação que o membro recebe.
 */
export async function rejectShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  const note = trimmed(options.note);
  if (!note) return { ok: false, reason: "note_required" };
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (!canTransitionShopOrder(current.status, "rejected")) return { ok: false as const, reason: "invalid" as const, from: current.status };
    await restoreStock(tx, current.itemId);
    const [row] = await tx
      .update(shopOrders)
      .set({ status: "rejected", handledBy: options.actorUserId, handledAt: at, note, updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}

/**
 * Estorno de pedido **já entregue** (F6-19, AC#7): a entrega não aconteceu de verdade, ou aconteceu
 * errada. Numa transação só: estorna o lançamento (`kind: reversal`, apontando para o débito) e devolve a
 * unidade ao estoque. Nunca um sem o outro.
 *
 * O pedido **continua `delivered`**: o ledger é append-only, e desfazer uma compra entregue é um
 * lançamento novo, não um estado novo — voltar o pedido para `cancelled` apagaria da tela o fato de que
 * ele foi entregue e depois corrigido, que é justamente o que alguém vai questionar. Quem marca o pedido
 * como estornado é `reversal_entry_id`, e o índice único nele é o que impede estornar duas vezes.
 */
export async function refundShopOrder(db: Database, id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
  const at = options.at ?? new Date();
  const note = trimmed(options.note);
  if (!note) return { ok: false, reason: "note_required" };
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (current.status !== "delivered" || !current.ledgerEntryId) return { ok: false as const, reason: "invalid" as const, from: current.status };
    if (current.reversalEntryId) return { ok: false as const, reason: "already_refunded" as const };
    const reversed = await reverseLedgerEntry(tx, current.ledgerEntryId, { reason: `Estorno da compra de ${current.itemName}: ${note}`, actorUserId: options.actorUserId });
    // `already_reversed` vem do índice único em `reversal_of`: é a corrida de dois estornos ao mesmo tempo.
    if (!reversed.ok) return { ok: false as const, reason: "already_refunded" as const };
    await restoreStock(tx, current.itemId);
    const [row] = await tx
      .update(shopOrders)
      .set({ reversalEntryId: reversed.entry.id, note: `${current.note ?? ""}${current.note ? " · " : ""}Estornado: ${note}`.slice(0, 300), updatedAt: at })
      .where(eq(shopOrders.id, id))
      .returning(orderColumns);
    return { ok: true as const, order: await dto(tx, row!) };
  });
}
