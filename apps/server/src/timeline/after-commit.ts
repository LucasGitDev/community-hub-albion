import { Logger } from "@nestjs/common";
import { listTimelinePeople, type Database, type TimelinePerson } from "@albion-hub/db";
import type { TimelineActor, TimelineEntry, TimelinePublisher, TimelineTarget } from "../domain/timeline.js";

/**
 * Pessoas citadas num registro da timeline (TASK-078), já com nome e ID do Discord. A operação de
 * dinheiro só guarda `userId`; o canal de auditoria precisa do nome para ser lido.
 */
export interface TimelinePeople {
  /** Ator de uma operação feita por alguém. `null` (job, pagamento sem sessão) vira ator `system`. */
  actor(userId: string | null | undefined, systemName?: string): TimelineActor;
  target(userId: string): TimelineTarget;
  /** Nome curto para a lista consolidada de um lote. */
  name(userId: string | null | undefined): string;
}

const UNKNOWN = "Membro";

export async function loadTimelinePeople(db: Database, userIds: readonly (string | null | undefined)[]): Promise<TimelinePeople> {
  const people: Map<string, TimelinePerson> = await listTimelinePeople(db, userIds);
  return {
    actor(userId, systemName = "automático") {
      if (!userId) return { kind: "system", name: systemName };
      const person = people.get(userId);
      return { kind: "user", userId, name: person?.name ?? UNKNOWN, discordId: person?.discordId ?? null };
    },
    target(userId) {
      const person = people.get(userId);
      return { name: person?.name ?? UNKNOWN, id: userId, discordId: person?.discordId ?? null };
    },
    name(userId) {
      return (userId && people.get(userId)?.name) || UNKNOWN;
    },
  };
}

const fallbackLogger = new Logger("Timeline");

/**
 * Publica o que a operação fez, **depois** do commit (T5). Quem chama só chega aqui com a transação já
 * resolvida e com o resultado `ok`: recusa não publica.
 *
 * Montar o registro pode consultar o banco (nomes); se isso falhar, vira aviso no log e a operação segue
 * com o resultado dela — a timeline é extra e nunca derruba nem desfaz dinheiro (T6, DoD #7).
 */
export async function publishAfterCommit(
  timeline: TimelinePublisher,
  build: () => Promise<TimelineEntry | readonly TimelineEntry[] | null>,
  logger: Pick<Logger, "warn"> = fallbackLogger,
): Promise<void> {
  try {
    const built = await build();
    if (!built) return;
    for (const entry of Array.isArray(built) ? built : [built as TimelineEntry]) timeline.publish(entry);
  } catch (error) {
    try {
      logger.warn(`Timeline: registro não montado e ignorado (${error instanceof Error ? error.message : String(error)})`);
    } catch {
      // nada: a timeline nunca derruba a operação
    }
  }
}
