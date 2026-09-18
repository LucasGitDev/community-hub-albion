import { inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { memberNick } from "./member-nick.js";
import { users } from "./schema.js";

/** Como a timeline (TASK-078) nomeia uma pessoa: o mesmo nome do painel e o ID do Discord para achar. */
export interface TimelinePerson {
  id: string;
  name: string;
  discordId: string;
}

/**
 * Nome e ID do Discord de cada pessoa citada num registro da timeline, numa consulta só. Roda **depois**
 * do commit da operação, fora da transação: é leitura para o canal de auditoria, não parte do dinheiro.
 * Quem não existe simplesmente não volta no mapa.
 */
export async function listTimelinePeople(db: Database, userIds: readonly (string | null | undefined)[]): Promise<Map<string, TimelinePerson>> {
  const unique = [...new Set(userIds.filter((id): id is string => typeof id === "string"))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: memberNick(users), discordId: users.discordId }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name ?? r.discordId, discordId: r.discordId }]));
}
