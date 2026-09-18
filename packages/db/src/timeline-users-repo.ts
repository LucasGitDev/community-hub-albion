import { eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { memberNick } from "./member-nick.js";
import { users } from "./schema.js";

/** Pessoa como a timeline (TASK-077) mostra: o mesmo nome do painel, mais o ID do Discord para a menção. */
export interface TimelineUser {
  id: string;
  name: string;
  discordId: string;
}

/** Nome e Discord de cada usuário citado num registro da timeline. Quem não existe fica fora do mapa. */
export async function listTimelineUsers(db: Database, userIds: readonly string[]): Promise<Map<string, TimelineUser>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: memberNick(users), discordId: users.discordId })
    .from(users)
    .where(unique.length === 1 ? eq(users.id, unique[0]) : inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name ?? "Membro", discordId: r.discordId }]));
}
