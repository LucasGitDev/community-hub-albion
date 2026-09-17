import { AbilityBuilder, createMongoAbility, subject as caslSubject, type ForcedSubject, type MongoAbility } from "@casl/ability";
import type { Role } from "./roles.js";

/**
 * Permissões granulares da v1 (Q13), seed em código. Mesmo arquivo usado pela API (guard)
 * e pelo painel (esconder/mostrar áreas, TASK-010). Papéis se somam: usuário com
 * member + caller tem a união das regras.
 */
export type Action =
  | "manage"
  | "read"
  | "create"
  | "update"
  | "delete"
  | "join"
  | "start"
  | "finish"
  | "cancel"
  /** Fechar o evento de vez depois de finalizado (TASK-044, Q26): nada mais é editável. */
  | "archive"
  | "distribute"
  | "approve"
  | "reject"
  | "settle"
  /** Banir e desbanir jogador (TASK-050): corta o acesso na hora, sem apagar a conta. */
  | "ban"
  /** Entregar o pedido da loja (`shop:fulfill`, F6-25). A entrega em si é a TASK-060. */
  | "fulfill";

/** Campos de dono por tipo de recurso (condições das regras). */
interface SubjectFields {
  Wallet: { userId: string };
  Withdrawal: { userId: string };
  Event: { ownerId: string };
  EventTemplate: Record<never, never>;
  LootSplit: Record<never, never>;
  MemberRequest: { userId: string };
  UserRole: Record<never, never>;
  /** Banimento de um jogador (TASK-050). Subject próprio: banir não é "editar papel". */
  Ban: Record<never, never>;
  /**
   * Ficha do membro no painel (TASK-047): nick, tag de guilda, notas internas e a revalidação na API
   * do Albion. Subject separado de `UserRole` de propósito — `UserRole` é conceder e revogar papel, a
   * porta que cria outro admin, e continua só do admin.
   */
  MemberProfile: Record<never, never>;
  /** Item do catálogo da loja (TASK-059). Quem publica e precifica é `shop:manage` (F6-25). */
  ShopItem: Record<never, never>;
  /** Pedido da loja. O dono é quem comprou: o membro lê o próprio, a staff lê e entrega qualquer um. */
  ShopOrder: { userId: string };
}

export type SubjectType = keyof SubjectFields | "all";

type Subjects = { [K in keyof SubjectFields]: K | (ForcedSubject<K> & SubjectFields[K]) }[keyof SubjectFields] | "all";

export type AppAbility = MongoAbility<[Action, Subjects]>;

export interface AbilityUser {
  id: string;
  roles: readonly Role[];
}

export function defineAbilityFor(user: AbilityUser): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const roles = new Set(user.roles);
  const own = { userId: user.id };

  if (roles.size > 0) {
    // member: própria carteira, pedir e acompanhar os próprios saques (Q3), ver e entrar em eventos.
    can("read", "Wallet", own);
    can("create", "Withdrawal");
    can("read", "Withdrawal", own);
    can(["read", "join"], "Event");
    // Entrada/troca de nick (TASK-012, Q14/Q31): pede e acompanha só a própria solicitação.
    can("create", "MemberRequest");
    can("read", "MemberRequest", own);
    // Loja (TASK-059): qualquer membro vê o catálogo e compra; pedido, só o próprio.
    can("read", "ShopItem");
    can("create", "ShopOrder");
    can("read", "ShopOrder", own);
    // Desistir do próprio pedido (F6-24). Só vale enquanto ninguém da staff pegou — quem decide isso é a
    // regra da fila (`canOwnerCancelShopOrder`), dentro da transação; o CASL só diz "é seu pedido".
    can("cancel", "ShopOrder", own);
  }

  if (roles.has("caller")) {
    // Só callers criam evento (Q9); conduzem e distribuem os próprios (owner, Q21).
    can("create", "Event");
    can(["update", "start", "finish", "cancel", "archive", "distribute"], "Event", { ownerId: user.id });
    can("read", ["EventTemplate", "LootSplit"]);
  }

  if (roles.has("staff")) {
    // Staff intervém em qualquer evento, distribui (event:distribute), cuida de saques e entrada de membros.
    can("manage", ["Event", "EventTemplate", "LootSplit", "MemberRequest"]);
    can("read", ["Wallet", "Withdrawal"]);
    can(["approve", "reject", "settle"], "Withdrawal");
    // Banir e desbanir jogador (TASK-050). Provisório na staff até a revisão de papéis (TASK-052).
    can("ban", "Ban");
    // Gestão de usuários (TASK-047, G3): achar e revalidar o nick, editar nick/tag, ler e escrever notas.
    // PROVISÓRIO: é um degrau, não o destino. Hoje "staff" é um papel que carrega um pacote fixo de poderes,
    // e a gestão de usuários entrou nesse pacote inteiro porque não existe granularidade menor. A TASK-052
    // separa permissão de papel; quando ela chegar, estas capacidades viram permissões atribuíveis uma a uma
    // e esta linha sai daqui. Não use este `manage` como argumento de que "staff pode tudo em membro":
    // conceder papel (`UserRole`) segue fora, e banir staff/admin segue só do admin (TASK-050).
    can("manage", "MemberProfile");
    /**
     * Loja (F6-25): `shop:manage` é publicar/precificar/despublicar o item; `shop:fulfill` é entregar o
     * pedido (TASK-060). As duas ficam no bloco `staff` e são **provisórias**, com os nomes já registrados
     * em `SHOP_CAPABILITIES` para a F7 — quando ela chegar, viram permissões atribuíveis uma a uma.
     */
    can("manage", "ShopItem");
    // `fulfill` é pegar, entregar, recusar e estornar; `cancel` é encerrar o pedido pelo membro depois de
    // `claimed`, quando ele já não pode mais (F6-24).
    can(["read", "fulfill", "cancel"], "ShopOrder");
  }

  if (roles.has("admin")) {
    // Admin gerencia tudo, inclusive papéis (TASK-011).
    can("manage", "all");
  }

  return build();
}

/** Marca um objeto com o tipo de subject pra checar condições (ex: dono do evento). */
export const asSubject = <K extends keyof SubjectFields>(type: K, record: SubjectFields[K]) => caslSubject(type, { ...record });
