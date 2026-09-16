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
  | "settle";

/** Campos de dono por tipo de recurso (condições das regras). */
interface SubjectFields {
  Wallet: { userId: string };
  Withdrawal: { userId: string };
  Event: { ownerId: string };
  EventTemplate: Record<never, never>;
  LootSplit: Record<never, never>;
  MemberRequest: { userId: string };
  UserRole: Record<never, never>;
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
  }

  if (roles.has("admin")) {
    // Admin gerencia tudo, inclusive papéis (TASK-011).
    can("manage", "all");
  }

  return build();
}

/** Marca um objeto com o tipo de subject pra checar condições (ex: dono do evento). */
export const asSubject = <K extends keyof SubjectFields>(type: K, record: SubjectFields[K]) => caslSubject(type, { ...record });
