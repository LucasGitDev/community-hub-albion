import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { nickRequests, users } from "./schema.js";

export type NickRequest = typeof nickRequests.$inferSelect;

export interface NickStatus {
  /** Nick vigente (aprovado); null se nunca aprovado. */
  gameNick: string | null;
  pending: NickRequest | null;
}

/** Nick vigente e solicitação pendente do usuário (GET /api/me/nick). */
export async function getNickStatus(db: Database, userId: string): Promise<NickStatus> {
  const [user] = await db.select({ gameNick: users.gameNick }).from(users).where(eq(users.id, userId));
  const [pending] = await db
    .select()
    .from(nickRequests)
    .where(and(eq(nickRequests.userId, userId), eq(nickRequests.status, "pending")))
    .orderBy(desc(nickRequests.createdAt))
    .limit(1);
  return { gameNick: user?.gameNick ?? null, pending: pending ?? null };
}

/**
 * Cria a solicitação pendente ou, se já existe uma, troca o nick dela (AC#2: uma pendente por usuário).
 * Upsert atômico no índice único parcial: duas requisições simultâneas nunca geram duas pendentes.
 * Não toca `users.game_nick`: nick vigente e acesso ficam até a staff aprovar (Q31).
 */
export async function requestNick(db: Database, userId: string, nick: string): Promise<{ request: NickRequest; created: boolean }> {
  const [row] = await db
    .insert(nickRequests)
    .values({ userId, nick })
    .onConflictDoUpdate({
      target: nickRequests.userId,
      targetWhere: sql`${nickRequests.status} = 'pending'`,
      set: { nick, updatedAt: sql`now()` },
    })
    // xmax = 0 só em linha recém-inserida (no upsert que atualiza, xmax é o id da transação).
    .returning({ ...getTableColumns(nickRequests), inserted: sql<boolean>`(xmax = 0)` });
  const { inserted, ...request } = row!;
  return { request, created: inserted };
}

/** Fila da staff (TASK-013): pendentes, mais antigas primeiro, com o usuário. */
export async function listPendingNickRequests(db: Database) {
  return db
    .select({
      request: nickRequests,
      user: { id: users.id, discordId: users.discordId, discordUsername: users.discordUsername, displayName: users.displayName, gameNick: users.gameNick },
    })
    .from(nickRequests)
    .innerJoin(users, eq(users.id, nickRequests.userId))
    .where(eq(nickRequests.status, "pending"))
    .orderBy(asc(nickRequests.createdAt));
}

/** Grava o nick vigente sem passar pela fila (seed de dev/e2e). Aprovação real é da TASK-013. */
export async function setGameNick(db: Database, userId: string, gameNick: string | null): Promise<void> {
  await db.update(users).set({ gameNick, updatedAt: sql`now()` }).where(eq(users.id, userId));
}
