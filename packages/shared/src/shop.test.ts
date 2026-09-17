import { describe, expect, it } from "vitest";
import { defineAbilityFor } from "./permissions.js";
import {
  ALLOWED_SHOP_ORDER_TRANSITIONS,
  canTransitionShopOrder,
  checkShopPurchase,
  isSoldOut,
  RESERVING_SHOP_ORDER_STATUSES,
  SHOP_CAPABILITIES,
  SHOP_CURRENCY,
  SHOP_ORDER_STATUSES,
  shopItemCreateSchema,
  shopItemUpdateSchema,
  shopOrderTransitionError,
  shopPurchaseSchema,
  shopRefusalMessage,
} from "./shop.js";

const item = (over: Partial<{ price: bigint; stock: number | null; published: boolean }> = {}) => ({ price: 100n, stock: null, published: true, ...over });

describe("loja: regras da compra (TASK-059)", () => {
  it("cobra em Buffunfa e só (F6-17/F6-20)", () => {
    expect(SHOP_CURRENCY).toBe("buffunfa");
  });

  it("deixa comprar quando o saldo cobre o preço", () => {
    expect(checkShopPurchase(item({ price: 100n }), 100n, 0n)).toBeNull();
  });

  it("recusa quando o saldo não cobre, descontando o que já está reservado (AC#4, F6-7)", () => {
    expect(checkShopPurchase(item({ price: 100n }), 150n, 60n)).toEqual({ reason: "insufficient", available: 90n, price: 100n });
    // Saldo cheio, mas preso em outro pedido: a reserva conta.
    expect(checkShopPurchase(item({ price: 100n }), 100n, 1n)).toMatchObject({ reason: "insufficient" });
  });

  it("recusa estoque zerado e item despublicado (AC#4)", () => {
    expect(checkShopPurchase(item({ stock: 0 }), 10_000n, 0n)).toEqual({ reason: "sold_out" });
    expect(checkShopPurchase(item({ published: false }), 10_000n, 0n)).toEqual({ reason: "unavailable" });
  });

  it("estoque null é ilimitado: nunca esgota", () => {
    expect(isSoldOut({ stock: null })).toBe(false);
    expect(isSoldOut({ stock: 3 })).toBe(false);
    expect(isSoldOut({ stock: 0 })).toBe(true);
  });

  it("a mensagem de saldo insuficiente diz quanto falta, em Buffunfa cheia (F6-5)", () => {
    const message = shopRefusalMessage({ reason: "insufficient", available: 90n, price: 340n });
    expect(message).toContain("250 BUF");
    expect(message).toContain("90 BUF");
  });

  it("a mensagem de esgotado diz que o item continua na lista (F6-18)", () => {
    expect(shopRefusalMessage({ reason: "sold_out" })).toContain("continua na lista");
    expect(shopRefusalMessage({ reason: "unavailable" })).toContain("saiu da loja");
  });
});

describe("loja: máquina de estados do pedido (AC#5)", () => {
  it("só `reserved` reserva: de `delivered` em diante o débito já está no ledger", () => {
    expect(RESERVING_SHOP_ORDER_STATUSES).toEqual(["reserved"]);
  });

  it("reserved vai para entregue ou cancelado; os dois são finais", () => {
    expect(canTransitionShopOrder("reserved", "delivered")).toBe(true);
    expect(canTransitionShopOrder("reserved", "cancelled")).toBe(true);
    expect(canTransitionShopOrder("delivered", "cancelled")).toBe(false);
    expect(canTransitionShopOrder("cancelled", "delivered")).toBe(false);
  });

  it("todo estado tem transições declaradas", () => {
    for (const status of SHOP_ORDER_STATUSES) expect(ALLOWED_SHOP_ORDER_TRANSITIONS[status]).toBeDefined();
  });

  it("a recusa da transição explica o que ainda dá para fazer (Q18)", () => {
    expect(shopOrderTransitionError("delivered", "cancelled")).toContain("estado final");
    expect(shopOrderTransitionError("reserved", "delivered")).toContain("aguardando entrega");
  });
});

describe("loja: schemas (AC#1)", () => {
  it("aceita item com estoque em branco como ilimitado (F6-17)", () => {
    const parsed = shopItemCreateSchema.parse({ name: "  Ping de evento ", description: " avisa a guilda ", price: "340" });
    expect(parsed).toEqual({ name: "Ping de evento", description: "avisa a guilda", price: 340n, stock: null, published: true });
  });

  it("aceita estoque zero: item esgotado é estado válido, não erro (F6-18)", () => {
    expect(shopItemCreateSchema.parse({ name: "Bolsa T8", price: 1000, stock: 0 }).stock).toBe(0);
  });

  it("recusa preço zero, negativo, fracionário e nome em branco", () => {
    expect(shopItemCreateSchema.safeParse({ name: "x", price: "0" }).success).toBe(false);
    expect(shopItemCreateSchema.safeParse({ name: "x", price: "-5" }).success).toBe(false);
    expect(shopItemCreateSchema.safeParse({ name: "x", price: 1.5 }).success).toBe(false);
    expect(shopItemCreateSchema.safeParse({ name: "   ", price: "10" }).success).toBe(false);
  });

  it("edição aceita um campo só, e recusa corpo vazio", () => {
    expect(shopItemUpdateSchema.parse({ price: "20" })).toEqual({ price: 20n });
    expect(shopItemUpdateSchema.parse({ published: false })).toEqual({ published: false });
    expect(shopItemUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("a compra não tem campo de usuário: o dono sai da sessão", () => {
    const parsed = shopPurchaseSchema.parse({ itemId: "11111111-1111-4111-8111-111111111111", userId: "outro" });
    expect(parsed).toEqual({ itemId: "11111111-1111-4111-8111-111111111111" });
  });
});

describe("loja: capacidades shop:manage e shop:fulfill (AC#6, F6-25)", () => {
  const ability = (roles: ("member" | "staff")[]) => defineAbilityFor({ id: "u1", roles });

  it("os nomes registrados para a F7 batem com as regras CASL de hoje", () => {
    const staff = ability(["member", "staff"]);
    for (const [action, subject] of Object.values(SHOP_CAPABILITIES)) expect(staff.can(action, subject)).toBe(true);
  });

  it("membro comum não tem nenhuma das duas", () => {
    const member = ability(["member"]);
    for (const [action, subject] of Object.values(SHOP_CAPABILITIES)) expect(member.can(action, subject)).toBe(false);
  });

  it("membro vê o catálogo e compra; o pedido dos outros não é dele", () => {
    const member = ability(["member"]);
    expect(member.can("read", "ShopItem")).toBe(true);
    expect(member.can("create", "ShopOrder")).toBe(true);
    expect(member.can("manage", "ShopItem")).toBe(false);
  });
});
