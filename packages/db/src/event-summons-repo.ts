import { and, eq, lte } from "drizzle-orm";
import { eventSummons } from "./schema.js";
import type { Database } from "./client.js";

/**
 * Intervalo entre dois chamados no privado da **mesma pessoa no mesmo evento** (TASK-087, PE15).
 *
 * O controle mora no banco porque ele precisa valer entre as duas portas (painel e menu da call), entre
 * dois callers clicando ao mesmo tempo e **entre restarts**: um `Map` no processo esquece tudo no
 * deploy, e o primeiro clique depois de subir mandaria privado para quem acabou de receber um.
 */
export async function claimEventSummons(
  db: Database,
  eventId: string,
  userIds: readonly string[],
  options: { now: Date; cooldownMs: number },
): Promise<string[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const { now, cooldownMs } = options;
  const threshold = new Date(now.getTime() - cooldownMs);

  /**
   * Um `INSERT ... ON CONFLICT DO UPDATE ... WHERE` só: quem **não** está dentro do intervalo tem a
   * linha atualizada e volta no `RETURNING`; quem está é descartado pelo `WHERE` e não volta. É o banco
   * que decide, numa instrução atômica — ler antes e gravar depois deixaria dois cliques simultâneos
   * passarem os dois, que é exatamente o privado repetido que a PE15 proíbe.
   */
  const claimed = await db
    .insert(eventSummons)
    .values(unique.map((userId) => ({ eventId, userId, lastSentAt: now })))
    .onConflictDoUpdate({
      target: [eventSummons.eventId, eventSummons.userId],
      set: { lastSentAt: now },
      setWhere: lte(eventSummons.lastSentAt, threshold),
    })
    .returning({ userId: eventSummons.userId });
  return claimed.map((row) => row.userId);
}

/** Quando a pessoa foi chamada pela última vez neste evento; `null` se nunca foi. Leitura de teste e de suporte. */
export async function findEventSummon(db: Database, eventId: string, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastSentAt: eventSummons.lastSentAt })
    .from(eventSummons)
    .where(and(eq(eventSummons.eventId, eventId), eq(eventSummons.userId, userId)));
  return row?.lastSentAt ?? null;
}
