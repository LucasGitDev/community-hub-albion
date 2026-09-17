import { escapeLike, type MemberFilter, type Role } from "@albion-hub/shared";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client.js";
import { alias } from "drizzle-orm/pg-core";
import { memberNick } from "./member-nick.js";
import { roleEnum, userRoles, users } from "./schema.js";

/** Uma linha da tabela de membros do admin (TASK-043, AC#1/AC#2). */
export interface AdminMember {
  id: string;
  discordId: string;
  discordUsername: string;
  displayName: string | null;
  gameNick: string | null;
  guildTag: string | null;
  roles: Role[];
  createdAt: Date;
  /** Última conferência do nick na API do Albion (TASK-042). `status` null = nunca conferido. */
  albion: { status: string | null; playerId: string | null; guildName: string | null; checkedAt: Date | null };
  /** Banimento vigente (TASK-050). `null` = conta ativa. A conta banida continua na lista, marcada. */
  ban: { bannedAt: Date; reason: string; byName: string | null } | null;
  /**
   * Saída do servidor do Discord marcada pela limpeza diária (TASK-049). `null` = está no servidor.
   * Marca independente do banimento: uma conta pode ter as duas, e nenhuma apaga a outra.
   */
  leftGuildAt: Date | null;
}

export interface AdminMembersQuery {
  /** Busca já normalizada (minúscula, sem espaço nas pontas); null = sem busca. */
  search: string | null;
  filter: MemberFilter;
  pageSize: number;
  offset: number;
}

export interface AdminMembersPage {
  members: AdminMember[];
  /** Total de membros no filtro atual (com a busca aplicada): é o que a paginação usa. */
  total: number;
  /** Contagem de cada chip com a busca aplicada e sem o filtro, para o admin ver o que ganha ao trocar de chip. */
  counts: { todos: number; nao_encontrados: number; sem_nick: number; banidos: number };
}

/** Autor do banimento, para mostrar "banido por" sem uma consulta por linha (TASK-050). */
const bannedBy = alias(users, "banned_by_user");

/** Nick vazio no banco conta como "sem nick" igual a null: quem importou sem apelido não fica escondido. */
const withoutNick = () => or(isNull(users.gameNick), eq(users.gameNick, ""));

/**
 * Busca por nick do Albion ou usuário do Discord (AC#4). `lower(col) like '%termo%' escape '\'`:
 * o termo chega minúsculo e escapado, então `%` e `_` digitados pelo admin são procurados como texto.
 */
function searchCondition(search: string): SQL {
  const pattern = `%${escapeLike(search)}%`;
  return sql`(lower(${users.gameNick}) like ${pattern} escape '\\' or lower(${users.discordUsername}) like ${pattern} escape '\\')`;
}

const filterCondition = (filter: MemberFilter): SQL | undefined =>
  filter === "nao_encontrados"
    ? eq(users.albionStatus, "not_found")
    : filter === "sem_nick"
      ? withoutNick()
      : filter === "banidos"
        ? isNotNull(users.bannedAt)
        : undefined;

/**
 * Página da lista de membros do admin, com total e contagem por chip.
 *
 * Três idas ao banco, nunca uma por membro: (1) contagens agregadas com `filter (where ...)`,
 * (2) a página de usuários, (3) os papéis só dos usuários da página. Ordena por nick (quem não tem
 * nick usa o usuário do Discord), que é como o admin procura gente na lista.
 */
export async function listAdminMembers(db: Database, query: AdminMembersQuery): Promise<AdminMembersPage> {
  const search = query.search ? searchCondition(query.search) : undefined;
  const notFound = eq(users.albionStatus, "not_found");

  const [counts] = await db
    .select({
      todos: sql<number>`count(*)::int`,
      nao_encontrados: sql<number>`count(*) filter (where ${notFound})::int`,
      sem_nick: sql<number>`count(*) filter (where ${withoutNick()})::int`,
      banidos: sql<number>`count(*) filter (where ${isNotNull(users.bannedAt)})::int`,
    })
    .from(users)
    .where(search);

  const page = counts ?? { todos: 0, nao_encontrados: 0, sem_nick: 0, banidos: 0 };
  const total = page[query.filter];
  if (total === 0) return { members: [], total, counts: page };

  const rows = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      discordUsername: users.discordUsername,
      displayName: users.displayName,
      gameNick: users.gameNick,
      guildTag: users.guildTag,
      createdAt: users.createdAt,
      albionStatus: users.albionStatus,
      albionPlayerId: users.albionPlayerId,
      albionGuildName: users.albionGuildName,
      albionCheckedAt: users.albionCheckedAt,
      bannedAt: users.bannedAt,
      banReason: users.banReason,
      leftGuildAt: users.leftGuildAt,
      bannedByName: sql<string | null>`coalesce(${bannedBy.displayName}, ${bannedBy.discordUsername})`,
    })
    .from(users)
    .leftJoin(bannedBy, eq(bannedBy.id, users.bannedBy))
    .where(and(search, filterCondition(query.filter)))
    .orderBy(asc(sql`lower(coalesce(${users.gameNick}, ${users.discordUsername}))`), asc(users.id))
    .limit(query.pageSize)
    .offset(query.offset);

  const ids = rows.map((r) => r.id);
  const roleRows = ids.length > 0 ? await db.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles).where(inArray(userRoles.userId, ids)) : [];
  const order = roleEnum.enumValues;
  const rolesByUser = new Map<string, Role[]>();
  for (const { userId, role } of roleRows) rolesByUser.set(userId, [...(rolesByUser.get(userId) ?? []), role]);

  const members = rows.map(({ albionStatus, albionPlayerId, albionGuildName, albionCheckedAt, bannedAt, banReason, bannedByName, ...user }) => ({
    ...user,
    roles: (rolesByUser.get(user.id) ?? []).sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    albion: { status: albionStatus, playerId: albionPlayerId, guildName: albionGuildName, checkedAt: albionCheckedAt },
    ban: bannedAt ? { bannedAt, reason: banReason ?? "", byName: bannedByName } : null,
  }));

  return { members, total, counts: page };
}

/** Dados do membro que a edição precisa ver antes de gravar (TASK-045). null = usuário não existe. */
export interface AdminMemberProfile {
  id: string;
  gameNick: string | null;
  guildTag: string | null;
  /** Como o painel chama essa pessoa: nick aprovado e, na falta dele, o nome do Discord (TASK-023). */
  name: string;
}

export async function getAdminMemberProfile(db: Database, userId: string): Promise<AdminMemberProfile | null> {
  const [row] = await db
    .select({ id: users.id, gameNick: users.gameNick, guildTag: users.guildTag, name: memberNick(users) })
    .from(users)
    .where(eq(users.id, userId));
  return row ? { ...row, name: row.name ?? "sem nome" } : null;
}

export interface UpdateMemberProfileInput {
  /** Nick já validado (`validateNick`); nunca vazio: apagar o nick de alguém não é uma edição, é outra coisa. */
  nick: string;
  /** Tag já validada (`validateGuildTag`); null = sem guilda. */
  guildTag: string | null;
}

/** `before` é só o que a edição compara (nick e tag); o nome de exibição não entra na comparação. */
export type UpdateMemberProfileResult = { ok: true; before: Omit<AdminMemberProfile, "name"> } | { ok: false; reason: "not_found" | "nick_taken" };

/**
 * Edição do nick e da tag pela staff/admin (TASK-045, AC#2).
 *
 * Uma transação com a linha travada (`for update`): o valor "antes" que volta daqui é o que vira a nota de
 * auditoria, então ele precisa ser o estado real no momento da escrita — duas edições simultâneas não podem
 * gravar a mesma origem. O nick é conferido sem caixa contra os outros usuários (Q14: unicidade é por nick,
 * e `Erijj` e `erijj` são a mesma pessoa no jogo), com a própria linha fora da comparação.
 *
 * O status do Albion é zerado quando o nick muda: a conferência antiga era de outro personagem, e deixar
 * "Encontrado" ali mentiria para quem lê a lista. A revalidação é uma ação explícita (AC#1).
 */
export async function updateMemberProfile(db: Database, userId: string, input: UpdateMemberProfileInput): Promise<UpdateMemberProfileResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ id: users.id, gameNick: users.gameNick, guildTag: users.guildTag }).from(users).where(eq(users.id, userId)).for("update");
    if (!before) return { ok: false, reason: "not_found" };

    const [clash] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.gameNick}) = ${input.nick.toLowerCase()}`, sql`${users.id} <> ${userId}`))
      .limit(1);
    if (clash) return { ok: false, reason: "nick_taken" };

    const nickChanged = (before.gameNick ?? "").toLowerCase() !== input.nick.toLowerCase();
    await tx
      .update(users)
      .set({
        gameNick: input.nick,
        guildTag: input.guildTag,
        updatedAt: sql`now()`,
        ...(nickChanged ? { albionStatus: null, albionPlayerId: null, albionGuildName: null, albionCheckedAt: null } : {}),
      })
      .where(eq(users.id, userId));
    return { ok: true, before };
  });
}
