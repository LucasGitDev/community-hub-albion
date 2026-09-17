import { z } from "zod";
import { formatAmount, type Currency } from "./currency.js";
import type { Action, SubjectType } from "./permissions.js";

/**
 * Loja da comunidade (TASK-059, F6-17 a F6-20, F6-25). Regras que valem para API, painel e bot.
 *
 * O item é **texto livre** (nome, descrição, preço, estoque opcional), não um catálogo tipado: categorias
 * na F6 seriam adivinhação, e três meses de uso dizem quais existem de verdade (F6-17).
 *
 * A compra é uma **reserva**, desenhada igual à fila de saques (Q25): o pedido nasce `reserved`, prende a
 * Buffunfa e o estoque, e **não lança nada no ledger**. O débito acontece na entrega (TASK-060), que é
 * quando a staff de fato entregou — cobrar antes seria cobrar por algo que ainda não existe, e o ledger é
 * append-only, então um "desfazer" viraria estorno de uma compra que nunca aconteceu.
 *
 * A fila que a staff trabalha é a TASK-060 (F6-21 a F6-24): `claimed` para ela sinalizar "peguei este",
 * `delivered` para lançar o débito, `cancelled` (comprador) e `rejected` (staff) para encerrar devolvendo
 * moeda **e** estoque na mesma transação.
 */

/**
 * A loja cobra em **Buffunfa**, sempre. Constante em vez de coluna `currency` na tabela: uma loja que
 * aceitasse prata competiria com o saque, e generalizar agora seria inventar um requisito.
 */
export const SHOP_CURRENCY: Currency = "buffunfa";

/**
 * Estados do pedido:
 *
 *   reserved ──claim──> claimed ──deliver──> delivered
 *      │        <─release─┘  │
 *      ├──cancel/reject──────┴──> cancelled (comprador) / rejected (staff)
 *
 * - `reserved` prende Buffunfa e estoque **sem lançamento** (AC#5, mesmo desenho do `pending` do saque);
 * - `claimed` é a staff dizendo "peguei este" antes de entrar no jogo (F6-22): sem ele dois membros da
 *   staff entregam o mesmo item e ninguém descobre. Ele **volta para `reserved`** (release) se ela
 *   desistir — o membro não pode ficar preso a um staff que sumiu;
 * - `delivered` lança o débito no ledger e amarra o lançamento ao pedido (AC#5);
 * - `cancelled` (comprador) e `rejected` (staff) devolvem moeda e estoque na **mesma** transação (F6-19).
 *
 * Não há confirmação do comprador nem disputa (F6-21): a staff é confiável, e exigir clique do comprador
 * encheria a fila de pedidos entregues e eternamente abertos.
 */
export const SHOP_ORDER_STATUSES = ["reserved", "claimed", "delivered", "cancelled", "rejected"] as const;
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number];

export const SHOP_ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  reserved: "aguardando entrega",
  claimed: "em entrega",
  delivered: "entregue",
  cancelled: "cancelado",
  rejected: "recusado",
};

/**
 * Estados que **reservam**: pedido que ainda não virou lançamento. `claimed` entra aqui junto de
 * `reserved` — a staff ter pegado o pedido não tirou Buffunfa nenhuma do ledger, e deixar `claimed` fora
 * devolveria o valor ao disponível do membro no instante em que alguém clicasse "vou entregar".
 */
export const RESERVING_SHOP_ORDER_STATUSES: readonly ShopOrderStatus[] = ["reserved", "claimed"];

/**
 * A máquina de estados. `reserved → delivered` **não** existe de propósito: entregar sem ter pegado
 * reabre exatamente o buraco que o `claimed` fecha (F6-22), que é dois membros da staff entregando o
 * mesmo item. Quem quer entregar pega primeiro — são dois cliques, e o segundo staff vê o primeiro.
 */
export const ALLOWED_SHOP_ORDER_TRANSITIONS: Record<ShopOrderStatus, readonly ShopOrderStatus[]> = {
  reserved: ["claimed", "cancelled", "rejected"],
  claimed: ["reserved", "delivered", "cancelled", "rejected"],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const canTransitionShopOrder = (from: ShopOrderStatus, to: ShopOrderStatus): boolean => ALLOWED_SHOP_ORDER_TRANSITIONS[from].includes(to);

/** Frase PT-BR da transição recusada (Q18: diz o que ainda dá pra fazer). */
export function shopOrderTransitionError(from: ShopOrderStatus, to: ShopOrderStatus): string {
  const next = ALLOWED_SHOP_ORDER_TRANSITIONS[from];
  const base = `O pedido está ${SHOP_ORDER_STATUS_LABELS[from]} e não pode ir para ${SHOP_ORDER_STATUS_LABELS[to]}.`;
  if (next.length === 0) return `${base} Esse é um estado final.`;
  return `${base} Daqui só dá para ir para: ${next.map((s) => SHOP_ORDER_STATUS_LABELS[s]).join(", ")}.`;
}

/** Estados em que o pedido ainda está na mesa da staff: é a fila de trabalho (AC#8). */
export const OPEN_SHOP_ORDER_STATUSES: readonly ShopOrderStatus[] = ["reserved", "claimed"];

export const isOpenShopOrder = (status: ShopOrderStatus): boolean => OPEN_SHOP_ORDER_STATUSES.includes(status);

/**
 * O comprador cancela **enquanto ninguém pegou** (F6-24). Depois de `claimed` alguém já pode estar no
 * jogo com o item na mão: dali em diante quem encerra é a staff (`reject`), porque cancelar pelas costas
 * de quem já entregou faria o item sair do estoque sem pedido nenhum apontando para ele.
 */
export const canOwnerCancelShopOrder = (status: ShopOrderStatus): boolean => status === "reserved";

export const SHOP_ORDER_NOTE_MAX = 300;

const requiredNote = (label: string) =>
  z
    .string({ error: `Escreva ${label}.` })
    .trim()
    .min(1, `Escreva ${label}.`)
    .max(SHOP_ORDER_NOTE_MAX, `O texto tem no máximo ${SHOP_ORDER_NOTE_MAX} caracteres.`);

/** Entrega exige nota dizendo **onde e para quem** foi entregue (AC#4): é o recibo do débito. */
export const shopOrderDeliverSchema = z.object({ note: requiredNote("onde e para quem você entregou (ex: no banco de Martlock, para Fulano)") });
export type ShopOrderDeliverInput = z.output<typeof shopOrderDeliverSchema>;

/** Recusa da staff exige motivo: é a única explicação que o membro recebe. */
export const shopOrderRejectSchema = z.object({ note: requiredNote("o motivo da recusa: o membro vê essa mensagem") });
export type ShopOrderRejectInput = z.output<typeof shopOrderRejectSchema>;

/** Estorno de pedido entregue exige motivo (o ledger é append-only: o estorno é a correção, F6-19). */
export const shopOrderRefundSchema = z.object({ note: requiredNote("o motivo do estorno: ele fica no extrato do membro") });
export type ShopOrderRefundInput = z.output<typeof shopOrderRefundSchema>;

/**
 * Cancelamento: a nota é opcional. Quando a staff cancela ela escreve o motivo; quando o próprio
 * comprador desiste, o servidor escreve a linha por ele — o banco exige nota em todo cancelamento, e
 * obrigar o membro a justificar a própria desistência é um formulário a mais para nada.
 */
export const shopOrderCancelSchema = z.object({
  note: z.string().trim().max(SHOP_ORDER_NOTE_MAX, `O texto tem no máximo ${SHOP_ORDER_NOTE_MAX} caracteres.`).nullish().transform((v) => (v ? v : null)),
});
export type ShopOrderCancelInput = z.output<typeof shopOrderCancelSchema>;

/** Nota que o servidor grava quando o próprio comprador desiste antes de alguém pegar o pedido. */
export const SHOP_ORDER_OWNER_CANCEL_NOTE = "Cancelado pelo próprio comprador antes da entrega.";

/**
 * As capacidades da loja com os nomes já registrados para a F7 (F6-25). Hoje as duas moram no bloco
 * `staff` e o que decide de verdade é o CASL — este mapa é a **lista pronta** que a F7 vai transformar em
 * permissão atribuível uma a uma, e o teste que prova que os nomes batem com as regras de hoje.
 */
export const SHOP_CAPABILITIES = {
  /** Publicar item, definir preço, editar e despublicar. */
  "shop:manage": ["manage", "ShopItem"],
  /** Pegar, entregar, recusar e estornar o pedido de um membro. Consumida pela fila da TASK-060. */
  "shop:fulfill": ["fulfill", "ShopOrder"],
} as const satisfies Record<string, readonly [Action, SubjectType]>;

export type ShopCapability = keyof typeof SHOP_CAPABILITIES;

export const SHOP_ITEM_NAME_MAX = 80;
export const SHOP_ITEM_DESCRIPTION_MAX = 500;
/** Teto de estoque: é contagem manual da staff, não inventário de verdade. */
export const SHOP_ITEM_STOCK_MAX = 100_000;
/**
 * Teto de preço. Não é regra de produto — é o que faz um preço absurdo virar 400 explicado em vez de
 * estourar o `int8` do banco e voltar 500 mudo. Buffunfa é de unidade/dezena a milhares (F6-5).
 */
export const SHOP_ITEM_PRICE_MAX = 1_000_000_000n;

/** Preço em Buffunfa: inteiro positivo (Q20), aceito como número seguro, string de dígitos ou bigint. */
const price = z
  .union([z.number(), z.string(), z.bigint()])
  .transform((v, ctx) => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) {
        ctx.addIssue({ code: "custom", message: "Informe o preço em Buffunfa inteira, sem centavos." });
        return z.NEVER;
      }
      return BigInt(v);
    }
    const raw = v.trim();
    if (!/^\d+$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: "Informe o preço em Buffunfa inteira, só números." });
      return z.NEVER;
    }
    return BigInt(raw);
  })
  .refine((v) => v > 0n, "O preço precisa ser maior que zero.")
  .refine((v) => v <= SHOP_ITEM_PRICE_MAX, `O preço vai até ${SHOP_ITEM_PRICE_MAX.toString()} de Buffunfa.`);

/** Estoque: inteiro >= 0, ou `null` para ilimitado (F6-17: estoque é **opcional**). */
const stock = z
  .union([z.number(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null) return null;
    const raw = typeof v === "string" ? v.trim() : v;
    if (raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > SHOP_ITEM_STOCK_MAX) {
      ctx.addIssue({ code: "custom", message: `Estoque vai de 0 a ${SHOP_ITEM_STOCK_MAX}, ou deixe em branco para ilimitado.` });
      return z.NEVER;
    }
    return n;
  })
  .nullish()
  .transform((v) => v ?? null);

const name = z
  .string({ error: "Escreva o nome do item." })
  .trim()
  .min(1, "Escreva o nome do item.")
  .max(SHOP_ITEM_NAME_MAX, `O nome tem no máximo ${SHOP_ITEM_NAME_MAX} caracteres.`);

const description = z
  .string()
  .trim()
  .max(SHOP_ITEM_DESCRIPTION_MAX, `A descrição tem no máximo ${SHOP_ITEM_DESCRIPTION_MAX} caracteres.`)
  .nullish()
  .transform((v) => (v ? v : null));

/** Cadastro de item (AC#1). Nasce publicado: item cadastrado e invisível seria trabalho jogado fora. */
export const shopItemCreateSchema = z.object({ name, description, price, stock, published: z.boolean().optional().transform((v) => v ?? true) });
export type ShopItemCreateInput = z.output<typeof shopItemCreateSchema>;

/** Edição: os mesmos campos, todos opcionais — a staff mexe no preço sem reescrever a descrição. */
export const shopItemUpdateSchema = z
  .object({ name: name.optional(), description: description.optional(), price: price.optional(), stock: stock.optional(), published: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nada para alterar.");
export type ShopItemUpdateInput = z.output<typeof shopItemUpdateSchema>;

/**
 * Corpo da compra. **Não tem `userId`**: o dono sai sempre da sessão, nunca do corpo — mesma regra do
 * saque (security-review da TASK-026). Também não tem preço: quem diz quanto custa é o catálogo.
 */
export const shopPurchaseSchema = z.object({ itemId: z.uuid("Item inválido.") });
export type ShopPurchaseInput = z.output<typeof shopPurchaseSchema>;

export const shopOrderListQuerySchema = z.object({
  status: z.array(z.enum(SHOP_ORDER_STATUSES)).nonempty().optional(),
  userId: z.uuid("Usuário inválido.").optional(),
});
export type ShopOrderListQuery = z.output<typeof shopOrderListQuerySchema>;

/** Query string (`?status=reserved&status=claimed`) → filtros; valor desconhecido vira 400, nunca ignorado. */
export function parseShopOrderListQuery(query: Record<string, unknown>): { ok: true; filters: ShopOrderListQuery } | { ok: false; error: string } {
  const raw = query.status;
  const status = raw === undefined ? undefined : Array.isArray(raw) ? raw : [raw];
  const parsed = shopOrderListQuerySchema.safeParse({ ...(status ? { status } : {}), ...(query.userId ? { userId: query.userId } : {}) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Filtro inválido." };
  return { ok: true, filters: parsed.data };
}

/** Item como a API devolve. Preço em string (Q20); `stock` null = ilimitado. */
export interface ShopItemDto {
  id: string;
  name: string;
  description: string | null;
  price: string;
  stock: number | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Pedido como a API devolve. Preço **congelado** na compra: mudar o preço do item não reescreve o pedido. */
export interface ShopOrderDto {
  id: string;
  userId: string;
  /** Nick do dono quando a lista é da staff; null na visão do próprio membro. */
  userNick: string | null;
  itemId: string;
  /** Nome do item no instante da compra: o pedido continua legível mesmo se o item for renomeado. */
  itemName: string;
  price: string;
  status: ShopOrderStatus;
  /** Débito criado na entrega (TASK-060); null enquanto o pedido só reserva. */
  ledgerEntryId: string | null;
  /** Estorno do débito acima (F6-19); null quando o pedido nunca foi estornado. */
  reversalEntryId: string | null;
  handledByUserId: string | null;
  /** Nick de quem pegou/entregou/encerrou o pedido, quando a lista é da staff. */
  handledByNick: string | null;
  handledAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Pedido entregue e já estornado: a Buffunfa voltou e o item voltou pro estoque (F6-19). */
export const isRefundedShopOrder = (order: Pick<ShopOrderDto, "reversalEntryId">): boolean => order.reversalEntryId !== null;

/**
 * A fila que a staff trabalha (AC#8), no molde de `WithdrawalQueueResponse`: a lista inteira numa
 * chamada, para o contador de cada aba e o do menu lerem sempre o mesmo número.
 */
export interface ShopOrderQueueResponse {
  orders: ShopOrderDto[];
}

/** Saldo de Buffunfa do membro na loja: o que ele tem, o que já está preso em pedidos e o que dá pra gastar. */
export interface ShopBalanceDto {
  balance: string;
  /** Soma dos pedidos `reserved` (AC#5). */
  reserved: string;
  /** `balance - reserved`: teto de uma compra nova. */
  available: string;
}

/** O que a tela da loja desenha numa chamada só: catálogo + saldo + meus pedidos. */
export interface ShopCatalogResponse {
  items: ShopItemDto[];
  balance: ShopBalanceDto;
  orders: ShopOrderDto[];
}

/** Item esgotado: tem controle de estoque e ele zerou. Continua **na lista**, marcado (F6-18). */
export const isSoldOut = (item: Pick<ShopItemDto, "stock">): boolean => item.stock !== null && item.stock <= 0;

export type ShopPurchaseRefusal =
  /** Item despublicado entre a tela e o clique. */
  | { reason: "unavailable" }
  /** Estoque acabou (AC#4). */
  | { reason: "sold_out" }
  /** Buffunfa insuficiente (AC#4, F6-7: saldo nunca fica negativo por compra). */
  | { reason: "insufficient"; available: bigint; price: bigint };

/**
 * Decide se uma compra pode nascer. Pura de propósito, como no saque: o repo chama isto **dentro** da
 * transação, com os números já lidos sob trava (AC#4), e o painel chama com os números da tela para
 * desabilitar o botão antes do clique. As duas pontas nunca divergem porque a regra é uma só.
 */
export function checkShopPurchase(item: { price: bigint; stock: number | null; published: boolean }, balance: bigint, reserved: bigint): ShopPurchaseRefusal | null {
  if (!item.published) return { reason: "unavailable" };
  if (item.stock !== null && item.stock <= 0) return { reason: "sold_out" };
  const available = balance - reserved;
  if (item.price > available) return { reason: "insufficient", available, price: item.price };
  return null;
}

/** Mensagem PT-BR da recusa, uma só para API, painel e bot. */
export function shopRefusalMessage(refusal: ShopPurchaseRefusal): string {
  switch (refusal.reason) {
    case "unavailable":
      return "Esse item saiu da loja. Atualize a página para ver o catálogo de agora.";
    case "sold_out":
      return "Esse item esgotou. Ele continua na lista e volta quando a staff repuser o estoque.";
    case "insufficient": {
      const missing = refusal.price - refusal.available;
      return `Faltam ${formatAmount(missing, SHOP_CURRENCY)} para esse item. Você tem ${formatAmount(refusal.available, SHOP_CURRENCY)} disponível; pedidos aguardando entrega já estão descontados daqui.`;
    }
  }
}
