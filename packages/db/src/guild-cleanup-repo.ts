import { assessGuildCleanup, type Role } from "@albion-hub/shared";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { sessions, userRoles, users } from "./schema.js";

/**
 * Limpeza diária de quem saiu do servidor do Discord (TASK-049, G6).
 *
 * O que uma passada faz com quem não está mais na guild: derruba as sessões, remove os papéis e marca
 * `left_guild_at`. Só isso.
 *
 * O que ela **nunca** faz, e é o ponto todo da decisão G6: nenhum `INSERT`, `UPDATE` ou `DELETE` em
 * `ledger_entries`, `withdrawals` ou qualquer coisa de saldo. Prata é dívida da comunidade com a pessoa
 * — ela sair do Discord não cancela a dívida, e um job apagando saldo de madrugada seria calote
 * automatizado. Este arquivo só toca `users` (uma coluna), `sessions` e `user_roles`.
 *
 * Banimento é marca independente: nada aqui lê ou escreve `banned_at`/`ban_reason`/`banned_by`, então um
 * banido que também saiu fica com as duas marcas e nenhuma sobrescreve a outra (TASK-050).
 */

export interface GuildCleanupInput {
  /** Snowflakes que a API do Discord devolveu agora. Lista vazia é tratada como falha, não como êxodo. */
  presentDiscordIds: readonly string[];
  now: Date;
}

export interface DeactivatedMember {
  userId: string;
  discordId: string;
  sessionsRevoked: number;
  rolesRemoved: Role[];
}

export type GuildCleanupResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      known: number;
      present: number;
      deactivated: DeactivatedMember[];
      /** Contas que voltaram para o servidor e perderam a marca de inatividade. */
      reactivated: number;
      /** Ausentes que já estavam marcados: a prova de que rodar de novo não faz nada diferente. */
      alreadyInactive: number;
      /** Ausentes preservados porque desativá-los deixaria a comunidade sem nenhum admin ativo. */
      skippedLastAdmin: string[];
    };

/**
 * Uma passada completa, numa transação só.
 *
 * As linhas de `users` são travadas (`for update`) antes de qualquer decisão, pelo mesmo motivo de
 * `banUser`: a checagem "ainda sobra algum admin ativo?" é um predicado sobre essas linhas, e sem a
 * trava duas escritas concorrentes veriam dois admins onde já só há um.
 *
 * Idempotente por construção: só entram na desativação as contas com `left_guild_at` nulo, e a
 * reativação só toca quem tem a marca. Rodar duas vezes seguidas devolve a segunda com tudo zerado.
 */
export async function runGuildCleanup(db: Database, input: GuildCleanupInput): Promise<GuildCleanupResult> {
  const present = new Set(input.presentDiscordIds);
  return db.transaction(async (tx) => {
    const all = await tx.select({ id: users.id, discordId: users.discordId, leftGuildAt: users.leftGuildAt }).from(users).for("update");

    const absent = all.filter((u) => !present.has(u.discordId));
    const toDeactivate = absent.filter((u) => u.leftGuildAt === null);

    // Disjuntor antes de qualquer escrita: leitura suspeita do Discord aborta a passada inteira (AC#5).
    const verdict = assessGuildCleanup({ presentCount: present.size, knownCount: all.length, absentCount: toDeactivate.length });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    /**
     * Trava do último admin. Quem saiu do Discord perde os papéis — menos quando isso deixaria a
     * comunidade sem nenhum admin ativo para consertar o engano. Nesse caso a conta é preservada
     * inteira (papéis, sessões e marca) e o motivo vai para o log: um job de madrugada não pode
     * trancar todo mundo do lado de fora do painel.
     */
    const activeAdmins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.role, "admin"), isNull(users.bannedAt), isNull(users.leftGuildAt)));
    const adminIds = new Set(activeAdmins.map((a) => a.userId));
    const losingIds = new Set(toDeactivate.map((u) => u.id));
    const remainingAdmins = [...adminIds].filter((id) => !losingIds.has(id));
    const skipAdmins = remainingAdmins.length === 0;
    const skippedLastAdmin = skipAdmins ? toDeactivate.filter((u) => adminIds.has(u.id)).map((u) => u.id) : [];
    const skipped = new Set(skippedLastAdmin);

    const deactivated: DeactivatedMember[] = [];
    for (const user of toDeactivate) {
      if (skipped.has(user.id)) continue;
      const revoked = await tx.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id });
      const removed = await tx.delete(userRoles).where(eq(userRoles.userId, user.id)).returning({ role: userRoles.role });
      await tx
        .update(users)
        .set({ leftGuildAt: input.now, updatedAt: input.now })
        .where(and(eq(users.id, user.id), isNull(users.leftGuildAt)));
      deactivated.push({ userId: user.id, discordId: user.discordId, sessionsRevoked: revoked.length, rolesRemoved: removed.map((r) => r.role) });
    }

    // Quem voltou perde a marca de inatividade — e só ela. Papéis não voltam sozinhos: devolver acesso
    // é um ato de alguém, nunca de um timer.
    const reactivated =
      present.size === 0
        ? []
        : await tx
            .update(users)
            .set({ leftGuildAt: null, updatedAt: input.now })
            .where(and(inArray(users.discordId, [...present]), isNotNull(users.leftGuildAt)))
            .returning({ id: users.id });

    return {
      ok: true,
      known: all.length,
      present: present.size,
      deactivated,
      reactivated: reactivated.length,
      alreadyInactive: absent.length - toDeactivate.length,
      skippedLastAdmin,
    };
  });
}

/** Marca de inatividade de uma conta (para teste e diagnóstico). `null` = está no servidor. */
export async function getLeftGuildAt(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db.select({ leftGuildAt: users.leftGuildAt }).from(users).where(eq(users.id, userId));
  return row?.leftGuildAt ?? null;
}

/** Contas marcadas como fora do servidor, para o resumo do disparo manual. */
export async function countInactiveMembers(db: Database): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(isNotNull(users.leftGuildAt));
  return row?.total ?? 0;
}

/**
 * Semeia a marca de inatividade numa conta. **Só** para desenvolvimento e e2e (dev-login, que o env
 * proíbe em produção): serve para desenhar a tela sem um bot ligado. A limpeza de verdade não passa por
 * aqui — ela é `runGuildCleanup`, com disjuntor e transação.
 */
export async function markLeftGuildForDev(db: Database, userId: string, at: Date = new Date()): Promise<void> {
  await db.update(users).set({ leftGuildAt: at, updatedAt: at }).where(eq(users.id, userId));
}
