import type { ShopOrderDto, ShopOrderQueueResponse } from "@albion-hub/shared";
import { api } from "./http";
import type { ShopOrder } from "./shop";

/**
 * Fila de pedidos da loja (TASK-060) contra a API real, no molde de `withdrawals-queue`: uma leitura da
 * fila inteira e um POST por transição. Quem agiu (`handled_by`) sai **sempre** da sessão no servidor,
 * nunca daqui — o corpo destas chamadas só carrega a nota.
 *
 * Preço chega como string e **vira bigint aqui**, na borda (Q20): nada no caminho do cálculo (a soma da
 * Buffunfa presa na fila) passa por `number`.
 */
export const toQueueOrder = (dto: ShopOrderDto): ShopOrder => ({ ...dto, price: BigInt(dto.price) });

/** A fila inteira: a tela filtra por aba no cliente, então o contador de cada aba é sempre coerente. */
export const fetchShopOrderQueue = (): Promise<ShopOrder[]> =>
  api<ShopOrderQueueResponse>("/api/shop/orders").then((res) => res.orders.map(toQueueOrder));

/**
 * As transições. A mensagem de erro — inclusive o 409 de "outro staff já entregou" e o 403 de "a staff já
 * pegou esse pedido" — vem pronta da API: a tela nunca escreve a sua própria versão da regra.
 */
const act = (id: string, action: "claim" | "release" | "deliver" | "cancel" | "reject" | "refund", note?: string): Promise<ShopOrderDto> =>
  api<ShopOrderDto>(`/api/shop/orders/${id}/${action}`, { method: "POST", body: JSON.stringify(note === undefined ? {} : { note }) });

/** "Peguei este": o que impede dois membros da staff de entregarem o mesmo item (F6-22). */
export const claimShopOrder = (id: string): Promise<ShopOrderDto> => act(id, "claim");
/** Devolve o pedido à fila: quem pegou desistiu (F6-22). */
export const releaseShopOrder = (id: string): Promise<ShopOrderDto> => act(id, "release");
/** Entrega: lança o débito de Buffunfa. A nota diz onde e para quem foi entregue (AC#4). */
export const deliverShopOrder = (id: string, note: string): Promise<ShopOrderDto> => act(id, "deliver", note);
/** Recusa da staff: devolve Buffunfa e estoque juntos (AC#7). */
export const rejectShopOrder = (id: string, note: string): Promise<ShopOrderDto> => act(id, "reject", note);
/** Estorno do pedido entregue: estorno no ledger + estoque de volta (F6-19). */
export const refundShopOrder = (id: string, note: string): Promise<ShopOrderDto> => act(id, "refund", note);

/**
 * Cancelamento. A mesma rota serve o comprador (sem nota: o servidor escreve a frase) e a staff (com o
 * motivo escrito) — quem separa os dois é o CASL no servidor, não este arquivo.
 */
export const cancelShopOrder = (id: string, note?: string): Promise<ShopOrderDto> => act(id, "cancel", note);
