import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { voiceSessions } from "./schema.js";

export type VoiceSession = typeof voiceSessions.$inferSelect;

export interface OpenVoiceSessionInput {
  discordUserId: string;
  guildId?: string | null;
  channelId: string;
  at: Date;
}

type Executor = Pick<Database, "update">;

function closeOpen(db: Executor, discordUserId: string, at: Date) {
  // greatest(): nunca fecha antes do início (respeita o check ended_at >= started_at).
  return db
    .update(voiceSessions)
    .set({ endedAt: sql`greatest(${voiceSessions.startedAt}, ${at.toISOString()}::timestamptz)`, updatedAt: sql`now()` })
    .where(and(eq(voiceSessions.discordUserId, discordUserId), isNull(voiceSessions.endedAt)))
    .returning();
}

/**
 * Abre sessão de voz. Fecha em `at` a sessão aberta anterior do usuário na mesma transação,
 * então troca de canal é atômica e nunca há duas abertas (TASK-018).
 */
export async function openVoiceSession(db: Database, input: OpenVoiceSessionInput): Promise<VoiceSession> {
  return db.transaction(async (tx) => {
    await closeOpen(tx, input.discordUserId, input.at);
    const [row] = await tx
      .insert(voiceSessions)
      .values({
        discordUserId: input.discordUserId,
        guildId: input.guildId ?? null,
        channelId: input.channelId,
        startedAt: input.at,
        lastHeartbeatAt: input.at,
      })
      .returning();
    return row!;
  });
}

/** Fecha a sessão aberta do usuário em `at`. Retorna a sessão fechada ou null se não havia. */
export async function closeVoiceSession(db: Database, discordUserId: string, at: Date): Promise<VoiceSession | null> {
  const [row] = await closeOpen(db, discordUserId, at);
  return row ?? null;
}

/** Sessões abertas (todas, ou só do usuário), ordenadas por início. */
export async function listOpenVoiceSessions(db: Database, discordUserId?: string): Promise<VoiceSession[]> {
  const open = isNull(voiceSessions.endedAt);
  return db
    .select()
    .from(voiceSessions)
    .where(discordUserId === undefined ? open : and(open, eq(voiceSessions.discordUserId, discordUserId)))
    .orderBy(asc(voiceSessions.startedAt));
}

/** Atualiza `last_heartbeat_at` de todas as sessões abertas (sem retroceder). Retorna quantas. */
export async function touchHeartbeat(db: Database, at: Date): Promise<number> {
  const rows = await db
    .update(voiceSessions)
    .set({ lastHeartbeatAt: sql`greatest(${voiceSessions.lastHeartbeatAt}, ${at.toISOString()}::timestamptz)`, updatedAt: sql`now()` })
    .where(isNull(voiceSessions.endedAt))
    .returning({ id: voiceSessions.id });
  return rows.length;
}

/** Reconciliação no boot (TASK-019): fecha toda sessão aberta no último heartbeat conhecido. */
export async function closeStaleSessionsAtHeartbeat(db: Database): Promise<number> {
  const rows = await db
    .update(voiceSessions)
    .set({ endedAt: sql`${voiceSessions.lastHeartbeatAt}`, updatedAt: sql`now()` })
    .where(isNull(voiceSessions.endedAt))
    .returning({ id: voiceSessions.id });
  return rows.length;
}

/**
 * Milissegundos de sobreposição entre sessão e janela [from, to]. Sessão aberta conta até `to`.
 * Puro, para presença/loot split (TASK-027).
 */
export function overlapMs(session: { startedAt: Date; endedAt: Date | null }, from: Date, to: Date): number {
  const start = Math.max(session.startedAt.getTime(), from.getTime());
  const end = Math.min((session.endedAt ?? to).getTime(), to.getTime());
  return Math.max(0, end - start);
}
