import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  banUser,
  countOtherActiveAdmins,
  createDb,
  createSession,
  findValidSession,
  getBanStatus,
  getBanStatusByDiscordId,
  getLedgerBalance,
  grantRole,
  insertLedgerEntry,
  listAdminMembers,
  runMigrations,
  schema,
  unbanUser,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de banimento não podem ser pulados");

/**
 * Banimento no banco (TASK-050, Postgres real).
 *
 * As garantias que não podem depender do controller: auto-banimento, último admin, sessões revogadas na
 * mesma transação e ledger intocado.
 */
describe.skipIf(!baseUrl)("banimento de jogador (TASK-050, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;
  const nextDiscordId = () => `9200000000000000${String(++seq).padStart(2, "0")}`;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_bans`;
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

  async function user(roles: ("member" | "caller" | "staff" | "admin")[] = ["member"]) {
    const discordId = nextDiscordId();
    const created = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-3)}` });
    for (const role of roles) await grantRole(handle.db, created.id, role);
    return { ...created, discordId };
  }

  it("marca a conta com motivo, autor e data e apaga todas as sessões na mesma operação", async () => {
    const actor = await user(["admin"]);
    const alvo = await user();
    const s1 = await createSession(handle.db, alvo.id, new Date(Date.now() + 3_600_000));
    const s2 = await createSession(handle.db, alvo.id, new Date(Date.now() + 3_600_000));
    expect(await findValidSession(handle.db, s1.token)).not.toBeNull();

    const result = await banUser(handle.db, { userId: alvo.id, actorId: actor.id, reason: "roubou o loot do split" });
    expect(result).toMatchObject({ ok: true, discordId: alvo.discordId, sessionsRevoked: 2 });

    expect(await findValidSession(handle.db, s1.token)).toBeNull();
    expect(await findValidSession(handle.db, s2.token)).toBeNull();
    expect(await getBanStatus(handle.db, alvo.id)).toMatchObject({ banReason: "roubou o loot do split", bannedBy: actor.id });
    expect(await getBanStatusByDiscordId(handle.db, alvo.discordId)).toMatchObject({ banReason: "roubou o loot do split" });
  });

  it("banir a si mesmo é recusado antes de encostar no banco", async () => {
    const actor = await user(["admin"]);
    expect(await banUser(handle.db, { userId: actor.id, actorId: actor.id, reason: "engano" })).toEqual({ ok: false, reason: "self" });
    expect(await getBanStatus(handle.db, actor.id)).toBeNull();
  });

  it("banir duas vezes é recusado; desbanir é o único caminho de volta", async () => {
    const actor = await user(["admin"]);
    const alvo = await user();
    expect((await banUser(handle.db, { userId: alvo.id, actorId: actor.id, reason: "motivo" })).ok).toBe(true);
    expect(await banUser(handle.db, { userId: alvo.id, actorId: actor.id, reason: "outro" })).toEqual({ ok: false, reason: "already_banned" });
    expect(await unbanUser(handle.db, alvo.id)).toMatchObject({ ok: true });
    expect(await unbanUser(handle.db, alvo.id)).toEqual({ ok: false, reason: "not_banned" });
    expect(await getBanStatus(handle.db, alvo.id)).toBeNull();
  });

  it("usuário inexistente é not_found nos dois sentidos", async () => {
    const actor = await user(["admin"]);
    const fantasma = "00000000-0000-0000-0000-000000000000";
    expect(await banUser(handle.db, { userId: fantasma, actorId: actor.id, reason: "motivo" })).toEqual({ ok: false, reason: "not_found" });
    expect(await unbanUser(handle.db, fantasma)).toEqual({ ok: false, reason: "not_found" });
  });

  it("o último admin ativo não pode ser banido, e um admin já banido não conta como admin ativo", async () => {
    // Os testes acima deixam admins pelo caminho: aqui a comunidade começa com exatamente dois.
    await handle.db.delete(schema.userRoles).where(eq(schema.userRoles.role, "admin"));
    const a = await user(["admin"]);
    const b = await user(["admin"]);
    const staffer = await user(["staff"]);
    expect(await countOtherActiveAdmins(handle.db, a.id)).toBe(1);

    expect((await banUser(handle.db, { userId: b.id, actorId: a.id, reason: "sumiu com a prata" })).ok).toBe(true);
    // b banido não conta mais: a virou o último e está protegido, inclusive contra a própria staff.
    expect(await countOtherActiveAdmins(handle.db, a.id)).toBe(0);
    expect(await banUser(handle.db, { userId: a.id, actorId: staffer.id, reason: "decapitar a comunidade" })).toEqual({ ok: false, reason: "last_admin" });
    expect(await getBanStatus(handle.db, a.id)).toBeNull();

    // Com b de volta, a deixa de ser o último e um outro admin pode bani-lo.
    expect((await unbanUser(handle.db, b.id)).ok).toBe(true);
    expect((await banUser(handle.db, { userId: a.id, actorId: b.id, reason: "agora pode, sobrou o b" })).ok).toBe(true);
    expect((await unbanUser(handle.db, a.id)).ok).toBe(true);
  });

  it("staff não bane staff nem admin: só um admin faz isso", async () => {
    await handle.db.delete(schema.userRoles).where(eq(schema.userRoles.role, "admin"));
    const chefe = await user(["admin"]);
    const reserva = await user(["admin"]);
    const staffer = await user(["staff"]);
    const outroStaffer = await user(["staff"]);
    const membro = await user();

    // Staff bane quem está abaixo dela.
    expect((await banUser(handle.db, { userId: membro.id, actorId: staffer.id, reason: "roubou o loot" })).ok).toBe(true);

    // E não bane par nem superior.
    expect(await banUser(handle.db, { userId: outroStaffer.id, actorId: staffer.id, reason: "briga interna" })).toEqual({ ok: false, reason: "protected_target" });
    expect(await banUser(handle.db, { userId: reserva.id, actorId: staffer.id, reason: "golpe de estado" })).toEqual({ ok: false, reason: "protected_target" });
    expect(await getBanStatus(handle.db, outroStaffer.id)).toBeNull();
    expect(await getBanStatus(handle.db, reserva.id)).toBeNull();

    // Admin bane staff e outro admin (com o último admin ainda protegido).
    expect((await banUser(handle.db, { userId: outroStaffer.id, actorId: chefe.id, reason: "decisão do admin" })).ok).toBe(true);
    expect((await banUser(handle.db, { userId: reserva.id, actorId: chefe.id, reason: "decisão do admin" })).ok).toBe(true);
  });

  it("dois banimentos simultâneos não conseguem zerar os admins", async () => {
    await handle.db.delete(schema.userRoles).where(eq(schema.userRoles.role, "admin"));
    const a = await user(["admin"]);
    const b = await user(["admin"]);

    // A comunidade tem exatamente dois admins e cada um tenta banir o outro no mesmo instante: é o
    // cenário em que a trava na tabela errada deixaria os dois passarem e sobrariam zero admins.
    // O teste guarda o invariante (sempre sobra admin); não garante reproduzir a corrida a cada rodada.
    const resultados = await Promise.allSettled([
      banUser(handle.db, { userId: b.id, actorId: a.id, reason: "banimento simultaneo de a em b" }),
      banUser(handle.db, { userId: a.id, actorId: b.id, reason: "banimento simultaneo de b em a" }),
    ]);
    // Deadlock abortado pelo Postgres também é resultado aceitável: falha fechada, ninguém a mais banido.
    expect(resultados.filter((r) => r.status === "fulfilled" && r.value.ok).length).toBeLessThanOrEqual(1);

    const admins = await handle.db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
      .where(and(eq(schema.userRoles.role, "admin"), isNull(schema.users.bannedAt)));
    expect(admins).toHaveLength(1);
  });

  it("não mexe no ledger: banir e desbanir não criam lançamento nenhum", async () => {
    const actor = await user(["admin"]);
    const alvo = await user();
    await insertLedgerEntry(handle.db, { userId: alvo.id, amount: 500_000n, kind: "adjustment", memo: "saldo", createdBy: actor.id });
    const antes = await getLedgerBalance(handle.db, alvo.id);
    const lancamentosAntes = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, alvo.id));

    await banUser(handle.db, { userId: alvo.id, actorId: actor.id, reason: "congela mas não zera" });
    await unbanUser(handle.db, alvo.id);

    expect(await getLedgerBalance(handle.db, alvo.id)).toBe(antes);
    expect(await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.userId, alvo.id))).toHaveLength(lancamentosAntes.length);
  });

  it("a lista de membros mostra o banimento e o filtro banidos só traz banidos", async () => {
    const actor = await user(["admin"]);
    const alvo = await user();
    await banUser(handle.db, { userId: alvo.id, actorId: actor.id, reason: "motivo visível na lista" });

    const page = await listAdminMembers(handle.db, { search: null, filter: "banidos", pageSize: 100, offset: 0 });
    const linha = page.members.find((m) => m.id === alvo.id);
    expect(linha!.ban).toMatchObject({ reason: "motivo visível na lista" });
    expect(linha!.ban!.byName).toBe(actor.discordUsername);
    expect(page.members.every((m) => m.ban !== null)).toBe(true);
    expect(page.counts.banidos).toBe(page.total);

    const todos = await listAdminMembers(handle.db, { search: null, filter: "todos", pageSize: 100, offset: 0 });
    expect(todos.members.some((m) => m.id === alvo.id)).toBe(true);
    expect(todos.total).toBeGreaterThan(page.total);
  });
});
