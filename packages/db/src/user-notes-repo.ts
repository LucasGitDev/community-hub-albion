import type { UserNoteKind } from "@albion-hub/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { userNotes, users } from "./schema.js";

/**
 * Notas internas por membro (TASK-045, AC#3).
 *
 * Este arquivo é a superfície inteira da tabela e tem só duas operações: **escrever** e **ler**.
 * Não existe `updateUserNote` nem `deleteUserNote` de propósito — nota é histórico, e histórico que
 * alguém reescreve não serve para conferir nada depois (mesma regra do ledger, Q24).
 */

export interface UserNote {
  id: string;
  kind: UserNoteKind;
  body: string;
  createdAt: Date;
  /** Quem escreveu. `null` = conta removida do painel; a nota fica, o autor não volta. */
  author: { id: string; name: string } | null;
}

export interface AddUserNoteInput {
  userId: string;
  /** Autor da nota; `null` só para nota escrita pelo sistema sem pessoa por trás. */
  authorId: string | null;
  /** Corpo já validado e normalizado (`validateUserNote`). */
  body: string;
  kind?: UserNoteKind;
}

/** Acrescenta uma nota. Sempre insert: nenhuma nota anterior é tocada. */
export async function addUserNote(db: Database, input: AddUserNoteInput): Promise<UserNote> {
  const [row] = await db
    .insert(userNotes)
    .values({ userId: input.userId, authorId: input.authorId, body: input.body, kind: input.kind ?? "staff" })
    .returning({ id: userNotes.id, kind: userNotes.kind, body: userNotes.body, createdAt: userNotes.createdAt, authorId: userNotes.authorId });
  const note = row!;
  const author = note.authorId ? await authorName(db, note.authorId) : null;
  return { id: note.id, kind: note.kind, body: note.body, createdAt: note.createdAt, author };
}

/**
 * Notas do membro em ordem cronológica (mais antiga primeiro): a lista se lê como uma linha do tempo,
 * e uma nota nova aparece no fim sem remexer nas anteriores. Desempate por id para ordem estável quando
 * duas notas caem no mesmo instante.
 */
export async function listUserNotes(db: Database, userId: string): Promise<UserNote[]> {
  const rows = await db
    .select({
      id: userNotes.id,
      kind: userNotes.kind,
      body: userNotes.body,
      createdAt: userNotes.createdAt,
      authorId: users.id,
      authorNick: users.gameNick,
      authorDisplayName: users.displayName,
      authorUsername: users.discordUsername,
    })
    .from(userNotes)
    .leftJoin(users, eq(users.id, userNotes.authorId))
    .where(eq(userNotes.userId, userId))
    .orderBy(asc(userNotes.createdAt), asc(userNotes.id));

  return rows.map(({ authorId, authorNick, authorDisplayName, authorUsername, ...note }) => ({
    ...note,
    author: authorId ? { id: authorId, name: authorNick || authorDisplayName || authorUsername || "sem nome" } : null,
  }));
}

/** Mesmo nome que a listagem mostra, para a nota recém-criada voltar igual às outras. */
async function authorName(db: Database, authorId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: users.id, gameNick: users.gameNick, displayName: users.displayName, discordUsername: users.discordUsername })
    .from(users)
    .where(eq(users.id, authorId));
  return row ? { id: row.id, name: row.gameNick || row.displayName || row.discordUsername } : null;
}
