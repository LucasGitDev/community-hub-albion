import { REFERRAL_BONUS, REFERRAL_LEDGER_MEMO, REFERRAL_MONTHLY_REWARD_CAP, type ReferrerSkipReason } from "@albion-hub/shared";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "./client.js";
import { insertLedgerEntry, reverseLedgerEntry } from "./ledger-repo.js";
import { memberNick } from "./member-nick.js";
import { ledgerEntries, users } from "./schema.js";

/**
 * Indicação declarada (TASK-074, F11). A indicação **mora na linha do indicado** (`users.referred_by`),
 * não numa tabela de convites: é isso que faz "declarar depois" ser um caso normal, para sempre.
 *
 * Duas garantias são do banco e não deste arquivo:
 * - **write-once**: a trigger `users_referred_by_write_once` recusa trocar um `referred_by` já preenchido;
 * - **autoindicação**: o check `users_referred_by_not_self` recusa `referred_by = id`.
 *
 * O que este arquivo garante é a corrida: gravação por UPDATE condicional (`where referred_by is null`)
 * e pagamento por UPDATE condicional (`where referral_rewarded_at is null`), os dois dentro da mesma
 * transação dos lançamentos. Dois pedidos simultâneos terminam com uma indicação e um pagamento.
 */

/** Origem dos lançamentos de indicação: aponta sempre para o **indicado**, que é quem carrega a indicação. */
export const referralReference = (referredUserId: string) => ({ type: "referral" as const, id: referredUserId });

export interface ReferralPerson {
  id: string;
  name: string;
  gameNick: string | null;
}

const personColumns = (t: typeof users) => ({ id: t.id, name: memberNick(t), gameNick: t.gameNick });

/** Acha alguém pelo nick aprovado (a chave que o indicado digita). Nick do Albion não diferencia caixa. */
export async function findUserByGameNick(db: Database, nick: string): Promise<(ReferralPerson & { bannedAt: Date | null; leftGuildAt: Date | null }) | null> {
  const [row] = await db
    .select({ ...personColumns(users), bannedAt: users.bannedAt, leftGuildAt: users.leftGuildAt })
    .from(users)
    .where(sql`lower(${users.gameNick}) = lower(${nick})`)
    .limit(1);
  return row ? { ...row, name: row.name ?? nick } : null;
}

/**
 * Indicador pelo ID do Discord (TASK-075): é a chave que o seletor de membros (@) do slash command
 * entrega. Diferente do nick, não tem grafia — quem escolheu da lista não erra. Qualquer conta do
 * painel serve como indicador, com ou sem nick aprovado; o nick aprovado que importa para o pagamento
 * é o do **indicado**.
 */
export async function findUserByDiscordId(db: Database, discordId: string): Promise<(ReferralPerson & { bannedAt: Date | null; leftGuildAt: Date | null }) | null> {
  const [row] = await db
    .select({ ...personColumns(users), bannedAt: users.bannedAt, leftGuildAt: users.leftGuildAt })
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);
  return row ? { ...row, name: row.name ?? discordId } : null;
}

export type DeclareReferralResult = { ok: true } | { ok: false; reason: "already_declared"; referrer: ReferralPerson | null };

/**
 * Grava quem indicou. UPDATE condicional em `referred_by is null`: de duas declarações simultâneas para a
 * mesma pessoa só uma acha a linha, a outra volta `already_declared` — a corrida é resolvida pelo banco.
 * Nunca sobrescreve: se por algum caminho um UPDATE tentasse trocar, a trigger derruba a transação.
 */
export async function declareReferral(db: Database, referredUserId: string, referrerUserId: string): Promise<DeclareReferralResult> {
  const [row] = await db
    .update(users)
    .set({ referredBy: referrerUserId, referredAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(users.id, referredUserId), isNull(users.referredBy)))
    .returning({ id: users.id });
  if (row) return { ok: true };
  return { ok: false, reason: "already_declared", referrer: await getReferrerOf(db, referredUserId) };
}

/** Quem indicou este membro (para a mensagem de recusa da segunda tentativa). */
export async function getReferrerOf(db: Database, referredUserId: string): Promise<ReferralPerson | null> {
  const referrer = alias(users, "referrer");
  const [row] = await db
    .select({ id: referrer.id, name: memberNick(referrer), gameNick: referrer.gameNick })
    .from(users)
    .innerJoin(referrer, eq(referrer.id, users.referredBy))
    .where(eq(users.id, referredUserId));
  return row ? { ...row, name: row.name ?? "—" } : null;
}

export type SettleReferralResult =
  | { kind: "not_declared" }
  /** Declarada, mas o nick do indicado ainda não foi aprovado: quem paga é a aprovação. */
  | { kind: "pending" }
  | { kind: "already_settled" }
  | { kind: "paid"; referrer: ReferralPerson }
  | { kind: "paid_referred_only"; referrer: ReferralPerson; reason: ReferrerSkipReason };

/**
 * Liquida a indicação: **o que acontecer por último dispara**. Chamado tanto na declaração (paga na hora
 * quando o nick já está aprovado) quanto na aprovação do nick (paga a declaração que estava esperando).
 *
 * Tudo numa transação: ou os dois lançamentos existem, ou nenhum. A trava de idempotência é o UPDATE
 * condicional em `referral_rewarded_at is null`, feito **antes** dos inserts — declarar no exato instante
 * da aprovação resulta em um pagamento, não dois.
 *
 * O teto de {@link REFERRAL_MONTHLY_REWARD_CAP} é do **indicador**: estourado, ele não recebe, e o indicado
 * recebe assim mesmo. O mesmo vale para indicador banido ou fora do servidor. A contagem do mês é feita com
 * a linha do indicador travada (`for update`), senão duas liquidações simultâneas contariam o mesmo décimo.
 */
export async function settleReferral(db: Database, referredUserId: string): Promise<SettleReferralResult> {
  return db.transaction(async (tx) => {
    const [referred] = await tx
      .select({ id: users.id, gameNick: users.gameNick, referredBy: users.referredBy, rewardedAt: users.referralRewardedAt, name: memberNick(users) })
      .from(users)
      .where(eq(users.id, referredUserId))
      .for("update");
    if (!referred?.referredBy) return { kind: "not_declared" };
    if (referred.rewardedAt) return { kind: "already_settled" };
    // O portão que já existe: sem nick aprovado, a pessoa ainda não "existe de verdade" e nada é pago (F11).
    if (!referred.gameNick) return { kind: "pending" };

    const [referrerRow] = await tx
      .select({ ...personColumns(users), bannedAt: users.bannedAt, leftGuildAt: users.leftGuildAt })
      .from(users)
      .where(eq(users.id, referred.referredBy))
      .for("update");
    if (!referrerRow) return { kind: "not_declared" };
    const referrer: ReferralPerson = { id: referrerRow.id, name: referrerRow.name ?? "—", gameNick: referrerRow.gameNick };

    const inactive = referrerRow.bannedAt !== null || referrerRow.leftGuildAt !== null;
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.referredBy, referrer.id),
          eq(users.referralReferrerPaid, true),
          sql`${users.referralRewardedAt} >= date_trunc('month', now() at time zone 'utc')`,
        ),
      );
    const skip: ReferrerSkipReason | null = inactive ? "unavailable" : count >= REFERRAL_MONTHLY_REWARD_CAP ? "monthly_cap" : null;

    const [claimed] = await tx
      .update(users)
      .set({ referralRewardedAt: sql`now()`, referralReferrerPaid: skip === null, updatedAt: sql`now()` })
      .where(and(eq(users.id, referredUserId), isNull(users.referralRewardedAt)))
      .returning({ id: users.id });
    // Perdeu a corrida para outra liquidação da mesma indicação: sai sem lançar nada.
    if (!claimed) return { kind: "already_settled" };

    const reference = referralReference(referredUserId);
    await insertLedgerEntry(tx, {
      userId: referredUserId,
      amount: REFERRAL_BONUS.referred,
      currency: "buffunfa",
      kind: "referral",
      reference,
      memo: REFERRAL_LEDGER_MEMO.referred(referrer.gameNick ?? referrer.name),
    });
    if (skip === null) {
      await insertLedgerEntry(tx, {
        userId: referrer.id,
        amount: REFERRAL_BONUS.referrer,
        currency: "buffunfa",
        kind: "referral",
        reference,
        memo: REFERRAL_LEDGER_MEMO.referrer(referred.gameNick),
      });
      return { kind: "paid", referrer };
    }
    return { kind: "paid_referred_only", referrer, reason: skip };
  });
}

export interface ReferralRow {
  referred: ReferralPerson;
  referrer: ReferralPerson;
  declaredAt: Date;
  rewardedAt: Date | null;
  referrerPaid: boolean;
  reversed: boolean;
}

const referrerAlias = alias(users, "referrer");

const referralSelect = {
  referredId: users.id,
  referredName: memberNick(users),
  referredNick: users.gameNick,
  referrerId: referrerAlias.id,
  referrerName: memberNick(referrerAlias),
  referrerNick: referrerAlias.gameNick,
  declaredAt: users.referredAt,
  rewardedAt: users.referralRewardedAt,
  referrerPaid: users.referralReferrerPaid,
};

type ReferralSelectRow = Awaited<ReturnType<typeof selectReferrals>>[number];

const selectReferrals = (db: Database, where: SQL | undefined) =>
  db.select(referralSelect).from(users).innerJoin(referrerAlias, eq(referrerAlias.id, users.referredBy)).where(where).orderBy(desc(users.referredAt));

const toRow = (row: ReferralSelectRow, reversed: boolean): ReferralRow => ({
  referred: { id: row.referredId, name: row.referredName ?? "—", gameNick: row.referredNick },
  referrer: { id: row.referrerId, name: row.referrerName ?? "—", gameNick: row.referrerNick },
  // O check `users_referral_declaration_consistent` garante que quem tem indicador tem data.
  declaredAt: row.declaredAt!,
  rewardedAt: row.rewardedAt,
  referrerPaid: row.referrerPaid,
  reversed,
});

/** Ids de indicação (= id do indicado) que já foram estornadas: um `reversal` na origem `referral` basta. */
async function reversedReferralIds(db: Database, referredIds: string[]): Promise<Set<string>> {
  if (referredIds.length === 0) return new Set();
  const rows = await db
    .select({ referenceId: ledgerEntries.referenceId })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.referenceType, "referral"), eq(ledgerEntries.kind, "reversal"), inArray(ledgerEntries.referenceId, referredIds)));
  return new Set(rows.flatMap((r) => (r.referenceId ? [r.referenceId] : [])));
}

export interface MemberReferrals {
  declared: ReferralRow | null;
  made: ReferralRow[];
  rewardedThisMonth: number;
}

/** O que a staff vê na ficha do membro (AC#8): quem o indicou, quem ele indicou e como está o teto do mês. */
export async function getMemberReferrals(db: Database, userId: string): Promise<MemberReferrals> {
  const declaredRows = await selectReferrals(db, eq(users.id, userId));
  const madeRows = await selectReferrals(db, eq(users.referredBy, userId));
  const reversed = await reversedReferralIds(db, [...declaredRows, ...madeRows].map((r) => r.referredId));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.referredBy, userId), eq(users.referralReferrerPaid, true), sql`${users.referralRewardedAt} >= date_trunc('month', now() at time zone 'utc')`));
  return {
    declared: declaredRows[0] ? toRow(declaredRows[0], reversed.has(declaredRows[0].referredId)) : null,
    made: madeRows.map((r) => toRow(r, reversed.has(r.referredId))),
    rewardedThisMonth: row?.count ?? 0,
  };
}

export type ReverseReferralResult =
  | { ok: true; reversed: number; referral: ReferralRow }
  | { ok: false; reason: "not_found" | "not_paid" | "already_reversed" };

/**
 * Estorna uma indicação paga por engano (AC#8): um `reversal` para **cada** lançamento dela, na mesma
 * transação — desfazer só um lado deixaria dinheiro de pé sem contrapartida. O original nunca é tocado,
 * e o campo `referred_by` **continua gravado**: a indicação aconteceu, o que se desfaz é o pagamento.
 *
 * Quem já tem estorno fica de fora da seleção (`not exists`), e nenhum erro é engolido aqui de propósito:
 * dentro de uma transação, engolir uma violação de unicidade deixaria a transação abortada e a próxima
 * consulta quebraria por um motivo que não é o verdadeiro. Numa corrida de dois estornos, o índice único
 * parcial em `reversal_of` derruba a transação inteira — que é o resultado certo, já que estorno pela
 * metade seria pior do que nenhum.
 */
export async function reverseReferral(db: Database, referredUserId: string, options: { reason: string; actorUserId: string | null }): Promise<ReverseReferralResult> {
  const referrals = await getMemberReferrals(db, referredUserId);
  const referral = referrals.declared;
  if (!referral) return { ok: false, reason: "not_found" };
  if (!referral.rewardedAt) return { ok: false, reason: "not_paid" };
  return db.transaction(async (tx) => {
    const entries = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.referenceType, "referral"),
          eq(ledgerEntries.referenceId, referredUserId),
          eq(ledgerEntries.kind, "referral"),
          sql`not exists (select 1 from ${ledgerEntries} as estorno where estorno.reversal_of = ${ledgerEntries.id})`,
        ),
      );
    // Liquidada e sem lançamento pendente de estorno: alguém já estornou antes (a rota é idempotente na recusa).
    if (entries.length === 0) return { ok: false, reason: "already_reversed" } as const;
    for (const entry of entries) {
      const result = await reverseLedgerEntry(tx, entry.id, options);
      if (!result.ok) throw new Error(`Estorno da indicação falhou: ${result.reason}`);
    }
    return { ok: true, reversed: entries.length, referral } as const;
  });
}
