import type { ShopBalanceDto, ShopCatalogResponse, ShopItemDto, ShopOrderDto } from "@albion-hub/shared";
import { api } from "./http";

/**
 * Loja (TASK-059) contra a API real: `/api/shop` traz catálogo, saldo de Buffunfa e os meus pedidos numa
 * chamada só, e `/api/shop/orders` compra. Nenhuma das duas aceita usuário — o dono sai da sessão.
 *
 * Preço e saldo chegam como string e **viram bigint aqui**, na borda (Q20): nada no caminho do cálculo
 * ("faltam quanto?") passa por `number`.
 */
export interface ShopItem extends Omit<ShopItemDto, "price"> {
  price: bigint;
}

export interface ShopOrder extends Omit<ShopOrderDto, "price"> {
  price: bigint;
}

export interface ShopBalance {
  balance: bigint;
  /** Preso em pedidos aguardando entrega (AC#5). */
  reserved: bigint;
  available: bigint;
}

export interface ShopCatalog {
  items: ShopItem[];
  balance: ShopBalance;
  orders: ShopOrder[];
}

const toItem = (dto: ShopItemDto): ShopItem => ({ ...dto, price: BigInt(dto.price) });
const toOrder = (dto: ShopOrderDto): ShopOrder => ({ ...dto, price: BigInt(dto.price) });
const toBalance = (dto: ShopBalanceDto): ShopBalance => ({ balance: BigInt(dto.balance), reserved: BigInt(dto.reserved), available: BigInt(dto.available) });

const toCatalog = (res: ShopCatalogResponse): ShopCatalog => ({ items: res.items.map(toItem), balance: toBalance(res.balance), orders: res.orders.map(toOrder) });

export const fetchShopCatalog = (): Promise<ShopCatalog> => api<ShopCatalogResponse>("/api/shop").then(toCatalog);

/** Compra. A recusa PT-BR (saldo, estoque, item fora da loja) vem da API, decidida na transação. */
export const buyShopItem = (itemId: string): Promise<ShopCatalog> =>
  api<ShopCatalogResponse>("/api/shop/orders", { method: "POST", body: JSON.stringify({ itemId }) }).then(toCatalog);

export interface ShopItemForm {
  name: string;
  description: string | null;
  price: string;
  /** Vazio = estoque ilimitado (F6-17). */
  stock: string;
  published?: boolean;
}

const itemBody = (form: ShopItemForm) => ({
  name: form.name,
  description: form.description,
  price: form.price,
  stock: form.stock.trim() === "" ? null : form.stock.trim(),
  ...(form.published === undefined ? {} : { published: form.published }),
});

export const createShopItem = (form: ShopItemForm): Promise<ShopItem> =>
  api<ShopItemDto>("/api/shop/items", { method: "POST", body: JSON.stringify(itemBody(form)) }).then(toItem);

export const updateShopItem = (id: string, form: ShopItemForm): Promise<ShopItem> =>
  api<ShopItemDto>(`/api/shop/items/${id}`, { method: "PATCH", body: JSON.stringify(itemBody(form)) }).then(toItem);

/** Despublicar e publicar são o mesmo PATCH: o item nunca é apagado (os pedidos apontam pra ele). */
export const setShopItemPublished = (id: string, published: boolean): Promise<ShopItem> =>
  api<ShopItemDto>(`/api/shop/items/${id}`, { method: "PATCH", body: JSON.stringify({ published }) }).then(toItem);
