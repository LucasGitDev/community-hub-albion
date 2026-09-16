import {
  ACTIVE_EVENT_SIGNUP_STATUSES,
  calculateSplitDraft,
  type EventFee,
  type EventStatus,
  type LootSplitDto,
  type LootSplitLineDto,
  type SplitPresence,
} from "@albion-hub/shared";
import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import type { Database } from "./client.js";
import type { EventTx } from "./events-repo.js";
import { memberNick } from "./member-nick.js";
import { eventSignups, events, lootSplitLines, lootSplits, users, voiceSessions } from "./schema.js";
import { overlapMs } from "./voice-repo.js";

/**
 * Loot split (TASK-027, Q5/Q6/Q7/Q23). Este módulo só monta o **rascunho**: mede presença, rateia e
 * grava. Nada aqui escreve no ledger — confirmar o split e creditar prata é da TASK-028.
 */

/** Uma pessoa presente ou inscrita, antes do rateio. */
interface Candidate extends SplitPresence {
  userId: string | null;
  nick: string | null;
  roleName: string | null;
}

/**
 * Quem participa do rateio deste evento e com quanto tempo (AC#1, AC#2).
 *
 * A lista é a **união** de duas coisas, e as duas importam:
 * - quem esteve no canal do evento entre `started_at` e `finished_at` (Q6), inclusive quem não estava
 *   inscrito — este aparece marcado e com 0% (Q7), para o caller ver que a pessoa esteve lá;
 * - quem tinha inscrição ativa, mesmo sem ter entrado na voz — aparece com 0ms e 0%, senão o caller
 *   não teria como notar que um inscrito ficou de fora.
 *
 * A chave é o snowflake do Discord: `voice_sessions` mede presença por snowflake e quem nunca entrou
 * no painel não tem linha em `users` (doc-002). `userId` fica null nesse caso.
 *
 * Presença é cortada pela janela com `overlapMs` (sessão que começou antes do start ou terminou depois
 * do finish só conta o pedaço de dentro), e o SQL traz só as sessões que encostam na janela.
 */
export async function listEventPresence(db: Database | EventTx, eventId: string): Promise<Candidate[]> {
  const [event] = await db
    .select({
      status: events.status,
      startedAt: events.startedAt,
      finishedAt: events.finishedAt,
      channelId: events.presenceChannelId,
    })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) return [];

  const byDiscordId = new Map<string, Candidate>();
  const put = (discordUserId: string): Candidate => {
    const found = byDiscordId.get(discordUserId);
    if (found) return found;
    const created: Candidate = { discordUserId, presenceMs: 0, signedUp: false, userId: null, nick: null, roleName: null };
    byDiscordId.set(discordUserId, created);
    return created;
  };

  const { startedAt, finishedAt, channelId } = event;
  if (startedAt && finishedAt && channelId) {
    const sessions = await db
      .select({ discordUserId: voiceSessions.discordUserId, startedAt: voiceSessions.startedAt, endedAt: voiceSessions.endedAt })
      .from(voiceSessions)
      .where(
        and(
          eq(voiceSessions.channelId, channelId),
          // Encosta na janela: começou até o fim do evento e não acabou antes do começo dele.
          lte(voiceSessions.startedAt, finishedAt),
          or(isNull(voiceSessions.endedAt), gte(voiceSessions.endedAt, startedAt)),
        ),
      );
    for (const session of sessions) put(session.discordUserId).presenceMs += overlapMs(session, startedAt, finishedAt);
  }

  const signups = await db
    .select({ discordId: users.discordId, userId: users.id, nick: memberNick(users), roleName: eventSignups.roleName })
    .from(eventSignups)
    .innerJoin(users, eq(users.id, eventSignups.userId))
    .where(and(eq(eventSignups.eventId, eventId), inArray(eventSignups.status, [...ACTIVE_EVENT_SIGNUP_STATUSES])));
  for (const signup of signups) {
    const candidate = put(signup.discordId);
    candidate.signedUp = true;
    candidate.userId = signup.userId;
    candidate.nick = signup.nick;
    candidate.roleName = signup.roleName;
  }

  // Presente sem inscrição ainda pode ter conta no painel: resolve para a TASK-028 poder creditar
  // caso a staff decida dar participação a ele depois.
  const unresolved = [...byDiscordId.values()].filter((c) => c.userId === null).map((c) => c.discordUserId);
  if (unresolved.length > 0) {
    const accounts = await db
      .select({ discordId: users.discordId, id: users.id, nick: memberNick(users) })
      .from(users)
      .where(inArray(users.discordId, unresolved));
    for (const account of accounts) {
      const candidate = byDiscordId.get(account.discordId)!;
      candidate.userId = account.id;
      candidate.nick = account.nick;
    }
  }

  // Ordem estável e útil: mais presente primeiro, empate pelo snowflake.
  return [...byDiscordId.values()].sort((a, b) => b.presenceMs - a.presenceMs || (a.discordUserId < b.discordUserId ? -1 : 1));
}

export interface CreateLootSplitInput {
  eventId: string;
  /** Prata bruta desta leva. A taxa **não** é descontada aqui (TASK-028). */
  totalSilver: bigint;
  /** Taxa congelada no split; quem chama passa a do evento quando o pedido não trouxe uma. */
  fee: EventFee;
  createdBy: string | null;
}

export type CreateLootSplitResult = { ok: true; split: LootSplitDto } | { ok: false; reason: "not_found" } | { ok: false; reason: "invalid_status"; status: EventStatus };

/**
 * Cria o rascunho do split (AC#1, AC#3).
 *
 * Só nasce com o evento em `finished`: antes disso a janela de presença ainda não fechou (Q6), e
 * `cancelled` não aceita split nenhum (AC#4, Q26). `archived` também cai aqui, embora o server já o
 * tenha barrado antes com uma frase melhor (`assertEventEditable`).
 *
 * Tudo numa transação com o evento travado por `for update`: dois cliques simultâneos em "gerar
 * split" não leem o mesmo estado e não produzem rascunhos concorrentes a partir de um evento que
 * mudou no meio. Múltiplos splits **de propósito** continuam permitidos (AC#3, Q23) — o loot da noite
 * chega em levas, e cada leva fecha 100% sozinha.
 */
export async function createLootSplit(db: Database, input: CreateLootSplitInput): Promise<CreateLootSplitResult> {
  const created = await db.transaction(async (tx) => {
    const [event] = await tx.select({ status: events.status }).from(events).where(eq(events.id, input.eventId)).for("update");
    if (!event) return { ok: false as const, reason: "not_found" as const };
    if (event.status !== "finished") return { ok: false as const, reason: "invalid_status" as const, status: event.status };

    const candidates = await listEventPresence(tx, input.eventId);
    const { lines, residual } = calculateSplitDraft(candidates, input.totalSilver);

    const [split] = await tx
      .insert(lootSplits)
      .values({
        eventId: input.eventId,
        totalSilver: input.totalSilver,
        feeType: input.fee.type,
        feeValue: input.fee.value,
        residualSilver: residual,
        createdBy: input.createdBy,
      })
      .returning({ id: lootSplits.id });
    const splitId = split!.id;

    if (lines.length > 0)
      await tx.insert(lootSplitLines).values(
        lines.map((line) => ({
          splitId,
          discordUserId: line.discordUserId,
          userId: line.userId,
          signedUp: line.signedUp,
          roleName: line.roleName,
          presenceMs: line.presenceMs,
          shareBp: line.shareBp,
          amountSilver: line.amount,
        })),
      );
    return { ok: true as const, splitId };
  });
  if (!created.ok) return created;
  return { ok: true, split: (await getLootSplit(db, created.splitId))! };
}

async function loadSplits(db: Database, where: SQL): Promise<LootSplitDto[]> {
  const rows = await db.select().from(lootSplits).where(where).orderBy(asc(lootSplits.createdAt), asc(lootSplits.id));
  if (rows.length === 0) return [];
  const lines = await db
    .select({
      id: lootSplitLines.id,
      splitId: lootSplitLines.splitId,
      discordUserId: lootSplitLines.discordUserId,
      userId: lootSplitLines.userId,
      nick: memberNick(users),
      signedUp: lootSplitLines.signedUp,
      roleName: lootSplitLines.roleName,
      presenceMs: lootSplitLines.presenceMs,
      shareBp: lootSplitLines.shareBp,
      amountSilver: lootSplitLines.amountSilver,
    })
    .from(lootSplitLines)
    .leftJoin(users, eq(users.id, lootSplitLines.userId))
    .where(inArray(lootSplitLines.splitId, rows.map((r) => r.id)))
    .orderBy(asc(lootSplitLines.shareBp), asc(lootSplitLines.discordUserId));

  return rows.map((split) => ({
    id: split.id,
    eventId: split.eventId,
    status: split.status,
    totalSilver: split.totalSilver.toString(),
    fee: { type: split.feeType, value: split.feeValue.toString() },
    residualSilver: split.residualSilver.toString(),
    createdByUserId: split.createdBy,
    createdAt: split.createdAt.toISOString(),
    updatedAt: split.updatedAt.toISOString(),
    lines: lines
      .filter((line) => line.splitId === split.id)
      .map(
        ({ id, discordUserId, userId, nick, signedUp, roleName, presenceMs, shareBp, amountSilver }): LootSplitLineDto => ({
          id,
          discordUserId,
          userId,
          nick,
          signedUp,
          roleName,
          presenceMs,
          shareBp,
          amount: amountSilver.toString(),
        }),
      )
      // Maior participação primeiro; quem ficou com 0% (não inscrito, Q7) cai para o fim da lista.
      .sort((a, b) => b.shareBp - a.shareBp || b.presenceMs - a.presenceMs || (a.discordUserId < b.discordUserId ? -1 : 1)),
  }));
}

export async function getLootSplit(db: Database, id: string): Promise<LootSplitDto | null> {
  return (await loadSplits(db, eq(lootSplits.id, id)))[0] ?? null;
}

/** Splits do evento, do mais antigo para o mais novo (a ordem em que as levas de loot chegaram). */
export function listEventLootSplits(db: Database, eventId: string): Promise<LootSplitDto[]> {
  return loadSplits(db, eq(lootSplits.eventId, eventId));
}

/**
 * Existe split em rascunho neste evento? É a precondição do arquivamento (TASK-044, AC#4): arquivar
 * com rascunho aberto congelaria prata que ninguém mais poderia distribuir, já que `archived` bloqueia
 * toda edição. Roda dentro da transação da transição, com o evento já travado.
 */
export async function hasDraftLootSplit(db: Database | EventTx, eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: lootSplits.id })
    .from(lootSplits)
    .where(and(eq(lootSplits.eventId, eventId), eq(lootSplits.status, "draft")))
    .limit(1);
  return rows.length > 0;
}
