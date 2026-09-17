import { Inject, Injectable } from "@nestjs/common";
import {
  createShopItem,
  getShopBalance,
  getShopItem,
  listShopItems,
  listShopOrders,
  purchaseShopItem,
  updateShopItem,
  type DbHandle,
  type PurchaseShopItemResult,
  type ShopBalance,
} from "@albion-hub/db";
import type { ShopBalanceDto, ShopItemCreateInput, ShopItemDto, ShopItemUpdateInput, ShopOrderDto } from "@albion-hub/shared";
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
  orders(filters: { userId?: string } = {}): Promise<ShopOrderDto[]> {
    return listShopOrders(this.handle.db, filters);
  }
}

/** Buffunfa vai para o JSON como string: número de JS não aguenta bigint (Q20). */
export const toShopBalanceDto = (balance: ShopBalance): ShopBalanceDto => ({
  balance: balance.balance.toString(),
  reserved: balance.reserved.toString(),
  available: balance.available.toString(),
});
