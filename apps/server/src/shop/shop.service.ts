import { Inject, Injectable } from "@nestjs/common";
import {
  cancelShopOrder,
  claimShopOrder,
  createShopItem,
  deliverShopOrder,
  getShopBalance,
  getShopItem,
  getShopOrder,
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
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Catálogo. `includeUnpublished` só para quem tem `shop:manage`; o membro vê o publicado. */
  items(options: { includeUnpublished?: boolean } = {}): Promise<ShopItemDto[]> {
    return listShopItems(this.handle.db, options);
  }

  item(id: string): Promise<ShopItemDto | null> {
    return getShopItem(this.handle.db, id);
  }

  create(input: ShopItemCreateInput, createdBy: string): Promise<ShopItemDto> {
    return createShopItem(this.handle.db, { ...input, createdBy });
  }

  /** Editar e despublicar são o mesmo caminho (AC#1): despublicar é `published: false`. */
  update(id: string, patch: ShopItemUpdateInput): Promise<ShopItemDto | null> {
    return updateShopItem(this.handle.db, id, patch);
  }

  /** Saldo de Buffunfa com a reserva dos pedidos descontada: a conta única da loja (AC#4). */
  balance(userId: string): Promise<ShopBalance> {
    return getShopBalance(this.handle.db, userId);
  }

  /** Compra: reserva moeda e estoque, revalidando dentro da transação (AC#4, AC#5). */
  purchase(userId: string, itemId: string): Promise<PurchaseShopItemResult> {
    return purchaseShopItem(this.handle.db, { userId, itemId });
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
  claim(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return claimShopOrder(this.handle.db, id, options);
  }

  /** Devolve o pedido à fila (F6-22): quem pegou desistiu. */
  release(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return releaseShopOrder(this.handle.db, id, options);
  }

  /** Entrega: lança o débito de Buffunfa e amarra o lançamento ao pedido, na mesma transação (AC#5). */
  deliver(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return deliverShopOrder(this.handle.db, id, options);
  }

  /** Cancelamento. O comprador só antes de `claimed`; depois disso, só a staff (AC#6, F6-24). */
  cancel(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return cancelShopOrder(this.handle.db, id, options);
  }

  /** Recusa da staff: devolve Buffunfa e estoque na mesma transação (AC#7). */
  reject(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return rejectShopOrder(this.handle.db, id, options);
  }

  /** Estorno de pedido entregue: estorno no ledger + estoque de volta, juntos (AC#7, F6-19). */
  refund(id: string, options: ShopOrderActionOptions): Promise<ShopOrderActionResult> {
    return refundShopOrder(this.handle.db, id, options);
  }
}

/** Buffunfa vai para o JSON como string: número de JS não aguenta bigint (Q20). */
export const toShopBalanceDto = (balance: ShopBalance): ShopBalanceDto => ({
  balance: balance.balance.toString(),
  reserved: balance.reserved.toString(),
  available: balance.available.toString(),
});
