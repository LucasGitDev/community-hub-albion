import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { DiscordProfile } from "./auth-repo.js";
import { userRoles, users } from "./schema.js";

export interface ImportDiscordMemberInput {
  profile: DiscordProfile;
  /** Tag de guilda vinda do apelido (`[GENEI] Erijj`); null quando o apelido não tem tag. */
  guildTag: string | null;
  /** Nick derivado do apelido do Discord, já validado (Q14). */
  nick: string;
}

export interface ImportDiscordMemberResult {
  userId: string;
  /** Usuário criado agora (não existia conta). */
  created: boolean;
  /** Nick do apelido virou o nick vigente (só acontece quando o usuário ainda não tinha nick aprovado). */
  nickApplied: boolean;
  /** Nick aprovado que já existia e foi preservado; null se não havia. */
  keptNick: string | null;
  /** Papel `member` concedido agora (idempotente: já tinha = false). */
  roleGranted: boolean;
  /** Tag de guilda mudou (ou foi gravada pela primeira vez). */
  guildTagChanged: boolean;
}

/**
 * Importa um membro já regularizado no Discord (TASK-042, AC#2/AC#4/AC#6). Uma transação por membro:
 * um apelido problemático ou um membro que sumiu no meio do import não desfaz os anteriores.
 *
 * Idempotente e conservador:
 * - conta existente é atualizada (username/avatar/tag), nunca duplicada;
 * - `users.game_nick` só é gravado quando está vazio: nick já aprovado no painel **nunca** é sobrescrito (AC#4);
 * - o papel `member` é concedido via upsert (já ter o papel é no-op).
 */
export async function importDiscordMember(db: Database, input: ImportDiscordMemberInput): Promise<ImportDiscordMemberResult> {
  const { profile, guildTag, nick } = input;
  return db.transaction(async (tx) => {
    // Lê o estado anterior travando a linha: o upsert abaixo não devolve o valor de antes, e duas importações
    // simultâneas não podem decidir sobre o nick com a mesma leitura.
    const [before] = await tx
      .select({ gameNick: users.gameNick, guildTag: users.guildTag })
      .from(users)
      .where(eq(users.discordId, profile.discordId))
      .for("update");
    const keptNick = before?.gameNick ?? null;
    const [row] = await tx
      .insert(users)
      .values({
        discordId: profile.discordId,
        discordUsername: profile.discordUsername,
        displayName: profile.displayName ?? null,
        avatar: profile.avatar ?? null,
        guildTag,
        gameNick: nick,
      })
      .onConflictDoUpdate({
        target: users.discordId,
        set: {
          discordUsername: profile.discordUsername,
          displayName: profile.displayName ?? null,
          avatar: profile.avatar ?? null,
          guildTag,
          // COALESCE: mantém o nick já aprovado; só preenche quem ainda não tem (AC#4).
          gameNick: sql`coalesce(${users.gameNick}, ${nick})`,
          updatedAt: sql`now()`,
        },
      })
      // xmax = 0 só em linha recém-inserida (no upsert que atualiza, xmax é o id da transação).
      .returning({ id: users.id, inserted: sql<boolean>`(xmax = 0)` });
    const user = row!;
    const [granted] = await tx.insert(userRoles).values({ userId: user.id, role: "member" }).onConflictDoNothing().returning({ role: userRoles.role });
    return {
      userId: user.id,
      created: user.inserted,
      nickApplied: !keptNick,
      keptNick,
      roleGranted: granted !== undefined,
      guildTagChanged: (before?.guildTag ?? null) !== guildTag,
    };
  });
}

/** Resultado persistido da conferência do nick na API do Albion (AC#7). `disabled` não é gravado. */
export interface AlbionCheck {
  status: "found" | "not_found" | "unavailable";
  playerId?: string | null;
  guildName?: string | null;
  checkedAt: Date;
}

/** Guarda a conferência do Albion no usuário; sempre com a data, para a staff saber quão velho é o dado. */
export async function setAlbionCheck(db: Database, userId: string, check: AlbionCheck): Promise<void> {
  await db
    .update(users)
    .set({
      albionStatus: check.status,
      albionPlayerId: check.status === "found" ? (check.playerId ?? null) : null,
      albionGuildName: check.status === "found" ? (check.guildName ?? null) : null,
      albionCheckedAt: check.checkedAt,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));
}

export interface ImportedMemberSnapshot {
  id: string;
  discordId: string;
  gameNick: string | null;
  guildTag: string | null;
  albionStatus: string | null;
  albionPlayerId: string | null;
  albionGuildName: string | null;
  albionCheckedAt: Date | null;
}

/** Estado importado de um membro pelo id Discord (usado por testes e pela listagem da TASK-043). */
export async function getImportedMember(db: Database, discordId: string): Promise<ImportedMemberSnapshot | null> {
  const [row] = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      gameNick: users.gameNick,
      guildTag: users.guildTag,
      albionStatus: users.albionStatus,
      albionPlayerId: users.albionPlayerId,
      albionGuildName: users.albionGuildName,
      albionCheckedAt: users.albionCheckedAt,
    })
    .from(users)
    .where(eq(users.discordId, discordId));
  return row ?? null;
}
