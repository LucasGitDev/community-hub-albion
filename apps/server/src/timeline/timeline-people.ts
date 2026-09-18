import { listTimelineUsers, type Database, type TimelineUser } from "@albion-hub/db";
import { Logger } from "@nestjs/common";
import type { TimelineActor, TimelineEntry, TimelinePublisher, TimelineTarget } from "../domain/timeline.js";

/**
 * Ator e alvo da timeline a partir do id do usuário (TASK-077). Uma consulta só para todos os citados
 * no registro; quem não for achado (não deveria acontecer) aparece pelo id, nunca derruba a operação.
 */
export interface TimelinePeople {
  /** `null`/`undefined` (job, pagamento sem sessão) vira ator `system` (TASK-078). */
  actor(userId: string | null | undefined, systemName?: string): TimelineActor;
  target(userId: string): TimelineTarget;
  /** Nome curto, para as linhas da lista de um lote (TASK-078). */
  name(userId: string | null | undefined): string;
}

export async function loadTimelinePeople(db: Database, userIds: readonly (string | null | undefined)[]): Promise<TimelinePeople> {
  const found = await listTimelineUsers(
    db,
    userIds.filter((id): id is string => typeof id === "string"),
  );
  const person = (userId: string): TimelineUser => found.get(userId) ?? { id: userId, name: `Usuário ${userId.slice(0, 8)}`, discordId: "" };
  return {
    actor(userId, systemName = "automático") {
      if (!userId) return { kind: "system", name: systemName };
      const p = person(userId);
      return { kind: "user", userId: p.id, name: p.name, discordId: p.discordId || null };
    },
    target(userId) {
      const p = person(userId);
      return { name: p.name, id: p.id, discordId: p.discordId || null };
    },
    name(userId) {
      return userId ? person(userId).name : "Membro";
    },
  };
}

/** Logger padrão de quem publica sem logger próprio (serviços da economia, TASK-078). */
export const TIMELINE_LOGGER: Pick<Logger, "warn"> = new Logger("Timeline");

/**
 * Monta e publica depois do commit (T5). Montar pode consultar o banco (nomes, lista de inscritos); se
 * isso falhar, vira aviso no log e a operação, que já foi gravada, segue (T6). `null` = nada a publicar.
 */
export async function publishAfterCommit(
  timeline: TimelinePublisher,
  logger: Pick<Logger, "warn">,
  build: () => Promise<TimelineEntry | readonly TimelineEntry[] | null>,
): Promise<void> {
  try {
    const built = await build();
    if (!built) return;
    for (const entry of Array.isArray(built) ? built : [built as TimelineEntry]) timeline.publish(entry);
  } catch (error) {
    try {
      logger.warn(`Timeline: registro não montado (${error instanceof Error ? error.message : String(error)})`);
    } catch {
      // nada: a timeline nunca derruba a operação
    }
  }
}
