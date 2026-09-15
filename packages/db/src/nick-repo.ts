import { and, asc, desc, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { nickRequests, users } from "./schema.js";

export type NickRequest = typeof nickRequests.$inferSelect;

export interface NickStatus {
  /** Nick vigente (aprovado); null se nunca aprovado. */
  gameNick: string | null;
  pending: NickRequest | null;
  /** Última decisão, se foi recusa (motivo aparece pro membro em /nick, TASK-013). */
  lastRejected: NickRequest | null;
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
  const [lastDecided] = await db
    .select()
    .from(nickRequests)
    .where(and(eq(nickRequests.userId, userId), isNotNull(nickRequests.decidedAt)))
    .orderBy(desc(nickRequests.decidedAt))
    .limit(1);
  return { gameNick: user?.gameNick ?? null, pending: pending ?? null, lastRejected: lastDecided?.status === "rejected" ? lastDecided : null };
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

export type NickDecision = "approved" | "rejected";

export interface DecideNickRequestInput {
  requestId: string;
  decision: NickDecision;
  deciderUserId: string;
  note: string | null;
}

export type DecideNickRequestResult =
  | { ok: true; request: NickRequest; previousGameNick: string | null }
  | { ok: false; reason: "not_found" | "not_pending" };

/**
 * Decisão da staff (TASK-013). Uma transação: UPDATE condicional `status = 'pending'` (só uma decisão vence,
 * mesmo concorrente) + auditoria (decided_by/at/note). Aprovar grava `users.game_nick`; recusar não toca o nick vigente.
 */
export async function decideNickRequest(db: Database, input: DecideNickRequestInput): Promise<DecideNickRequestResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .update(nickRequests)
      .set({ status: input.decision, decidedAt: sql`now()`, decidedBy: input.deciderUserId, decisionNote: input.note, updatedAt: sql`now()` })
      .where(and(eq(nickRequests.id, input.requestId), eq(nickRequests.status, "pending")))
      .returning();
    if (!request) {
      const [exists] = await tx.select({ id: nickRequests.id }).from(nickRequests).where(eq(nickRequests.id, input.requestId));
      return { ok: false, reason: exists ? "not_pending" : "not_found" };
    }
    const [user] = await tx.select({ gameNick: users.gameNick }).from(users).where(eq(users.id, request.userId)).for("update");
    const previousGameNick = user?.gameNick ?? null;
    if (input.decision === "approved") await tx.update(users).set({ gameNick: request.nick, updatedAt: sql`now()` }).where(eq(users.id, request.userId));
    return { ok: true, request, previousGameNick };
  });
}
