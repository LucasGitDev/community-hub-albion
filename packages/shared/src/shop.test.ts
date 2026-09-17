import { describe, expect, it } from "vitest";
import { asSubject, defineAbilityFor } from "./permissions.js";
import {
  ALLOWED_SHOP_ORDER_TRANSITIONS,
  canOwnerCancelShopOrder,
  canTransitionShopOrder,
  checkShopPurchase,
  isSoldOut,
  RESERVING_SHOP_ORDER_STATUSES,
  SHOP_CAPABILITIES,
  SHOP_CURRENCY,
  SHOP_ORDER_STATUSES,
  shopItemCreateSchema,
  shopItemUpdateSchema,
  shopOrderCancelSchema,
  shopOrderDeliverSchema,
  shopOrderRefundSchema,
  shopOrderRejectSchema,
  shopOrderTransitionError,
  SHOP_ORDER_OWNER_CANCEL_NOTE,
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

describe("loja: máquina de estados do pedido (TASK-060, F6-21 a F6-24)", () => {
  it("reserva enquanto não há lançamento: `reserved` e `claimed` (AC#5)", () => {
    // `claimed` é a staff ter pegado o pedido, não ter cobrado: a Buffunfa continua presa.
    expect(RESERVING_SHOP_ORDER_STATUSES).toEqual(["reserved", "claimed"]);
    expect(RESERVING_SHOP_ORDER_STATUSES).not.toContain("delivered");
  });

  it("percorre reserved → claimed → delivered, com cancelled e rejected terminais (AC#1)", () => {
    expect(canTransitionShopOrder("reserved", "claimed")).toBe(true);
    expect(canTransitionShopOrder("claimed", "delivered")).toBe(true);
    for (const terminal of ["delivered", "cancelled", "rejected"] as const) {
      expect(ALLOWED_SHOP_ORDER_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("entregar sem ter pegado não existe: é o buraco que o claimed fecha (F6-22)", () => {
    expect(canTransitionShopOrder("reserved", "delivered")).toBe(false);
  });

  it("claimed volta para reserved: o membro não fica preso a um staff que sumiu (AC#3, F6-22)", () => {
    expect(canTransitionShopOrder("claimed", "reserved")).toBe(true);
    // E de reserved não se "desvolta": a fila não tem estado anterior.
    expect(ALLOWED_SHOP_ORDER_TRANSITIONS.reserved).not.toContain("reserved");
  });

  it("cancelar e recusar valem nos dois estados abertos, e só neles (AC#6, AC#7)", () => {
    for (const open of ["reserved", "claimed"] as const) {
      expect(canTransitionShopOrder(open, "cancelled")).toBe(true);
      expect(canTransitionShopOrder(open, "rejected")).toBe(true);
    }
    expect(canTransitionShopOrder("delivered", "cancelled")).toBe(false);
    expect(canTransitionShopOrder("rejected", "cancelled")).toBe(false);
  });

  it("o comprador só cancela enquanto ninguém pegou (F6-24)", () => {
    expect(canOwnerCancelShopOrder("reserved")).toBe(true);
    expect(canOwnerCancelShopOrder("claimed")).toBe(false);
    expect(canOwnerCancelShopOrder("delivered")).toBe(false);
  });

  it("todo estado tem transições declaradas", () => {
    for (const status of SHOP_ORDER_STATUSES) expect(ALLOWED_SHOP_ORDER_TRANSITIONS[status]).toBeDefined();
  });

  it("a recusa da transição explica o que ainda dá para fazer (Q18)", () => {
    expect(shopOrderTransitionError("delivered", "cancelled")).toContain("estado final");
    expect(shopOrderTransitionError("reserved", "delivered")).toContain("em entrega");
  });
});

describe("loja: notas da fila (AC#4)", () => {
  it("a entrega exige nota: é onde e para quem o item foi entregue", () => {
    expect(shopOrderDeliverSchema.safeParse({ note: "  " }).success).toBe(false);
    expect(shopOrderDeliverSchema.parse({ note: " banco de Martlock " })).toEqual({ note: "banco de Martlock" });
  });

  it("recusa e estorno exigem motivo; a nota tem teto", () => {
    expect(shopOrderRejectSchema.safeParse({}).success).toBe(false);
    expect(shopOrderRefundSchema.safeParse({ note: "" }).success).toBe(false);
    expect(shopOrderDeliverSchema.safeParse({ note: "x".repeat(301) }).success).toBe(false);
  });

  it("cancelar aceita nota vazia: quem desiste do próprio pedido não preenche formulário", () => {
    expect(shopOrderCancelSchema.parse({})).toEqual({ note: null });
    expect(shopOrderCancelSchema.parse({ note: "membro desistiu" })).toEqual({ note: "membro desistiu" });
    expect(SHOP_ORDER_OWNER_CANCEL_NOTE).toContain("comprador");
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

  it("recusa preço acima do teto: 400 explicado em vez de 500 do banco", () => {
    expect(shopItemCreateSchema.safeParse({ name: "x", price: "999999999999999999999" }).success).toBe(false);
    expect(shopItemCreateSchema.safeParse({ name: "x", price: "1000000000" }).success).toBe(true);
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

  it("o comprador cancela o próprio pedido; nunca o de outro (AC#6, F6-24)", () => {
    const member = defineAbilityFor({ id: "u1", roles: ["member"] });
    expect(member.can("cancel", asSubject("ShopOrder", { userId: "u1" }))).toBe(true);
    expect(member.can("cancel", asSubject("ShopOrder", { userId: "u2" }))).toBe(false);
    // A staff encerra o pedido de qualquer um: depois de `claimed` é ela que cancela.
    const staff = ability(["member", "staff"]);
    expect(staff.can("cancel", asSubject("ShopOrder", { userId: "u2" }))).toBe(true);
  });

  it("membro vê o catálogo e compra; o pedido dos outros não é dele", () => {
    const member = ability(["member"]);
    expect(member.can("read", "ShopItem")).toBe(true);
    expect(member.can("create", "ShopOrder")).toBe(true);
    expect(member.can("manage", "ShopItem")).toBe(false);
  });
});
