import { escapeLike, type MemberFilter, type Role } from "@albion-hub/shared";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client.js";
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
  counts: { todos: number; nao_encontrados: number; sem_nick: number };
}

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
  filter === "nao_encontrados" ? eq(users.albionStatus, "not_found") : filter === "sem_nick" ? withoutNick() : undefined;

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
    })
    .from(users)
    .where(search);

  const page = counts ?? { todos: 0, nao_encontrados: 0, sem_nick: 0 };
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
    })
    .from(users)
    .where(and(search, filterCondition(query.filter)))
    .orderBy(asc(sql`lower(coalesce(${users.gameNick}, ${users.discordUsername}))`), asc(users.id))
    .limit(query.pageSize)
    .offset(query.offset);

  const ids = rows.map((r) => r.id);
  const roleRows = ids.length > 0 ? await db.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles).where(inArray(userRoles.userId, ids)) : [];
  const order = roleEnum.enumValues;
  const rolesByUser = new Map<string, Role[]>();
  for (const { userId, role } of roleRows) rolesByUser.set(userId, [...(rolesByUser.get(userId) ?? []), role]);

  const members = rows.map(({ albionStatus, albionPlayerId, albionGuildName, albionCheckedAt, ...user }) => ({
    ...user,
    roles: (rolesByUser.get(user.id) ?? []).sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    albion: { status: albionStatus, playerId: albionPlayerId, guildName: albionGuildName, checkedAt: albionCheckedAt },
  }));

  return { members, total, counts: page };
}
