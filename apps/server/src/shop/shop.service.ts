import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  cancelShopOrder,
  claimShopOrder,
  createShopItem,
  deliverShopOrder,
  findDiscordIdByUserId,
  getShopBalance,
  getShopItem,
  getShopOrder,
  listMemberNicks,
  listShopItems,
  listShopOrders,
  purchaseShopItem,
  refundShopOrder,
  rejectShopOrder,
  releaseShopOrder,
  updateShopItem,
  type DbHandle,
  type PurchaseShopItemResult,
  type ShopBalance,
  type ShopOrderActionOptions,
  type ShopOrderActionResult,
} from "@albion-hub/db";
import type { ShopBalanceDto, ShopItemCreateInput, ShopItemDto, ShopItemUpdateInput, ShopOrderDto, ShopOrderListQuery } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelineActor, type TimelineDetail, type TimelinePublisher, type TimelineTarget } from "../domain/timeline.js";

type Person = { id: string; name: string; discordId: string | null };
type OrderTransition = "claimed" | "released" | "delivered" | "cancelled" | "rejected" | "refunded";

/** Frase do título de cada transição do pedido na timeline (TASK-079). */
const ORDER_SUMMARY: Record<OrderTransition, string> = {
  claimed: "Pedido pego pela staff",
  released: "Pedido devolvido à fila",
  delivered: "Pedido entregue",
  cancelled: "Pedido cancelado",
  rejected: "Pedido recusado",
  refunded: "Pedido estornado",
};

/**
 * Serviço interno único da loja (TASK-059; regra do repo: comando do Discord, painel e botão de embed
 * chamam este serviço, nunca o repo nem SQL).
 *
 * O que ele garante:
 * - a compra **reserva** Buffunfa e estoque sem lançar nada no ledger (AC#5); o débito é da entrega (060);
 * - compras concorrentes não furam o saldo nem o estoque: a trava e a revalidação vivem na transação do
 *   repo (AC#4);
 * - item esgotado continua no catálogo, marcado (F6-18) — nada aqui filtra estoque zero.
 *
 * **Segurança**: todo método que fala de um membro recebe `userId` como argumento e confia em quem chama.
 * Quem amarra esse `userId` à sessão é o controller, como no saque (security-review da TASK-026).
 */
@Injectable()
export class ShopService {
  private readonly logger = new Logger("ShopService");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  /**
   * Nome e Discord de quem aparece na timeline (TASK-079). Lido **depois** do commit, fora da transação:
   * é só rótulo, e errar um nick nunca pode desfazer a operação.
   */
  private async person(userId: string): Promise<Person> {
    const [[nick], discordId] = await Promise.all([listMemberNicks(this.handle.db, [userId]), findDiscordIdByUserId(this.handle.db, userId)]);
    return { id: userId, name: nick?.nick ?? "Membro", discordId };
  }

  /**
   * Roda a publicação sem deixar erro subir (T6): a operação já commitou, e falha ao montar o registro
   * (ex.: banco caiu na leitura do nick) vira aviso no log, nunca 500 para quem comprou ou entregou.
   */
  private async safely(what: string, publish: () => Promise<void> | void): Promise<void> {
    try {
      await publish();
    } catch (error) {
      this.logger.warn(`Timeline: não publicou ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private static actor(p: Person): TimelineActor {
    return { kind: "user", userId: p.id, name: p.name, discordId: p.discordId };
  }

  private static target(p: Person): TimelineTarget {
    return { name: p.name, id: p.id, discordId: p.discordId };
  }

  private publishItem(action: "created" | "updated" | "unpublished", item: ShopItemDto, actor: Person, details: TimelineDetail[] = []): void {
    const verb = { created: "Item criado", updated: "Item editado", unpublished: "Item despublicado" }[action];
    this.timeline.publish({
      action: `shop.item_${action}`,
      summary: `${verb}: ${item.name}`,
      actor: ShopService.actor(actor),
      amounts: [{ value: BigInt(item.price), currency: "buffunfa", label: "Preço" }],
      recordId: item.id,
      details: [{ name: "Estoque", value: item.stock === null ? "ilimitado" : String(item.stock) }, { name: "Publicado", value: item.published ? "sim" : "não" }, ...details],
    });
  }

  /** Uma linha por transição do pedido: comprador (alvo), item, valor e quem agiu. */
  private async publishOrder(transition: OrderTransition | "reserved", order: ShopOrderDto, actorUserId: string, extra: TimelineDetail[] = []): Promise<void> {
    const actor = await this.person(actorUserId);
    const buyer = order.userId === actorUserId ? actor : await this.person(order.userId);
    const summary = transition === "reserved" ? "Pedido reservado" : ORDER_SUMMARY[transition];
    const details: TimelineDetail[] = [{ name: "Item", value: order.itemName }, { name: "Status", value: order.status }, ...extra];
    if (order.note && transition !== "reserved") details.push({ name: "Nota", value: order.note });
    this.timeline.publish({
      action: `shop.order_${transition}`,
      summary: `${summary}: ${order.itemName} para ${buyer.name}`,
      actor: ShopService.actor(actor),
      target: ShopService.target(buyer),
      amounts: [{ value: BigInt(order.price), currency: "buffunfa" }],
      recordId: order.id,
      details,
    });
  }

  /** Publica a transição só quando ela aconteceu: recusa não vai para a timeline (T5). */
  private async transition(transition: OrderTransition, result: ShopOrderActionResult, options: ShopOrderActionOptions, extra: TimelineDetail[] = []): Promise<ShopOrderActionResult> {
    if (result.ok) await this.safely(`shop.order_${transition}`, () => this.publishOrder(transition, result.order, options.actorUserId, extra));
    return result;
  }

  /** Catálogo. `includeUnpublished` só para quem tem `shop:manage`; o membro vê o publicado. */
  items(options: { includeUnpublished?: boolean } = {}): Promise<ShopItemDto[]> {
    return listShopItems(this.handle.db, options);
  }

  item(id: string): Promise<ShopItemDto | null> {
    return getShopItem(this.handle.db, id);
  }

  async create(input: ShopItemCreateInput, createdBy: string): Promise<ShopItemDto> {
    const item = await createShopItem(this.handle.db, { ...input, createdBy });
    await this.safely("shop.item_created", async () => this.publishItem("created", item, await this.person(createdBy)));
    return item;
  }

  /**
   * Editar e despublicar são o mesmo caminho (AC#1): despublicar é `published: false`. Na timeline, a
   * edição que tira da loja um item publicado vira `shop.item_unpublished`; o resto é `shop.item_updated`,
   * com os campos enviados. `actorUserId` vem da sessão.
   */
  async update(id: string, patch: ShopItemUpdateInput, actorUserId: string): Promise<ShopItemDto | null> {
    const before = await getShopItem(this.handle.db, id).catch(() => null);
    const item = await updateShopItem(this.handle.db, id, patch);
    if (!item) return null;
    const changed = Object.keys(patch).join(", ");
    const details: TimelineDetail[] = changed ? [{ name: "Campos", value: changed }] : [];
    if (before && before.price !== item.price) details.push({ name: "Preço anterior", value: before.price });
    const unpublished = before?.published === true && !item.published;
    await this.safely("shop.item_updated", async () => this.publishItem(unpublished ? "unpublished" : "updated", item, await this.person(actorUserId), details));
    return item;
  }

  /** Saldo de Buffunfa com a reserva dos pedidos descontada: a conta única da loja (AC#4). */
  balance(userId: string): Promise<ShopBalance> {
    return getShopBalance(this.handle.db, userId);
  }

  /** Compra: reserva moeda e estoque, revalidando dentro da transação (AC#4, AC#5). */
  async purchase(userId: string, itemId: string): Promise<PurchaseShopItemResult> {
    const result = await purchaseShopItem(this.handle.db, { userId, itemId });
    if (result.ok) await this.safely("shop.order_reserved", () => this.publishOrder("reserved", result.order, userId));
    return result;
  }

  /** Pedidos. `filters.userId` é sempre preenchido pelo controller na visão do membro. */
  orders(filters: ShopOrderListQuery = {}): Promise<ShopOrderDto[]> {
    return listShopOrders(this.handle.db, filters);
  }

  order(id: string): Promise<ShopOrderDto | null> {
    return getShopOrder(this.handle.db, id);
  }

  /**
   * A fila da staff (TASK-060). Cada método é uma transição, e **toda** a regra (trava, releitura do
   * estado, débito no ledger, devolução de moeda e estoque) vive na transação do repo: este serviço é o
   * ponto único que o painel, o comando do Discord e o botão de embed chamam, e nenhum deles reimplementa
   * um pedaço da regra por conta própria.
   *
   * `actorUserId` e `isStaff` vêm do controller, da sessão e do CASL — nunca do corpo da requisição.
   */
  async claim(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return this.transition("claimed", await claimShopOrder(this.handle.db, id, options), options);
  }

  /** Devolve o pedido à fila (F6-22): quem pegou desistiu. */
  async release(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return this.transition("released", await releaseShopOrder(this.handle.db, id, options), options);
  }

  /** Entrega: lança o débito de Buffunfa e amarra o lançamento ao pedido, na mesma transação (AC#5). */
  async deliver(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return this.transition("delivered", await deliverShopOrder(this.handle.db, id, options), options);
  }

  /** Cancelamento. O comprador só antes de `claimed`; depois disso, só a staff (AC#6, F6-24). */
  async cancel(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    const result = await cancelShopOrder(this.handle.db, id, options);
    const by = result.ok && result.order.userId === options.actorUserId && !options.isStaff ? "comprador" : "staff";
    return this.transition("cancelled", result, options, [{ name: "Cancelado por", value: by }]);
  }

  /** Recusa da staff: devolve Buffunfa e estoque na mesma transação (AC#7). */
  async reject(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return this.transition("rejected", await rejectShopOrder(this.handle.db, id, options), options);
  }

  /** Estorno de pedido entregue: estorno no ledger + estoque de volta, juntos (AC#7, F6-19). */
  async refund(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    // A nota do pedido acumula a da entrega; o motivo do estorno vai à parte para ser lido de relance.
    const reason = options.note?.trim();
    return this.transition("refunded", await refundShopOrder(this.handle.db, id, options), options, reason ? [{ name: "Motivo do estorno", value: reason }] : []);
  }
}

/** Buffunfa vai para o JSON como string: número de JS não aguenta bigint (Q20). */
export const toShopBalanceDto = (balance: ShopBalance): ShopBalanceDto => ({
  balance: balance.balance.toString(),
  reserved: balance.reserved.toString(),
  available: balance.available.toString(),
});
