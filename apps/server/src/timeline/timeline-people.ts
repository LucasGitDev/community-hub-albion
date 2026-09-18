import { listTimelineUsers, type Database, type TimelineUser } from "@albion-hub/db";
import type { Logger } from "@nestjs/common";
import type { TimelineActor, TimelineEntry, TimelinePublisher, TimelineTarget } from "../domain/timeline.js";

/**
 * Ator e alvo da timeline a partir do id do usuário (TASK-077). Uma consulta só para todos os citados
 * no registro; quem não for achado (não deveria acontecer) aparece pelo id, nunca derruba a operação.
 */
export interface TimelinePeople {
  actor(userId: string): TimelineActor;
  target(userId: string): TimelineTarget;
}

export async function loadTimelinePeople(db: Database, userIds: readonly string[]): Promise<TimelinePeople> {
  const found = await listTimelineUsers(db, userIds);
  const person = (userId: string): TimelineUser => found.get(userId) ?? { id: userId, name: `Usuário ${userId.slice(0, 8)}`, discordId: "" };
  return {
    actor(userId) {
      const p = person(userId);
      return { kind: "user", userId: p.id, name: p.name, discordId: p.discordId || null };
    },
    target(userId) {
      const p = person(userId);
      return { name: p.name, id: p.id, discordId: p.discordId || null };
    },
  };
}

/**
 * Monta e publica depois do commit (T5). Montar pode consultar o banco (nomes, lista de inscritos); se
 * isso falhar, vira aviso no log e a operação, que já foi gravada, segue (T6).
 */
export async function publishAfterCommit(
  timeline: TimelinePublisher,
  logger: Pick<Logger, "warn">,
  build: () => Promise<TimelineEntry | readonly TimelineEntry[]>,
): Promise<void> {
  try {
    const built = await build();
    for (const entry of Array.isArray(built) ? built : [built as TimelineEntry]) timeline.publish(entry);
  } catch (error) {
    logger.warn(`Timeline: registro não montado (${error instanceof Error ? error.message : String(error)})`);
  }
}
