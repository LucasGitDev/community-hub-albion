import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyEventTransition,
  createDb,
  createEvent,
  getLedgerBalance,
  insertLedgerEntry,
  joinEventRole,
  leaveEvent,
  listEventRoles,
  listLedgerEntries,
  listLedgerEntriesByReference,
  moveEventSignup,
  runMigrations,
  saveEventTemplate,
  schema,
  setEventEntryFee,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

/**
 * Taxa de entrada em Buffunfa contra Postgres real (TASK-058, F6-12 a F6-16).
 *
 * O que estes testes provam, e que nenhuma leitura de código prova: que a cobrança e a vaga são a
 * **mesma** transação (dois inscritos concorrentes com saldo para um só), que devolver é **estornar**
 * (o lançamento cobrado continua lá, intacto), e que a Buffunfa cobrada **não aparece na conta de
 * ninguém** — a soma de tudo que circula diminui exatamente o que foi cobrado (F6-16).
 */

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da taxa de entrada não podem ser pulados");

describe.skipIf(!baseUrl)("taxa de entrada em Buffunfa (TASK-058, Postgres real)", () => {
  let handle: DbHandle;
  let templateId: string;
  let owner: string;
  let seq = 0;

  const user = async (buffunfa = 0n) => {
    const discordId = `94000000000000${String(++seq).padStart(4, "0")}`;
    const { id } = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `fee${seq}` });
    if (buffunfa > 0n) await insertLedgerEntry(handle.db, { userId: id, currency: "buffunfa", amount: buffunfa, kind: "adjustment", memo: "saldo do teste" });
    return id;
  };

  /** Soma **toda** a Buffunfa da base: é ela que tem que cair quando a taxa é cobrada (AC#5). */
  const circulating = async (): Promise<bigint> => {
    const [row] = await handle.db.execute<{ total: bigint }>(
      sql`select coalesce(sum(amount), 0)::int8 as total from ledger_entries where currency = 'buffunfa'`,
    );
    return row?.total ?? 0n;
  };

  const feeEntries = async (eventId: string, userId: string) =>
    (await listLedgerEntriesByReference(handle.db, "event", eventId)).filter((e) => e.userId === userId);

  /** Evento aberto com a taxa pedida. Tank tem 1 vaga, Healer 2 (o template abaixo). */
  const openEvent = async (name: string, entryFee: bigint) => {
    const created = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    await setEventEntryFee(handle.db, created.event.id, entryFee);
    const opened = await applyEventTransition(handle.db, created.event.id, "open");
    if (!opened.ok) throw new Error("não abriu");
    return {
      event: opened.event,
      tank: opened.event.roles.find((r) => r.name === "Tank")!,
      healer: opened.event.roles.find((r) => r.name === "Healer")!,
    };
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_entry_fee`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());

    owner = await user();
    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Conteúdo disputado",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1 },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2 },
      ],
    });
    if (!saved.ok) throw new Error(saved.reason);
    templateId = saved.template.id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("template nasce zerado e o evento herda uma cópia editável (AC#1)", async () => {
    const roles = await listEventRoles(handle.db);
    const zeroed = await saveEventTemplate(handle.db, {
      name: "Template sem taxa",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1 }],
    });
    if (!zeroed.ok) throw new Error(zeroed.reason);
    expect(zeroed.template.defaultEntryFee).toBe("0");

    // Template com taxa: o evento nasce com a cópia dela...
    const withFee = await saveEventTemplate(handle.db, { ...zeroed.template, roles: zeroed.template.roles, defaultEntryFee: 25n }, zeroed.template.id);
    if (!withFee.ok) throw new Error(withFee.reason);
    expect(withFee.template.defaultEntryFee).toBe("25");

    const created = await createEvent(handle.db, {
      templateId: withFee.template.id,
      name: "Herdou a taxa",
      description: null,
      startsAt: null,
      signupsCloseAt: null,
      ownerUserId: owner,
      createdBy: owner,
    });
    if (!created.ok) throw new Error(created.reason);
    expect(created.event.entryFee).toBe("25");

    // ...e mexer no template depois **não** mexe no evento já criado: cópia, não referência.
    await saveEventTemplate(handle.db, { ...withFee.template, roles: withFee.template.roles, defaultEntryFee: 999n }, withFee.template.id);
    const again = await createEvent(handle.db, {
      templateId: withFee.template.id,
      name: "Depois da mudança",
      description: null,
      startsAt: null,
      signupsCloseAt: null,
      ownerUserId: owner,
      createdBy: owner,
    });
    if (!again.ok) throw new Error(again.reason);
    expect(again.event.entryFee).toBe("999");
    const untouched = await setEventEntryFee(handle.db, created.event.id, 40n);
    expect(untouched?.entryFee).toBe("40");

    // Sem teto (decisão do usuário), mas negativa o banco recusa.
    const huge = await setEventEntryFee(handle.db, created.event.id, 10_000_000_000n);
    expect(huge?.entryFee).toBe("10000000000");
    await expect(handle.db.update(schema.events).set({ entryFee: -1n }).where(eq(schema.events.id, created.event.id))).rejects.toThrow();
  });

  it("a inscrição debita a taxa na hora e o débito não credita ninguém (AC#2, AC#5)", async () => {
    const { event, tank } = await openEvent("Cobra na inscrição", 20n);
    const membro = await user(50n);
    const before = await circulating();

    const joined = await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
    expect(joined).toMatchObject({ ok: true, charged: 20n, signup: { status: "confirmed" } });
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(30n);

    // Sink puro (F6-16): o único lançamento novo é o débito; a Buffunfa em circulação caiu 20.
    expect(await circulating()).toBe(before - 20n);
    const [fee] = await feeEntries(event.id, membro);
    expect(fee).toMatchObject({ amount: -20n, currency: "buffunfa", kind: "entry_fee", referenceType: "event", referenceId: event.id });
    // Nada foi creditado ao caller/dono: é o que separa esta taxa da taxa do split em prata (F6-16).
    expect(await getLedgerBalance(handle.db, owner, "buffunfa")).toBe(0n);

    // A vaga e a cobrança são a mesma linha: a inscrição aponta para o lançamento que pagou.
    const [row] = await handle.db
      .select({ feeEntryId: schema.eventSignups.feeEntryId })
      .from(schema.eventSignups)
      .where(and(eq(schema.eventSignups.eventId, event.id), eq(schema.eventSignups.userId, membro), eq(schema.eventSignups.status, "confirmed")));
    expect(row?.feeEntryId).toBe(fee!.id);
  });

  it("saldo insuficiente recusa a inscrição inteira, sem vaga e sem lançamento (AC#2)", async () => {
    const { event, tank } = await openEvent("Sem saldo", 100n);
    const membro = await user(30n);
    const before = await circulating();

    expect(await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id })).toEqual({
      ok: false,
      reason: "insufficient_funds",
      fee: 100n,
      balance: 30n,
    });
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(30n);
    expect(await circulating()).toBe(before);
    expect(await feeEntries(event.id, membro)).toEqual([]);
    const rows = await handle.db.select().from(schema.eventSignups).where(and(eq(schema.eventSignups.eventId, event.id), eq(schema.eventSignups.userId, membro)));
    expect(rows).toEqual([]);
  });

  it("duas inscrições concorrentes com saldo para uma só: uma entra e uma é recusada", async () => {
    // A corrida que importa. Sem `for update` + releitura **dentro** da transação, as duas leriam 30,
    // as duas passariam e o saldo ficaria negativo. E sem a cobrança na mesma transação da vaga,
    // existiria a janela em que o débito passou e a vaga não.
    const a = await openEvent("Corrida A", 30n);
    const b = await openEvent("Corrida B", 30n);
    const membro = await user(30n);

    const [first, second] = await Promise.all([
      joinEventRole(handle.db, { eventId: a.event.id, userId: membro, slotId: a.tank.id }),
      joinEventRole(handle.db, { eventId: b.event.id, userId: membro, slotId: b.tank.id }),
    ]);
    expect([first!.ok, second!.ok].sort()).toEqual([false, true]);
    const refused = [first!, second!].find((r) => !r.ok)!;
    expect(refused).toMatchObject({ reason: "insufficient_funds", fee: 30n, balance: 0n });

    // Saldo nunca fica negativo (F6-7), e existe **uma** cobrança: a recusada não deixou rastro.
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(0n);
    const charged = [...(await feeEntries(a.event.id, membro)), ...(await feeEntries(b.event.id, membro))];
    expect(charged).toHaveLength(1);
  });

  it("clique duplo no mesmo evento cobra uma vez só", async () => {
    const { event, healer } = await openEvent("Clique duplo", 10n);
    const membro = await user(100n);
    const results = await Promise.all([
      joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: healer.id }),
      joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: healer.id }),
    ]);
    // Uma das duas ganha a vaga; a outra cai em `already_in_role` (a trava do evento serializa as duas).
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await feeEntries(event.id, membro)).toHaveLength(1);
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(90n);
  });

  it("trocar de role e ser movido pelo caller não recobram nem devolvem", async () => {
    const { event, tank, healer } = await openEvent("Troca de role", 15n);
    const membro = await user(15n);
    await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });

    const switched = await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: healer.id });
    expect(switched).toMatchObject({ ok: true, charged: null });
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(0n);
    expect(await feeEntries(event.id, membro)).toHaveLength(1);

    const moved = await moveEventSignup(handle.db, { eventId: event.id, userId: membro, target: { kind: "waitlist" }, actorUserId: owner });
    expect(moved.ok).toBe(true);
    expect(await feeEntries(event.id, membro)).toHaveLength(1);
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(0n);
  });

  it("desistir antes do início devolve por estorno; depois do início, não (AC#3)", async () => {
    const { event, tank } = await openEvent("Desistiu cedo", 20n);
    const desiste = await user(20n);
    await joinEventRole(handle.db, { eventId: event.id, userId: desiste, slotId: tank.id });
    const [cobranca] = await feeEntries(event.id, desiste);

    const left = await leaveEvent(handle.db, { eventId: event.id, userId: desiste });
    expect(left).toMatchObject({ ok: true, refunded: 20n });
    expect(await getLedgerBalance(handle.db, desiste, "buffunfa")).toBe(20n);

    // Devolver é **estornar**: o lançamento cobrado continua exatamente como nasceu, e o estorno aponta para ele.
    const entries = await feeEntries(event.id, desiste);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: cobranca!.id, amount: -20n, kind: "entry_fee", reversalOf: null });
    expect(entries[1]).toMatchObject({ amount: 20n, kind: "reversal", reversalOf: cobranca!.id });

    // Depois do início ninguém sai — e a taxa de quem tinha a vaga fica.
    const { event: started, tank: startedTank } = await openEvent("Já começou", 20n);
    const fica = await user(20n);
    await joinEventRole(handle.db, { eventId: started.id, userId: fica, slotId: startedTank.id });
    const running = await applyEventTransition(handle.db, started.id, "running");
    expect(running.ok).toBe(true);
    expect(await leaveEvent(handle.db, { eventId: started.id, userId: fica })).toMatchObject({ ok: false, reason: "not_open" });
    expect(await getLedgerBalance(handle.db, fica, "buffunfa")).toBe(0n);
    expect(await feeEntries(started.id, fica)).toHaveLength(1);
  });

  it("quem começou o evento ainda na espera recebe de volta (decisão da TASK-058)", async () => {
    const { event, tank } = await openEvent("Espera no start", 20n);
    const dentro = await user(20n);
    const espera = await user(20n);
    await joinEventRole(handle.db, { eventId: event.id, userId: dentro, slotId: tank.id });
    const waited = await joinEventRole(handle.db, { eventId: event.id, userId: espera, slotId: tank.id });
    expect(waited).toMatchObject({ ok: true, charged: 20n, signup: { status: "waitlist" } });

    expect((await applyEventTransition(handle.db, event.id, "running")).ok).toBe(true);
    // Quem jogou pagou; quem nunca teve vaga não.
    expect(await getLedgerBalance(handle.db, dentro, "buffunfa")).toBe(0n);
    expect(await getLedgerBalance(handle.db, espera, "buffunfa")).toBe(20n);
  });

  it("cancelar o evento devolve a todos, por estorno do lançamento original (AC#4)", async () => {
    const { event, tank, healer } = await openEvent("Cancelado", 20n);
    const gente = [await user(20n), await user(20n), await user(20n)];
    await joinEventRole(handle.db, { eventId: event.id, userId: gente[0]!, slotId: tank.id });
    await joinEventRole(handle.db, { eventId: event.id, userId: gente[1]!, slotId: tank.id }); // espera
    await joinEventRole(handle.db, { eventId: event.id, userId: gente[2]!, slotId: healer.id });
    for (const id of gente) expect(await getLedgerBalance(handle.db, id, "buffunfa")).toBe(0n);
    const before = await circulating();

    const cancelled = await applyEventTransition(handle.db, event.id, "cancelled", { reason: "grupo não fechou" });
    expect(cancelled.ok).toBe(true);

    // Confirmado e em espera, os dois recebem: a lista caiu inteira, então a cobrança cai inteira.
    for (const id of gente) {
      expect(await getLedgerBalance(handle.db, id, "buffunfa")).toBe(20n);
      const entries = await feeEntries(event.id, id);
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({ kind: "reversal", amount: 20n, reversalOf: entries[0]!.id });
    }
    expect(await circulating()).toBe(before + 60n);
  });

  it("evento que cobra e paga gera dois lançamentos separados no extrato, nunca um líquido (AC#6)", async () => {
    const { event, tank } = await openEvent("Cobra e paga", 20n);
    const membro = await user(20n);
    await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
    // O ganho por participação é da TASK-057; aqui ele entra como o crédito que ela vai lançar.
    await insertLedgerEntry(handle.db, {
      userId: membro,
      currency: "buffunfa",
      amount: 15n,
      kind: "adjustment",
      reference: { type: "event", id: event.id },
      memo: "participação no evento",
    });

    const { entries } = await listLedgerEntries(handle.db, membro, "buffunfa");
    const doEvento = entries.filter((e) => e.referenceId === event.id);
    expect(doEvento.map((e) => e.amount).sort()).toEqual([-20n, 15n]);
    // O líquido negativo é o ponto (F6-15) — e ele aparece como saldo, não como uma linha só de −5.
    expect(await getLedgerBalance(handle.db, membro, "buffunfa")).toBe(15n);
    expect(doEvento).toHaveLength(2);
  });
});
