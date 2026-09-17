import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import { sessions, userRoles, users } from "./schema.js";

/**
 * Banimento de jogador (TASK-050). Soft delete: a conta continua na lista, marcada, com motivo,
 * autor e data. O nick continua ocupado e o extrato fica intacto — nenhum lançamento é criado aqui,
 * nem no banir nem no desbanir (Q24/Q25: ledger é append-only e não se mexe por moderação).
 *
 * Banir é escalada de privilégio se malfeito, então as recusas moram no banco, dentro de uma
 * transação, e não só no controller: quem chamar de outro lugar herda as mesmas travas.
 */

export interface BanStatus {
  bannedAt: Date;
  banReason: string;
  bannedBy: string | null;
}

export interface BanUserInput {
  userId: string;
  actorId: string;
  reason: string;
}

export type BanUserResult =
  | { ok: true; discordId: string; sessionsRevoked: number }
  | { ok: false; reason: "not_found" | "already_banned" | "self" | "last_admin" };

/**
 * Bane e corta o acesso na mesma transação: marca a conta e apaga **todas** as sessões dela, para
 * não esperar o próximo login nem uma varredura diária. Trava as linhas de admin (FOR UPDATE) como
 * `revokeRoleGuarded`: dois banimentos concorrentes não podem deixar a comunidade sem admin.
 */
export async function banUser(db: Database, input: BanUserInput): Promise<BanUserResult> {
  const { userId, actorId, reason } = input;
  // Auto-banimento é sempre engano ou pegadinha: quem quer sair não precisa se banir.
  if (userId === actorId) return { ok: false, reason: "self" };
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, discordId: users.discordId, bannedAt: users.bannedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!target) return { ok: false, reason: "not_found" };
    if (target.bannedAt) return { ok: false, reason: "already_banned" };

    // Admin ativo (não banido) que sobraria depois deste banimento.
    const admins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.role, "admin"), isNull(users.bannedAt)))
      .for("update", { of: userRoles });
    if (admins.some((a) => a.userId === userId) && admins.length <= 1) return { ok: false, reason: "last_admin" };

    await tx.update(users).set({ bannedAt: new Date(), bannedBy: actorId, banReason: reason, updatedAt: new Date() }).where(eq(users.id, userId));
    const revoked = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    return { ok: true, discordId: target.discordId, sessionsRevoked: revoked.length };
  });
}

export type UnbanUserResult = { ok: true; discordId: string } | { ok: false; reason: "not_found" | "not_banned" };

/**
 * Único caminho de volta. Não recria sessão: o desbanido entra de novo pelo login normal, e assim
 * "voltar a ter acesso" é sempre um login registrado, nunca uma sessão ressuscitada.
 */
export async function unbanUser(db: Database, userId: string): Promise<UnbanUserResult> {
  const [row] = await db
    .update(users)
    .set({ bannedAt: null, bannedBy: null, banReason: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNotNull(users.bannedAt)))
    .returning({ discordId: users.discordId });
  if (row) return { ok: true, discordId: row.discordId };
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  return { ok: false, reason: exists ? "not_banned" : "not_found" };
}

/** Estado de banimento por id interno. `null` = conta ativa (ou inexistente). */
export async function getBanStatus(db: Database, userId: string): Promise<BanStatus | null> {
  const [row] = await db.select({ bannedAt: users.bannedAt, banReason: users.banReason, bannedBy: users.bannedBy }).from(users).where(eq(users.id, userId));
  if (!row?.bannedAt) return null;
  return { bannedAt: row.bannedAt, banReason: row.banReason ?? "", bannedBy: row.bannedBy };
}

/**
 * Estado de banimento pelo snowflake do Discord, para o bot recusar **antes** de criar conta:
 * quem está banido não pode virar um usuário novo só por clicar no botão de inscrição.
 */
export async function getBanStatusByDiscordId(db: Database, discordId: string): Promise<BanStatus | null> {
  const [row] = await db
    .select({ bannedAt: users.bannedAt, banReason: users.banReason, bannedBy: users.bannedBy })
    .from(users)
    .where(and(eq(users.discordId, discordId), isNotNull(users.bannedAt)));
  if (!row?.bannedAt) return null;
  return { bannedAt: row.bannedAt, banReason: row.banReason ?? "", bannedBy: row.bannedBy };
}

/** Só para teste/diagnóstico: quantos admins ativos existem além de um dado usuário. */
export async function countOtherActiveAdmins(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "admin"), isNull(users.bannedAt), ne(userRoles.userId, userId)));
  return rows.length;
}
