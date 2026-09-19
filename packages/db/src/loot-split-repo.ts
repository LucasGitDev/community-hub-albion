import {
  ACTIVE_EVENT_SIGNUP_STATUSES,
  calculateSplitDraft,
  checkSplitConfirm,
  distributeByShare,
  feeBreakdown,
  type EventFee,
  type EventStatus,
  type LootSplitDto,
  type LootSplitLineDto,
  type LootSplitStatus,
  type SplitConfirmRefusal,
  type SplitPresence,
} from "@albion-hub/shared";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client.js";
import type { EventTx } from "./events-repo.js";
import { listLedgerEntriesByReference, reverseLedgerEntry } from "./ledger-repo.js";
import { memberNick } from "./member-nick.js";
import { eventSignups, events, ledgerEntries, lootSplitLines, lootSplits, users, voiceSessions, withdrawals } from "./schema.js";
import { overlapMs } from "./voice-repo.js";

/**
 * Loot split (TASK-027 e TASK-028, Q5/Q6/Q7/Q22/Q23). Monta o rascunho (mede presença e rateia),
 * deixa editar total e percentuais enquanto é rascunho, e **confirma**: aí a prata vira lançamento no
 * ledger, numa transação só.
 *
 * Ordem de travas, igual em todo caminho de escrita daqui: **evento primeiro, split depois**. A
 * transição de arquivamento (TASK-044) trava o evento e depois só *lê* os splits, nunca os trava —
 * então não existe ciclo, e a ordem acima é a única que precisa ser respeitada por quem vier depois.
 */

/** Uma pessoa presente ou inscrita, antes do rateio. */
interface Candidate extends SplitPresence {
  userId: string | null;
  nick: string | null;
  roleName: string | null;
}

/**
 * Quando a call **de fato** começou, para servir de denominador do corte de presença (TASK-073).
 *
 * O início do evento não serve: entre ele e a primeira pessoa entrar existe o tempo de o bot criar o
 * canal e arrastar gente da sala de espera, e nesse intervalo ninguém poderia estar na call. Contar
 * isso contra todo mundo derrubava até quem ficou o evento inteiro — numa call de um minuto, uns
 * segundos de arrasto viraram 27% de presença perdida, que foi como o defeito apareceu.
 *
 * A janela então começa na primeira entrada registrada no canal, **nunca antes** do início do evento
 * (sessão que já estava aberta antes conta só do start em diante, igual ao `overlapMs` do rateio).
 * Sem sessão nenhuma, a janela é zero: não há call medida, e ninguém bate um corte de zero.
 */
export async function eventCallWindowMs(db: Database | EventTx, eventId: string): Promise<number> {
  const [event] = await db
    .select({ startedAt: events.startedAt, finishedAt: events.finishedAt, channelId: events.presenceChannelId })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event?.startedAt || !event.finishedAt || !event.channelId) return 0;
  const { startedAt, finishedAt, channelId } = event;
  const [first] = await db
    .select({ at: sql<Date | null>`min(${voiceSessions.startedAt})` })
    .from(voiceSessions)
    .where(
      and(
        eq(voiceSessions.channelId, channelId),
        lte(voiceSessions.startedAt, finishedAt),
        or(isNull(voiceSessions.endedAt), gte(voiceSessions.endedAt, startedAt)),
      ),
    );
  if (!first?.at) return 0;
  const opensAt = Math.max(startedAt.getTime(), new Date(first.at).getTime());
  return Math.max(0, finishedAt.getTime() - opensAt);
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
    // A taxa sai antes da divisão (doc-005, "Taxa do split"): o que as linhas dividem é o líquido.
    const { feeSilver, distributable } = feeBreakdown(input.totalSilver, input.fee);
    const { lines, residual } = calculateSplitDraft(candidates, distributable);

    const [split] = await tx
      .insert(lootSplits)
      .values({
        eventId: input.eventId,
        totalSilver: input.totalSilver,
        feeType: input.fee.type,
        feeValue: input.fee.value,
        feeSilver,
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
    feeSilver: split.feeSilver.toString(),
    // Recalculado da mesma fonte que a confirmação usa, então a tela nunca mostra um distribuível
    // que a confirmação não reconheceria — inclusive o zero de quando a taxa não cabe no total.
    distributableSilver: feeBreakdown(split.totalSilver, { type: split.feeType, value: split.feeValue }).distributable.toString(),
    residualSilver: split.residualSilver.toString(),
    createdByUserId: split.createdBy,
    confirmedByUserId: split.confirmedBy,
    confirmedAt: split.confirmedAt?.toISOString() ?? null,
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

/* ------------------------------------------------ edição e confirmação (TASK-028) */

/** O que toda escrita precisa carregar antes de decidir qualquer coisa. */
interface SplitContext {
  status: LootSplitStatus;
  eventStatus: EventStatus;
  eventId: string;
  ownerUserId: string;
  totalSilver: bigint;
  fee: EventFee;
}

/**
 * Trava o evento e depois o split, nessa ordem (ver o comentário do topo), e devolve o estado já
 * relido **dentro** da transação: quem decide se pode editar ou confirmar nunca decide sobre um
 * retrato tirado antes da trava.
 */
async function lockSplit(tx: EventTx, splitId: string): Promise<SplitContext | null> {
  const [head] = await tx.select({ eventId: lootSplits.eventId }).from(lootSplits).where(eq(lootSplits.id, splitId));
  if (!head) return null;
  const [event] = await tx.select({ status: events.status, ownerUserId: events.ownerUserId }).from(events).where(eq(events.id, head.eventId)).for("update");
  if (!event) return null;
  const [split] = await tx
    .select({ status: lootSplits.status, totalSilver: lootSplits.totalSilver, feeType: lootSplits.feeType, feeValue: lootSplits.feeValue })
    .from(lootSplits)
    .where(eq(lootSplits.id, splitId))
    .for("update");
  if (!split) return null;
  return {
    status: split.status,
    eventStatus: event.status,
    eventId: head.eventId,
    ownerUserId: event.ownerUserId,
    totalSilver: split.totalSilver,
    fee: { type: split.feeType, value: split.feeValue },
  };
}

/** Linhas do split na ordem estável de sempre, com o que a conferência precisa. */
async function splitLinesFor(tx: EventTx, splitId: string) {
  return tx
    .select({ id: lootSplitLines.id, userId: lootSplitLines.userId, signedUp: lootSplitLines.signedUp, shareBp: lootSplitLines.shareBp })
    .from(lootSplitLines)
    .where(eq(lootSplitLines.splitId, splitId))
    .orderBy(asc(lootSplitLines.id));
}

export interface UpdateLootSplitInput {
  /** Novo total bruto da leva. Ausente mantém o que está lá. */
  totalSilver?: bigint;
  /** Nova participação por linha. Quando vem, precisa cobrir **todas** as linhas do split. */
  lines?: readonly { id: string; shareBp: number }[];
}

export type UpdateLootSplitResult =
  | { ok: true; split: LootSplitDto }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_draft"; status: LootSplitStatus }
  | { ok: false; reason: "event_not_editable"; status: EventStatus }
  | { ok: false; reason: "unknown_lines" }
  | { ok: false; reason: "share_without_signup" };

/**
 * Edita o rascunho: total da leva e/ou percentuais (AC#1).
 *
 * A soma **não** é exigida aqui de propósito — durante a edição ela passa por estados intermediários
 * o tempo todo, e travar cada passo tornaria a tela impossível de usar. Quem exige 100% é a
 * confirmação (Q22), que é onde a prata de fato nasce.
 *
 * O que é exigido: o split ainda ser rascunho (confirmado é imutável — a trigger recusaria de
 * qualquer jeito) e o evento ainda estar `finished` (arquivado não aceita nada, Q26). Se `lines` vem,
 * ela precisa cobrir exatamente as linhas deste split: participação é bolo fechado, e aceitar uma
 * lista parcial deixaria o resto num valor que ninguém escolheu.
 */
export async function updateLootSplitDraft(db: Database, splitId: string, input: UpdateLootSplitInput): Promise<UpdateLootSplitResult> {
  const updated = await db.transaction(async (tx) => {
    const ctx = await lockSplit(tx, splitId);
    if (!ctx) return { ok: false as const, reason: "not_found" as const };
    if (ctx.status !== "draft") return { ok: false as const, reason: "not_draft" as const, status: ctx.status };
    if (ctx.eventStatus !== "finished") return { ok: false as const, reason: "event_not_editable" as const, status: ctx.eventStatus };

    const lines = await splitLinesFor(tx, splitId);
    if (input.lines) {
      const wanted = new Map(input.lines.map((line) => [line.id, line.shareBp]));
      if (wanted.size !== lines.length || lines.some((line) => !wanted.has(line.id))) return { ok: false as const, reason: "unknown_lines" as const };
      for (const line of lines) line.shareBp = wanted.get(line.id)!;
    }
    // Mesma regra do CHECK do banco (Q7), só que com uma frase em vez de um erro de constraint.
    if (lines.some((line) => !line.signedUp && line.shareBp > 0)) return { ok: false as const, reason: "share_without_signup" as const };

    const totalSilver = input.totalSilver ?? ctx.totalSilver;
    const { feeSilver, distributable } = feeBreakdown(totalSilver, ctx.fee);
    const { amounts, residual } = distributeByShare(
      lines.map((line) => line.shareBp),
      distributable,
    );
    for (const [index, line] of lines.entries())
      await tx
        .update(lootSplitLines)
        .set({ shareBp: line.shareBp, amountSilver: amounts[index]! })
        .where(eq(lootSplitLines.id, line.id));
    await tx.update(lootSplits).set({ totalSilver, feeSilver, residualSilver: residual, updatedAt: new Date() }).where(eq(lootSplits.id, splitId));
    return { ok: true as const };
  });
  if (!updated.ok) return updated;
  return { ok: true, split: (await getLootSplit(db, splitId))! };
}

export interface ConfirmLootSplitInput {
  actorUserId: string | null;
  at?: Date;
  /**
   * Split pago no jogo (TASK-081, SP1 a SP5). Ausente = comportamento de antes: só crédito. Presente, cada
   * linha listada ganha, **na mesma transação**, um saque já liquidado do mesmo valor, e a taxa + sobra do
   * dono entra paga automaticamente (SP3). `markedBy` é quem marcou: vira `decided_by` e `settled_by` do
   * saque, então é obrigatório — o banco recusa `settled` sem dono (Q11).
   */
  paidInGame?: { lineIds: readonly string[]; markedBy: string };
}

/** Um saque que nasceu liquidado na confirmação: é o que a timeline publica (SP6). */
export interface PaidInGameWithdrawal {
  withdrawalId: string;
  ledgerEntryId: string;
  userId: string;
  amount: bigint;
  /** Linha do split paga; `null` quando é a taxa + sobra do dono (SP3). */
  lineId: string | null;
}

export type ConfirmLootSplitResult =
  | { ok: true; split: LootSplitDto; alreadyConfirmed: boolean; paidInGame: PaidInGameWithdrawal[] }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "unknown_lines" }
  | { ok: false; reason: "event_not_editable"; status: EventStatus }
  | { ok: false; reason: "refused"; refusal: SplitConfirmRefusal };

/**
 * Confirma o split e **lança a prata no ledger**, numa transação só (AC#2, AC#4).
 *
 * O que entra no ledger, e nada além disso:
 * - um `split_payout` por participante com prata > 0, creditado na conta dele;
 * - um `split_fee` com **taxa + resíduo** para o caller/dono do evento (Q23, doc-005 "Taxa do split").
 *   É um lançamento só porque os dois valores têm a mesma justificativa e o mesmo destino; separá-los
 *   deixaria o extrato do dono com duas linhas para o mesmo split sem explicar nada a mais.
 *
 * A soma dos créditos é **exatamente** o total do split: o distribuível vai todo para as linhas, o que
 * o truncamento deixa para trás é o resíduo, e resíduo + taxa é o crédito do dono.
 *
 * **Idempotência** (AC#4): a transação trava a linha do split com `for update` antes de olhar o
 * status. Duas confirmações simultâneas não leem o mesmo estado — a segunda só roda depois que a
 * primeira commitou, lê `confirmed` e volta `alreadyConfirmed`, sem lançar nada. É a mesma defesa que
 * o saque usa, e é por isso que o teste de concorrência roda contra Postgres de verdade, não contra um
 * mock: o que garante o resultado é o banco, não o JavaScript.
 *
 * Confirmado, o split vira imutável de verdade: triggers no Postgres recusam UPDATE e DELETE nele e
 * nas linhas dele. Corrigir é estornar (`reverseLootSplit`), nunca reescrever.
 */
export async function confirmLootSplit(db: Database, splitId: string, input: ConfirmLootSplitInput): Promise<ConfirmLootSplitResult> {
  const at = input.at ?? new Date();
  const done = await db.transaction(async (tx) => {
    const ctx = await lockSplit(tx, splitId);
    if (!ctx) return { ok: false as const, reason: "not_found" as const };
    // SP4: a segunda confirmação não marca nada como pago — nem se vier com outra lista.
    if (ctx.status === "confirmed") return { ok: true as const, alreadyConfirmed: true, paidInGame: [] };
    if (ctx.eventStatus !== "finished") return { ok: false as const, reason: "event_not_editable" as const, status: ctx.eventStatus };

    const lines = await splitLinesFor(tx, splitId);
    const paidLineIds = new Set(input.paidInGame?.lineIds ?? []);
    // Linha de outro split (ou inventada) não é "desmarcada por engano": é pedido errado, e nada é lançado.
    if ([...paidLineIds].some((id) => !lines.some((line) => line.id === id))) return { ok: false as const, reason: "unknown_lines" as const };
    const checked = checkSplitConfirm(lines, ctx.totalSilver, ctx.fee);
    if (!checked.ok) return { ok: false as const, reason: "refused" as const, refusal: checked.reason };
    const { fee, amounts, residual, ownerSilver } = checked.plan;

    // Reescreve a prata das linhas com a conta final: é o que o extrato vai ter que bater depois.
    for (const [index, line] of lines.entries())
      await tx.update(lootSplitLines).set({ amountSilver: amounts[index]! }).where(eq(lootSplitLines.id, line.id));

    // Loot split paga **prata** (Q23): a Buffunfa do evento é outra coisa, e não nasce aqui.
    const reference = { referenceType: "loot_split" as const, referenceId: splitId, createdBy: input.actorUserId, currency: "silver" as const };
    const values: (typeof ledgerEntries.$inferInsert)[] = [];
    for (const [index, line] of lines.entries()) {
      const amount = amounts[index]!;
      // Sem conta no painel não há para quem creditar, e o ledger recusa lançamento de zero.
      if (line.userId === null || amount <= 0n) continue;
      values.push({ userId: line.userId, amount, kind: "split_payout", ...reference, memo: "Loot split do evento" });
    }
    // Taxa retida + sobra do arredondamento, num lançamento só para o caller/dono (Q23).
    if (ownerSilver > 0n) values.push({ userId: ctx.ownerUserId, amount: ownerSilver, kind: "split_fee", ...reference, memo: "Taxa e sobra do loot split" });
    if (values.length > 0) await tx.insert(ledgerEntries).values(values);

    // SP1/SP3: o saque pago no jogo nasce aqui, na transação do crédito — ou os dois existem, ou nenhum.
    const paid: { userId: string; amount: bigint; lineId: string | null }[] = [];
    if (input.paidInGame) {
      for (const [index, line] of lines.entries()) {
        const amount = amounts[index]!;
        if (paidLineIds.has(line.id) && line.userId !== null && amount > 0n) paid.push({ userId: line.userId, amount, lineId: line.id });
      }
      if (ownerSilver > 0n) paid.push({ userId: ctx.ownerUserId, amount: ownerSilver, lineId: null });
    }
    const paidInGame = input.paidInGame ? await settlePaidInGame(tx, splitId, paid, input.paidInGame.markedBy, at) : [];

    await tx
      .update(lootSplits)
      .set({ status: "confirmed", feeSilver: fee.feeSilver, residualSilver: residual, confirmedBy: input.actorUserId, confirmedAt: at, updatedAt: at })
      .where(eq(lootSplits.id, splitId));
    return { ok: true as const, alreadyConfirmed: false, paidInGame };
  });
  if (!done.ok) return done;
  return { ok: true, split: (await getLootSplit(db, splitId))!, alreadyConfirmed: done.alreadyConfirmed, paidInGame: done.paidInGame };
}

/** Memo do débito no extrato: diz que a prata já saiu, e por onde (AC#3). */
export const PAID_IN_GAME_MEMO = "Sacado: pago no jogo na divisão do loot split";

/**
 * Grava os saques pagos no jogo **já liquidados** (TASK-081, SP1). Não passa pela máquina
 * `pending → approved → settled`: ela existe para a staff aprovar prata que ainda está no painel, e aqui a
 * prata já saiu no jogo. O que não muda é o que os CHECKs de `withdrawals` exigem de um `settled`, e a
 * linha nasce cumprindo todos:
 * - `ledger_entry_id` preenchido (`withdrawals_ledger_entry_consistent`): o débito é um lançamento **novo**
 *   `withdrawal`, com `reference_type = 'withdrawal'` apontando para o saque, como na aprovação;
 * - `decided_by`/`decided_at` juntos e não nulos (`withdrawals_decision_consistent`,
 *   `withdrawals_decided_when_not_pending`): quem marcou é quem "aprovou";
 * - `settled_by`/`settled_at`/`settlement_note` (`withdrawals_settlement_consistent`): quem marcou, a hora
 *   da confirmação e a nota que aponta o split.
 *
 * O id do saque é gerado aqui para o lançamento já nascer apontando para ele (o ledger não aceita UPDATE
 * depois). Sem conferência de saldo: o crédito do mesmo valor acabou de entrar nesta transação, e o saldo
 * líquido da leva é zero por construção — recusar por saldo negativo anterior (Q24) faria o painel mentir
 * sobre uma prata que já mudou de mão.
 */
async function settlePaidInGame(
  tx: EventTx,
  splitId: string,
  paid: readonly { userId: string; amount: bigint; lineId: string | null }[],
  markedBy: string,
  at: Date,
): Promise<PaidInGameWithdrawal[]> {
  if (paid.length === 0) return [];
  const planned = paid.map((p) => ({ ...p, withdrawalId: randomUUID() }));
  const entries = await tx
    .insert(ledgerEntries)
    .values(
      planned.map((p) => ({
        userId: p.userId,
        amount: -p.amount,
        currency: "silver" as const,
        kind: "withdrawal" as const,
        referenceType: "withdrawal" as const,
        referenceId: p.withdrawalId,
        createdBy: markedBy,
        memo: PAID_IN_GAME_MEMO,
      })),
    )
    .returning({ id: ledgerEntries.id, referenceId: ledgerEntries.referenceId });
  const entryOf = new Map(entries.map((e) => [e.referenceId!, e.id]));
  const note = `Pago no jogo na divisão do loot split ${splitId}`;
  await tx.insert(withdrawals).values(
    planned.map((p) => ({
      id: p.withdrawalId,
      userId: p.userId,
      amount: p.amount,
      status: "settled" as const,
      ledgerEntryId: entryOf.get(p.withdrawalId)!,
      decidedBy: markedBy,
      decidedAt: at,
      decisionNote: note,
      settledBy: markedBy,
      settledAt: at,
      settlementNote: note,
      createdAt: at,
      updatedAt: at,
    })),
  );
  return planned.map((p) => ({ withdrawalId: p.withdrawalId, ledgerEntryId: entryOf.get(p.withdrawalId)!, userId: p.userId, amount: p.amount, lineId: p.lineId }));
}

export type ReverseLootSplitResult =
  | { ok: true; reversed: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_confirmed"; status: LootSplitStatus }
  | { ok: false; reason: "already_reversed" };

/**
 * Estorna um split confirmado: a **única** correção possível (Q24).
 *
 * Cada lançamento do split ganha o seu inverso via `reverseLedgerEntry`, que é quem sabe ligar o
 * estorno ao original e recusar o segundo estorno do mesmo lançamento. Nada é editado nem apagado —
 * nem no ledger, nem no split. Tudo numa transação: um split meio estornado seria pior do que um não
 * estornado, porque o saldo de alguns participantes já teria voltado e o de outros não.
 *
 * O split continua `confirmed` depois do estorno: ele aconteceu, e o extrato mostra as duas metades.
 */
export async function reverseLootSplit(db: Database, splitId: string, options: { reason: string; actorUserId: string | null }): Promise<ReverseLootSplitResult> {
  return db.transaction(async (tx) => {
    const ctx = await lockSplit(tx, splitId);
    if (!ctx) return { ok: false as const, reason: "not_found" as const };
    if (ctx.status !== "confirmed") return { ok: false as const, reason: "not_confirmed" as const, status: ctx.status };
    const all = await listLedgerEntriesByReference(tx, "loot_split", splitId);
    // Quem já tem estorno fica de fora **antes** de tentar: no Postgres uma violação de unicidade
    // aborta a transação inteira, então descobrir pelo erro custaria o estorno dos outros.
    const reversedIds = new Set(all.filter((entry) => entry.reversalOf !== null).map((entry) => entry.reversalOf!));
    const pending = all.filter((entry) => entry.kind !== "reversal" && !reversedIds.has(entry.id));
    if (pending.length === 0) return { ok: false as const, reason: "already_reversed" as const };
    for (const entry of pending) {
      const result = await reverseLedgerEntry(tx, entry.id, { reason: options.reason, actorUserId: options.actorUserId });
      if (!result.ok) throw new Error(`estorno do split ${splitId} falhou em ${entry.id}: ${result.reason}`);
    }
    return { ok: true as const, reversed: pending.length };
  });
}

/**
 * Existe split **confirmado** neste evento? A prova de AC#5 mora na máquina de estados (`finished` só
 * vai para `archived`, nunca para `cancelled`), mas quem lê o evento quer saber disso sem refazer a
 * consulta — e um dia a máquina pode mudar.
 */
export async function hasConfirmedLootSplit(db: Database | EventTx, eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: lootSplits.id })
    .from(lootSplits)
    .where(and(eq(lootSplits.eventId, eventId), ne(lootSplits.status, "draft")))
    .limit(1);
  return rows.length > 0;
}
