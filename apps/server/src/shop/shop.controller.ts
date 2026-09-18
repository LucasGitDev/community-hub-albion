import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  asSubject,
  firstIssue,
  parseShopOrderListQuery,
  shopItemCreateSchema,
  shopItemUpdateSchema,
  shopOrderCancelSchema,
  shopOrderDeliverSchema,
  shopOrderRefundSchema,
  shopOrderRejectSchema,
  shopOrderTransitionError,
  shopPurchaseSchema,
  shopRefusalMessage,
  type ShopCatalogResponse,
  type ShopItemDto,
  type ShopOrderDto,
  type ShopOrderQueueResponse,
  type ShopOrderStatus,
} from "@albion-hub/shared";
import type { ShopOrderActionResult } from "@albion-hub/db";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { ShopService, toShopBalanceDto } from "./shop.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string, what = "item"): string {
  if (!UUID.test(id)) throw new BadRequestException(`Id do ${what} inválido.`);
  return id;
}

/**
 * 404/409/403 PT-BR do resultado de uma transição. `note_required` quase nunca chega aqui (o zod pega
 * antes), mas a frase existe porque o cancelamento aceita nota vazia e o banco não.
 */
function unwrap(result: ShopOrderActionResult, to: ShopOrderStatus): ShopOrderDto {
  if (result.ok) return result.order;
  switch (result.reason) {
    case "not_found":
      throw new NotFoundException("Pedido não encontrado.");
    case "not_yours":
      // Depois de `claimed` quem encerra é a staff (F6-24): alguém pode já estar no jogo com o item.
      throw new ForbiddenException("A staff já pegou esse pedido para entregar. Fale com ela para cancelar.");
    case "already_refunded":
      throw new ConflictException("Esse pedido já foi estornado: a Buffunfa e o estoque já voltaram.");
    case "note_required":
      throw new BadRequestException("Escreva a nota: ela fica no histórico do pedido.");
    case "invalid":
      throw new ConflictException(shopOrderTransitionError(result.from, to));
  }
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
  return parsed.data;
}

/**
 * Loja (TASK-059). Uma rota de leitura para o membro, uma de compra, e o CRUD de item da staff — todas
 * sob o mesmo controller porque são a mesma tela.
 *
 * Segurança: o dono da compra e dos pedidos sai **sempre** de `auth.user.id`. O corpo da compra sequer
 * tem campo de usuário (`shopPurchaseSchema`), então não há o que ignorar — mesma regra do saque
 * (security-review da TASK-026).
 */
@Controller("shop")
export class ShopController {
  constructor(@Inject(ShopService) private readonly shop: ShopService) {}

  /** `true` quando o usuário tem `shop:manage` (F6-25): enxerga também os itens despublicados. */
  private canManage(auth: Auth): boolean {
    return auth.ability.can("manage", "ShopItem");
  }

  /**
   * O que a tela desenha numa chamada só (AC#2): catálogo + saldo de Buffunfa + os meus pedidos.
   *
   * Item esgotado **vem na lista** (F6-18): quem marca como esgotado é a tela, lendo `stock`.
   */
  @Get()
  @Authorize("read", "ShopItem")
  async catalog(@CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<ShopCatalogResponse> {
    res.setHeader("Cache-Control", "no-store");
    const [items, balance, orders] = await Promise.all([
      this.shop.items({ includeUnpublished: this.canManage(auth) }),
      this.shop.balance(auth.user.id),
      this.shop.orders({ userId: auth.user.id }),
    ]);
    return { items, balance: toShopBalanceDto(balance), orders };
  }

  /**
   * Compra (AC#4, AC#5). Reserva Buffunfa e estoque; **nada** é lançado no ledger aqui — o débito é da
   * entrega (TASK-060). O 409 sai quando o saldo não cobre, o estoque acabou ou o item saiu da loja entre
   * a tela e o clique, sempre com a decisão tomada dentro da transação.
   */
  @Post("orders")
  @UseGuards(SameOriginGuard)
  @Authorize("create", "ShopOrder")
  async buy(@Body() body: unknown, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<ShopCatalogResponse> {
    const { itemId } = parseBody(shopPurchaseSchema, body);
    const result = await this.shop.purchase(auth.user.id, itemId);
    if (!result.ok) {
      if (result.reason === "unknown_user") throw new NotFoundException("Usuário não encontrado.");
      if (result.reason === "not_found") throw new NotFoundException("Item não encontrado.");
      throw new ConflictException(shopRefusalMessage(result));
    }
    res.status(201);
    res.setHeader("Cache-Control", "no-store");
    const [items, orders] = await Promise.all([this.shop.items({ includeUnpublished: this.canManage(auth) }), this.shop.orders({ userId: auth.user.id })]);
    return { items, balance: toShopBalanceDto(result.balance), orders };
  }

  /** Cadastra um item (AC#1). `shop:manage` (F6-25), hoje no bloco staff. */
  @Post("items")
  @UseGuards(SameOriginGuard)
  @Authorize("manage", "ShopItem")
  async createItem(@Body() body: unknown, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<ShopItemDto> {
    const input = parseBody(shopItemCreateSchema, body);
    res.status(201);
    return this.shop.create(input, auth.user.id);
  }

  /**
   * Edita o item (AC#1): nome, descrição, preço, estoque e publicação. Despublicar é `published: false` —
   * o item some da loja do membro e os pedidos já feitos continuam de pé, com nome e preço congelados.
   */
  @Patch("items/:id")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("manage", "ShopItem")
  async updateItem(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<ShopItemDto> {
    const patch = parseBody(shopItemUpdateSchema, body);
    const item = await this.shop.update(parseId(id), patch, auth.user.id);
    if (!item) throw new NotFoundException("Item não encontrado.");
    return item;
  }

  /** `true` quando o usuário tem `shop:fulfill` (F6-25): trabalha a fila inteira. */
  private canFulfill(auth: Auth): boolean {
    return auth.ability.can("fulfill", "ShopOrder");
  }

  /**
   * A fila que a staff trabalha (AC#8). A ação é `read`, que o **membro também tem** — mas só sobre os
   * próprios pedidos (regra com condição `userId`). Por isso, sem `shop:fulfill`, o filtro é forçado para
   * o id da sessão: a rota nunca devolve pedido de terceiro a quem não pode ver, e pedir o de outro dá
   * 403 em vez de vazar em silêncio. Mesmo desenho da fila de saques.
   */
  @Get("orders")
  @Authorize("read", "ShopOrder")
  async queue(@Query() query: Record<string, unknown>, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<ShopOrderQueueResponse> {
    const parsed = parseShopOrderListQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const all = this.canFulfill(auth);
    if (!all && parsed.filters.userId && parsed.filters.userId !== auth.user.id) throw new ForbiddenException("Você só pode ver os seus próprios pedidos.");
    res.setHeader("Cache-Control", "no-store");
    return { orders: await this.shop.orders({ ...parsed.filters, userId: all ? parsed.filters.userId : auth.user.id }) };
  }

  /** "Peguei este" (F6-22): sem isso dois membros da staff entregam o mesmo item. */
  @Post("orders/:id/claim")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("fulfill", "ShopOrder")
  async claim(@Param("id") id: string, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    return unwrap(await this.shop.claim(parseId(id, "pedido"), { actorUserId: auth.user.id, isStaff: true }), "claimed");
  }

  /** Devolve o pedido à fila: o membro não pode ficar preso a um staff que sumiu (AC#3). */
  @Post("orders/:id/release")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("fulfill", "ShopOrder")
  async release(@Param("id") id: string, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    return unwrap(await this.shop.release(parseId(id, "pedido"), { actorUserId: auth.user.id, isStaff: true }), "reserved");
  }

  /** Entrega: lança o débito de Buffunfa. Nota obrigatória — onde e para quem foi entregue (AC#4). */
  @Post("orders/:id/deliver")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("fulfill", "ShopOrder")
  async deliver(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    const { note } = parseBody(shopOrderDeliverSchema, body);
    return unwrap(await this.shop.deliver(parseId(id, "pedido"), { actorUserId: auth.user.id, isStaff: true, note }), "delivered");
  }

  /** Recusa da staff: devolve Buffunfa e estoque juntos (AC#7). Motivo obrigatório. */
  @Post("orders/:id/reject")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("fulfill", "ShopOrder")
  async reject(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    const { note } = parseBody(shopOrderRejectSchema, body);
    return unwrap(await this.shop.reject(parseId(id, "pedido"), { actorUserId: auth.user.id, isStaff: true, note }), "rejected");
  }

  /** Estorno de pedido entregue: estorno no ledger + estoque de volta, na mesma transação (F6-19). */
  @Post("orders/:id/refund")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("fulfill", "ShopOrder")
  async refund(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    const { note } = parseBody(shopOrderRefundSchema, body);
    return unwrap(await this.shop.refund(parseId(id, "pedido"), { actorUserId: auth.user.id, isStaff: true, note }), "delivered");
  }

  /**
   * Cancelamento (AC#6, F6-24). A mesma rota serve o comprador e a staff, e é o **CASL** que separa os
   * dois: o membro tem `cancel` só com a condição de ser o dono, a staff tem sem condição. Quem decide se
   * ainda dá tempo (`reserved` sim, `claimed` não) é a regra da fila, **dentro** da transação — checar
   * aqui deixaria a janela em que a staff pega o pedido entre a checagem e o cancelamento.
   *
   * O 404 (e não 403) de pedido de outro membro vem antes: a resposta não diz nem que o id existe.
   */
  @Post("orders/:id/cancel")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("read", "ShopOrder")
  async cancel(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<ShopOrderDto> {
    const orderId = parseId(id, "pedido");
    const order = await this.shop.order(orderId);
    if (!order || !auth.ability.can("read", asSubject("ShopOrder", { userId: order.userId }))) throw new NotFoundException("Pedido não encontrado.");
    if (!auth.ability.can("cancel", asSubject("ShopOrder", { userId: order.userId }))) throw new ForbiddenException("Você não pode cancelar esse pedido.");
    const isStaff = this.canFulfill(auth);
    // Nota só da staff: a frase do comprador que desiste é escrita pelo servidor (o banco exige nota).
    const { note } = parseBody(shopOrderCancelSchema, body ?? {});
    return unwrap(await this.shop.cancel(orderId, { actorUserId: auth.user.id, isStaff, note: isStaff ? note : null }), "cancelled");
  }
}
