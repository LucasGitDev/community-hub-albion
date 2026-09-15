import type { Role } from "@albion-hub/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { roleEnum, userRoles, users } from "./schema.js";

export interface UserWithRoles {
  id: string;
  discordId: string;
  discordUsername: string;
  displayName: string | null;
  avatar: string | null;
  roles: Role[];
}

/** Usuários com papéis (gestão de papéis, TASK-011). Ordem: nome exibido. */
export async function listUsersWithRoles(db: Database): Promise<UserWithRoles[]> {
  const rows = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      discordUsername: users.discordUsername,
      displayName: users.displayName,
      avatar: users.avatar,
      role: userRoles.role,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .orderBy(asc(users.discordUsername));
  const order = roleEnum.enumValues;
  const byId = new Map<string, UserWithRoles>();
  for (const { role, ...user } of rows) {
    const entry = byId.get(user.id) ?? { ...user, roles: [] };
    if (role) entry.roles.push(role);
    byId.set(user.id, entry);
  }
  return [...byId.values()].map((u) => ({ ...u, roles: u.roles.sort((a, b) => order.indexOf(a) - order.indexOf(b)) }));
}

export type RevokeRoleResult = "revoked" | "not_granted" | "last_admin";

/**
 * Remove papel sem nunca deixar a comunidade sem admin. Trava as linhas de admin
 * (FOR UPDATE) dentro da transação: duas remoções concorrentes não passam as duas.
 */
export async function revokeRoleGuarded(db: Database, userId: string, role: Role): Promise<RevokeRoleResult> {
  return db.transaction(async (tx) => {
    if (role === "admin") {
      const admins = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, "admin")).for("update");
      const isAdmin = admins.some((a) => a.userId === userId);
      if (!isAdmin) return "not_granted";
      if (admins.length <= 1) return "last_admin";
    }
    const deleted = await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
      .returning({ role: userRoles.role });
    return deleted.length > 0 ? "revoked" : "not_granted";
  });
}

export async function userExists(db: Database, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  return Boolean(row);
}
