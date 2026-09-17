import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import {
  firstIssue,
  shopItemCreateSchema,
  shopItemUpdateSchema,
  shopPurchaseSchema,
  shopRefusalMessage,
  type ShopCatalogResponse,
  type ShopItemDto,
} from "@albion-hub/shared";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { ShopService, toShopBalanceDto } from "./shop.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string): string {
  if (!UUID.test(id)) throw new BadRequestException("Id do item inválido.");
  return id;
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
  async updateItem(@Param("id") id: string, @Body() body: unknown): Promise<ShopItemDto> {
    const patch = parseBody(shopItemUpdateSchema, body);
    const item = await this.shop.update(parseId(id), patch);
    if (!item) throw new NotFoundException("Item não encontrado.");
    return item;
  }
}
