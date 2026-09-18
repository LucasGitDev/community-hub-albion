import type { Role } from "@albion-hub/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { roleEnum, sessions, userRoles, users } from "./schema.js";
import { generateSessionToken, hashSessionToken } from "./session-token.js";

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export interface DiscordProfile {
  discordId: string;
  discordUsername: string;
  displayName?: string | null;
  avatar?: string | null;
}

/** Cria ou atualiza o usuário pelo id Discord (login OAuth, TASK-008). */
export async function upsertUserByDiscordId(db: Database, profile: DiscordProfile): Promise<User> {
  const values = {
    discordId: profile.discordId,
    discordUsername: profile.discordUsername,
    displayName: profile.displayName ?? null,
    avatar: profile.avatar ?? null,
  };
  const [user] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.discordId,
      set: { discordUsername: values.discordUsername, displayName: values.displayName, avatar: values.avatar, updatedAt: sql`now()` },
    })
    .returning();
  return user!;
}

/** Id Discord do usuário (bot aplica apelido/cargo, TASK-014); null se não existe. */
export async function findDiscordIdByUserId(db: Database, userId: string): Promise<string | null> {
  const [row] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
  return row?.discordId ?? null;
}

/** Id do usuário do painel pelo id Discord (botões do embed da staff, TASK-015); null se nunca logou. */
export async function findUserIdByDiscordId(db: Database, discordId: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordId));
  return row?.id ?? null;
}

/**
 * Concede papel; idempotente (papel já existente não altera nada). Retorna true só quando o papel é novo:
 * a timeline (TASK-077) publica a concessão que de fato aconteceu, não o clique repetido.
 */
export async function grantRole(db: Database, userId: string, role: Role, grantedBy: string | null = null): Promise<boolean> {
  const rows = await db.insert(userRoles).values({ userId, role, grantedBy }).onConflictDoNothing().returning({ role: userRoles.role });
  return rows.length > 0;
}

/** Remove papel; retorna true se havia o papel. */
export async function revokeRole(db: Database, userId: string, role: Role): Promise<boolean> {
  const rows = await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
    .returning({ role: userRoles.role });
  return rows.length > 0;
}

/** Papéis do usuário na ordem do enum (member, caller, staff, admin). */
export async function listRoles(db: Database, userId: string): Promise<Role[]> {
  const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  const order = roleEnum.enumValues;
  return rows.map((r) => r.role).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Cria sessão e devolve o token em claro (só para o cookie; o banco guarda o hash). */
export async function createSession(db: Database, userId: string, expiresAt: Date): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const [session] = await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt }).returning();
  return { token, session: session! };
}

/** Sessão válida (não expirada) pelo token do cookie, com o usuário. Atualiza `last_seen_at`. */
export async function findValidSession(db: Database, token: string, now: Date = new Date()): Promise<{ session: Session; user: User } | null> {
  if (!token) return null;
  const [row] = await db
    .update(sessions)
    .set({ lastSeenAt: now })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, now)))
    .returning();
  if (!row) return null;
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  return user ? { session: row, user } : null;
}

/** Revoga a sessão do token (logout). Retorna true se existia. */
export async function revokeSession(db: Database, token: string): Promise<boolean> {
  if (!token) return false;
  const rows = await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).returning({ id: sessions.id });
  return rows.length > 0;
}
