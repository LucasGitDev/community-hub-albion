import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  banUser,
  createDb,
  createSession,
  findValidSession,
  getBanStatus,
  getLedgerBalance,
  getLeftGuildAt,
  grantRole,
  insertLedgerEntry,
  listRoles,
  requestWithdrawal,
  runGuildCleanup,
  runMigrations,
  schema,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da limpeza diária não podem ser pulados");

/**
 * Limpeza diária de quem saiu do servidor (TASK-049, Postgres real).
 *
 * As garantias que não podem depender do serviço: idempotência, dinheiro intocado, banimento
 * preservado e — o mais importante — o disjuntor que impede uma leitura ruim do Discord de esvaziar a
 * comunidade inteira.
 */
describe.skipIf(!baseUrl)("limpeza diária (TASK-049, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;
  const nextDiscordId = () => `9400000000000000${String(++seq).padStart(2, "0")}`;
  const NOW = new Date("2026-09-18T04:00:00.000Z");

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_guild_cleanup`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  /**
   * O disjuntor olha a guilda inteira, então cada teste precisa partir de um estado conhecido. Contas
   * de testes anteriores somem; as que têm lançamento no ledger não podem ser apagadas (a tabela é
   * append-only e recusa até TRUNCATE), então ficam marcadas como já inativas — inertes para a passada.
   */
  async function reset() {
    await handle.db.execute(sql`delete from users where id not in (select user_id from ledger_entries union select created_by from ledger_entries where created_by is not null)`);
    await handle.db.execute(sql`update users set left_guild_at = now() where left_guild_at is null`);
  }

  async function user(roles: ("member" | "caller" | "staff" | "admin")[] = ["member"]) {
    const discordId = nextDiscordId();
    const created = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, created.id, role);
    return { ...created, discordId };
  }

  const present = (...ids: string[]) => runGuildCleanup(handle.db, { presentDiscordIds: ids, now: NOW });

  it("quem saiu perde sessões e papéis e fica marcado com a data (AC#2)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const ficou = await user();
    const saiu = await user(["member", "caller"]);
    const sessao = await createSession(handle.db, saiu.id, new Date(Date.now() + 3_600_000));

    const result = await present(admin.discordId, ficou.discordId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deactivated).toHaveLength(1);
    expect(result.deactivated[0]).toMatchObject({ userId: saiu.id, discordId: saiu.discordId, sessionsRevoked: 1 });
    expect(result.deactivated[0]!.rolesRemoved.sort()).toEqual(["caller", "member"]);
    expect(await findValidSession(handle.db, sessao.token)).toBeNull();
    expect(await listRoles(handle.db, saiu.id)).toEqual([]);
    expect(await getLeftGuildAt(handle.db, saiu.id)).toEqual(NOW);
  });

  it("quem continua no servidor não é afetado (AC#3)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const ficou = await user(["staff"]);
    const sessao = await createSession(handle.db, ficou.id, new Date(Date.now() + 3_600_000));
    const saiu = await user();

    await present(admin.discordId, ficou.discordId);

    expect(await findValidSession(handle.db, sessao.token)).not.toBeNull();
    expect(await listRoles(handle.db, ficou.id)).toEqual(["staff"]);
    expect(await getLeftGuildAt(handle.db, ficou.id)).toBeNull();
    expect(await getLeftGuildAt(handle.db, saiu.id)).toEqual(NOW);
  });

  it("rodar duas vezes seguidas não muda nada na segunda (AC#1)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const saiu = await user();

    const primeira = await present(admin.discordId);
    const segunda = await present(admin.discordId);

    expect(primeira.ok && primeira.deactivated).toHaveLength(1);
    expect(segunda).toMatchObject({ ok: true, deactivated: [] });
    expect(segunda.ok && segunda.alreadyInactive).toBeGreaterThanOrEqual(1);
    expect(await getLeftGuildAt(handle.db, saiu.id)).toEqual(NOW);
  });

  it("saldo, lançamentos e saque pendente ficam exatamente como estavam (AC#4)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const saiu = await user();
    await insertLedgerEntry(handle.db, { userId: saiu.id, amount: 900_000n, kind: "adjustment", memo: "split", createdBy: admin.id });
    const saque = await requestWithdrawal(handle.db, { userId: saiu.id, amount: 100_000n });
    const saldoAntes = await getLedgerBalance(handle.db, saiu.id);
    const lancamentosAntes = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, saiu.id));

    await present(admin.discordId);

    expect(await getLedgerBalance(handle.db, saiu.id)).toBe(saldoAntes);
    expect(await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, saiu.id))).toEqual(lancamentosAntes);
    const saques = await handle.db.select().from(schema.withdrawals).where(eq(schema.withdrawals.userId, saiu.id));
    expect(saques).toHaveLength(1);
    expect(saques[0]).toMatchObject({ status: "pending" });
    expect(saque.ok).toBe(true);
  });

  it("banimento e saída são marcas independentes: a limpeza não apaga nem sobrescreve o banimento (TASK-050)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const banido = await user();
    await banUser(handle.db, { userId: banido.id, actorId: admin.id, reason: "levou prata do split" });
    const antes = await getBanStatus(handle.db, banido.id);

    await present(admin.discordId);

    expect(await getBanStatus(handle.db, banido.id)).toEqual(antes);
    expect(await getLeftGuildAt(handle.db, banido.id)).toEqual(NOW);

    // E a volta ao servidor limpa a inatividade sem desbanir ninguém.
    await runGuildCleanup(handle.db, { presentDiscordIds: [admin.discordId, banido.discordId], now: NOW });
    expect(await getLeftGuildAt(handle.db, banido.id)).toBeNull();
    expect(await getBanStatus(handle.db, banido.id)).toEqual(antes);
  });

  it("lista vazia do Discord aborta a passada inteira sem tocar em ninguém (AC#5)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const outro = await user();
    const sessao = await createSession(handle.db, outro.id, new Date(Date.now() + 3_600_000));

    const result = await runGuildCleanup(handle.db, { presentDiscordIds: [], now: NOW });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("zero membros") });
    expect(await getLeftGuildAt(handle.db, outro.id)).toBeNull();
    expect(await getLeftGuildAt(handle.db, admin.id)).toBeNull();
    expect(await findValidSession(handle.db, sessao.token)).not.toBeNull();
    expect(await listRoles(handle.db, outro.id)).toEqual(["member"]);
  });

  it("resposta parcial (um punhado de membros de uma guilda cheia) aborta sem alterar ninguém (AC#5)", async () => {
    await reset();
    const admin = await user(["admin"]);
    const gente = [];
    for (let i = 0; i < 11; i++) gente.push(await user());

    // O Discord devolveu só duas linhas de doze: é página perdida, não êxodo.
    const result = await present(admin.discordId, gente[0]!.discordId);

    expect(result.ok).toBe(false);
    for (const u of gente) expect(await getLeftGuildAt(handle.db, u.id)).toBeNull();
    expect(await listRoles(handle.db, gente[1]!.id)).toEqual(["member"]);
  });

  it("quem voltou para o servidor perde a marca de inatividade, mas não ganha papéis de volta", async () => {
    await reset();
    const admin = await user(["admin"]);
    const vaivem = await user(["staff"]);

    await present(admin.discordId);
    expect(await getLeftGuildAt(handle.db, vaivem.id)).toEqual(NOW);

    const volta = await runGuildCleanup(handle.db, { presentDiscordIds: [admin.discordId, vaivem.discordId], now: NOW });

    expect(volta).toMatchObject({ ok: true, reactivated: 1 });
    expect(await getLeftGuildAt(handle.db, vaivem.id)).toBeNull();
    expect(await listRoles(handle.db, vaivem.id)).toEqual([]);
  });

  it("não desativa o último admin ativo: um job não pode trancar a comunidade do lado de fora", async () => {
    await reset();
    const unico = await user(["admin"]);
    const outro = await user();
    const sessao = await createSession(handle.db, unico.id, new Date(Date.now() + 3_600_000));

    const result = await present(outro.discordId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedLastAdmin).toEqual([unico.id]);
    expect(await listRoles(handle.db, unico.id)).toEqual(["admin"]);
    expect(await getLeftGuildAt(handle.db, unico.id)).toBeNull();
    expect(await findValidSession(handle.db, sessao.token)).not.toBeNull();
  });
});
