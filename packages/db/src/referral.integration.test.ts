import { REFERRAL_BONUS, REFERRAL_MONTHLY_REWARD_CAP } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  declareReferral,
  findUserByGameNick,
  getLedgerBalance,
  getMemberReferrals,
  getReferrerOf,
  listLedgerEntriesByReference,
  reverseReferral,
  runMigrations,
  schema,
  setGameNick,
  settleReferral,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de indicação não podem ser pulados");

/**
 * Indicação declarada (TASK-074, F11) contra Postgres real. O que está aqui é o que quebra dinheiro:
 * duas declarações ao mesmo tempo, o pagamento no exato instante da aprovação do nick, a décima
 * primeira do mês, e a tentativa de **trocar** o indicador já gravado — esta última provada com um
 * UPDATE cru, porque a garantia tem que ser do banco e não do serviço que por acaso chama certo.
 */
describe.skipIf(!baseUrl)("Indicação declarada (TASK-074, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;

  /** Cria um usuário. Com nick, ele já passou pelo portão da aprovação da staff; sem nick, ainda não. */
  const user = async (nick: string | null): Promise<{ id: string; nick: string | null }> => {
    const n = ++seq;
    const created = await upsertUserByDiscordId(handle.db, { discordId: `7410000000000000${String(n).padStart(2, "0")}`, discordUsername: `ind${n}` });
    if (nick) await setGameNick(handle.db, created.id, nick);
    return { id: created.id, nick };
  };

  /** Aprovação do nick, que é o portão que libera o pagamento (F11). */
  const approveNick = (id: string, nick: string) => setGameNick(handle.db, id, nick);

  const buffunfa = (id: string) => getLedgerBalance(handle.db, id, "buffunfa");

  /**
   * A mensagem do Postgres, não a do driver: o drizzle embrulha tudo em "Failed query", e é a causa que
   * diz qual trava recusou — o teste precisa provar que quem barrou foi o **banco**.
   */
  const rejection = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause;
      return `${cause?.message ?? (error as Error).message}`;
    }
    throw new Error("a consulta deveria ter sido recusada pelo banco");
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_referral`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("paga os dois lados quando o indicado já tem nick aprovado (declaração retroativa)", async () => {
    const referrer = await user("Indicador1");
    const referred = await user("Indicado1");

    expect(await declareReferral(handle.db, referred.id, referrer.id)).toEqual({ ok: true });
    const settled = await settleReferral(handle.db, referred.id);

    expect(settled.kind).toBe("paid");
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
    // Os dois lançamentos nasceram do mesmo evento e apontam para o indicado, que é quem carrega a indicação.
    const entries = await listLedgerEntriesByReference(handle.db, "referral", referred.id);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "referral" && e.currency === "buffunfa")).toBe(true);
  });

  it("não paga nada enquanto o nick do indicado não for aprovado, e paga na aprovação", async () => {
    const referrer = await user("Indicador2");
    const referred = await user(null);

    await declareReferral(handle.db, referred.id, referrer.id);
    expect((await settleReferral(handle.db, referred.id)).kind).toBe("pending");
    expect(await buffunfa(referrer.id)).toBe(0n);
    expect(await buffunfa(referred.id)).toBe(0n);

    await approveNick(referred.id, "Indicado2");
    expect((await settleReferral(handle.db, referred.id)).kind).toBe("paid");
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
  });

  it("declaração no exato instante da aprovação paga uma vez só", async () => {
    const referrer = await user("Indicador3");
    const referred = await user("Indicado3");
    await declareReferral(handle.db, referred.id, referrer.id);

    // Os dois caminhos que chamam `settle` disparando juntos: o da declaração e o do hook da aprovação.
    const results = await Promise.all([settleReferral(handle.db, referred.id), settleReferral(handle.db, referred.id)]);

    expect(results.filter((r) => r.kind === "paid")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "already_settled")).toHaveLength(1);
    expect(await listLedgerEntriesByReference(handle.db, "referral", referred.id)).toHaveLength(2);
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
  });

  it("duas declarações simultâneas para o mesmo indicado gravam uma só", async () => {
    const a = await user("IndicadorA");
    const b = await user("IndicadorB");
    const referred = await user("Indicado4");

    const [first, second] = await Promise.all([declareReferral(handle.db, referred.id, a.id), declareReferral(handle.db, referred.id, b.id)]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const winner = await getReferrerOf(handle.db, referred.id);
    expect([a.id, b.id]).toContain(winner?.id);
    const loser = first.ok ? second : first;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.referrer?.id).toBe(winner?.id);
  });

  it("trocar o indicador já gravado falha no banco, mesmo por UPDATE direto", async () => {
    const referrer = await user("Indicador5");
    const outro = await user("Indicador6");
    const referred = await user("Indicado5");
    await declareReferral(handle.db, referred.id, referrer.id);

    // Não passa por nenhum serviço: é a trigger `users_referred_by_write_once` que precisa recusar.
    expect(await rejection(handle.db.execute(sql`update ${schema.users} set referred_by = ${outro.id} where id = ${referred.id}`))).toMatch(/write-once/i);
    // Limpar também é troca: o campo não volta a ser nulo.
    expect(await rejection(handle.db.execute(sql`update ${schema.users} set referred_by = null where id = ${referred.id}`))).toMatch(/write-once/i);
    expect((await getReferrerOf(handle.db, referred.id))?.id).toBe(referrer.id);
  });

  it("autoindicação é impossível no banco", async () => {
    const solo = await user("Sozinho1");
    expect(await rejection(handle.db.execute(sql`update ${schema.users} set referred_by = id, referred_at = now() where id = ${solo.id}`))).toMatch(
      /users_referred_by_not_self/,
    );
  });

  it("da décima primeira do mês em diante o indicador não recebe, e o indicado recebe assim mesmo", async () => {
    const referrer = await user("IndicadorTeto");

    for (let i = 0; i < REFERRAL_MONTHLY_REWARD_CAP; i += 1) {
      const referred = await user(`Cheio${i}`);
      await declareReferral(handle.db, referred.id, referrer.id);
      expect((await settleReferral(handle.db, referred.id)).kind).toBe("paid");
    }
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer * BigInt(REFERRAL_MONTHLY_REWARD_CAP));

    const excedente = await user("Excedente1");
    await declareReferral(handle.db, excedente.id, referrer.id);
    const settled = await settleReferral(handle.db, excedente.id);

    expect(settled).toMatchObject({ kind: "paid_referred_only", reason: "monthly_cap" });
    // O indicador parou de receber; quem acabou de chegar não paga pelo limite de outra pessoa.
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer * BigInt(REFERRAL_MONTHLY_REWARD_CAP));
    expect(await buffunfa(excedente.id)).toBe(REFERRAL_BONUS.referred);
    // A indicação ficou registrada e liquidada, só não pagou o indicador.
    const referrals = await getMemberReferrals(handle.db, excedente.id);
    expect(referrals.declared).toMatchObject({ referrerPaid: false });
    expect(referrals.declared?.rewardedAt).not.toBeNull();
  });

  it("indicador banido ou fora do servidor: a indicação vale e só o indicado recebe", async () => {
    const banido = await user("IndicadorBanido");
    await handle.db.update(schema.users).set({ bannedAt: sql`now()` }).where(eq(schema.users.id, banido.id));
    const referred = await user("Indicado6");
    await declareReferral(handle.db, referred.id, banido.id);

    expect(await settleReferral(handle.db, referred.id)).toMatchObject({ kind: "paid_referred_only", reason: "unavailable" });
    expect(await buffunfa(banido.id)).toBe(0n);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
    expect((await getReferrerOf(handle.db, referred.id))?.id).toBe(banido.id);
  });

  it("a staff lê as indicações do membro e estorna uma paga por engano", async () => {
    const referrer = await user("IndicadorEstorno");
    const staff = await user("StaffEstorno");
    const referred = await user("IndicadoEstorno");
    await declareReferral(handle.db, referred.id, referrer.id);
    await settleReferral(handle.db, referred.id);

    const antes = await getMemberReferrals(handle.db, referrer.id);
    expect(antes.made).toHaveLength(1);
    expect(antes.rewardedThisMonth).toBe(1);

    const reversed = await reverseReferral(handle.db, referred.id, { reason: "nick errado: o bônus foi para outra pessoa", actorUserId: staff.id });
    expect(reversed).toMatchObject({ ok: true, reversed: 2 });
    // Estorno é lançamento novo: os dois saldos voltam a zero sem nenhum UPDATE em lançamento.
    expect(await buffunfa(referrer.id)).toBe(0n);
    expect(await buffunfa(referred.id)).toBe(0n);
    expect(await listLedgerEntriesByReference(handle.db, "referral", referred.id)).toHaveLength(4);
    // A indicação continua registrada: o que se desfez foi o pagamento.
    const depois = await getMemberReferrals(handle.db, referred.id);
    expect(depois.declared).toMatchObject({ reversed: true });
    expect(depois.declared?.referrer.id).toBe(referrer.id);

    expect(await reverseReferral(handle.db, referred.id, { reason: "de novo", actorUserId: staff.id })).toMatchObject({ ok: false, reason: "already_reversed" });
  });

  it("estorno recusa quem não declarou e quem ainda não recebeu", async () => {
    const semIndicacao = await user("SemIndicacao");
    expect(await reverseReferral(handle.db, semIndicacao.id, { reason: "x", actorUserId: null })).toMatchObject({ ok: false, reason: "not_found" });

    const referrer = await user("IndicadorPendente");
    const pendente = await user(null);
    await declareReferral(handle.db, pendente.id, referrer.id);
    expect(await reverseReferral(handle.db, pendente.id, { reason: "x", actorUserId: null })).toMatchObject({ ok: false, reason: "not_paid" });
  });

  it("acha o indicador pelo nick sem diferenciar caixa, e não acha quem não tem conta", async () => {
    const referrer = await user("CaixaAlta");
    expect((await findUserByGameNick(handle.db, "caixaalta"))?.id).toBe(referrer.id);
    expect(await findUserByGameNick(handle.db, "NaoExisteNoPainel")).toBeNull();
  });
});
