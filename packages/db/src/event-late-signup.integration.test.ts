import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLateEventSignup,
  applyEventTransition,
  createDb,
  createEvent,
  findRunningEventByVoiceChannelId,
  getLedgerBalance,
  insertLedgerEntry,
  joinEventRole,
  listEventFreeRoleSlots,
  listEventPresence,
  listEventRoles,
  openVoiceSession,
  runMigrations,
  saveEventTemplate,
  schema,
  setEventEntryFee,
  setEventVoiceChannelId,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

/**
 * Inscrição no meio da call contra Postgres real (TASK-086, PE7/PE8).
 *
 * O que estes testes provam, e que a leitura do código não prova: que `presence_from` **muda o número
 * da presença** (quem foi aceito faltando 20% do evento termina com 20%, não com 100%), que o
 * denominador continua sendo a janela inteira da call, e que aceitar no meio não é um atalho — a vaga
 * e a taxa de entrada valem igual à inscrição normal.
 */

const MIN = 60_000;
const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da inscrição no meio da call não podem ser pulados");

describe.skipIf(!baseUrl)("inscrição no meio da call (TASK-086, Postgres real)", () => {
  let handle: DbHandle;
  let templateId: string;
  let owner: string;
  let seq = 0;

  const user = async (buffunfa = 0n) => {
    const discordId = `86000000000000${String(++seq).padStart(4, "0")}`;
    const { id } = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `late${seq}` });
    if (buffunfa > 0n) await insertLedgerEntry(handle.db, { userId: id, currency: "buffunfa", amount: buffunfa, kind: "adjustment", memo: "saldo do teste" });
    return { id, discordId };
  };

  /** Evento `running` com canal de voz e `started_at` cravado: a janela de presença é conhecida. */
  const runningEvent = async (channelId: string, startedAt: Date, opts: { entryFee?: bigint; earlySignups?: string[] } = {}) => {
    const created = await createEvent(handle.db, {
      templateId,
      name: `Evento ${++seq}`,
      description: null,
      startsAt: null,
      signupsCloseAt: null,
      ownerUserId: owner,
      createdBy: owner,
    });
    if (!created.ok) throw new Error(created.reason);
    const id = created.event.id;
    if (opts.entryFee !== undefined) await setEventEntryFee(handle.db, id, opts.entryFee);
    const opened = await applyEventTransition(handle.db, id, "open");
    if (!opened.ok) throw new Error("não abriu");
    const tank = opened.event.roles.find((r) => r.name === "Tank")!;
    for (const userId of opts.earlySignups ?? []) {
      const joined = await joinEventRole(handle.db, { eventId: id, userId, slotId: tank.id });
      if (!joined.ok) throw new Error(joined.reason);
    }
    const running = await applyEventTransition(handle.db, id, "running");
    if (!running.ok) throw new Error("não iniciou");
    await setEventVoiceChannelId(handle.db, id, channelId);
    await handle.db.update(schema.events).set({ startedAt }).where(eq(schema.events.id, id));
    return { id, tank, healer: opened.event.roles.find((r) => r.name === "Healer")! };
  };

  const finish = async (eventId: string, at: Date) => {
    const done = await applyEventTransition(handle.db, eventId, "finished", { at });
    if (!done.ok) throw new Error("não finalizou");
  };

  /** Sessão de voz fechada no canal, entre dois instantes. */
  const voice = async (discordUserId: string, channelId: string, from: Date, to: Date) => {
    const session = await openVoiceSession(handle.db, { discordUserId, channelId, at: from });
    await handle.db.update(schema.voiceSessions).set({ endedAt: to }).where(eq(schema.voiceSessions.id, session.id));
  };

  const presenceOf = async (eventId: string, discordUserId: string) =>
    (await listEventPresence(handle.db, eventId)).find((p) => p.discordUserId === discordUserId);

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_late_signup`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());

    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Template da inscrição no meio",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n },
      ],
    });
    if (!saved.ok) throw new Error(saved.reason);
    templateId = saved.template.id;
    owner = (await user()).id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  describe("presença conta a partir do aceite (PE8, AC#5)", () => {
    it("quem é aceito faltando 20% do evento termina com 20%, mesmo tendo ficado a call inteira", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-01T20:00:00.000Z");
      const accept = new Date("2026-04-01T21:36:00.000Z"); // 80% de uma janela de 2 h
      const end = new Date("2026-04-01T22:00:00.000Z");
      const early = await user();
      const late = await user();
      const { id, healer } = await runningEvent(channel, start, { earlySignups: [early.id] });
      // Os dois ficaram na call do começo ao fim: a diferença é só o instante do aceite.
      await voice(early.discordId, channel, start, end);
      await voice(late.discordId, channel, start, end);

      const added = await addLateEventSignup(handle.db, { eventId: id, userId: late.id, slotId: healer.id, actorUserId: owner, at: accept });
      if (!added.ok) throw new Error(added.reason);
      expect(added.presenceFrom).toEqual(accept);
      expect(added.signup.status).toBe("confirmed");
      await finish(id, end);

      // O denominador é a call inteira (120 min): quem entrou no minuto 96 fica com os 24 que sobraram.
      expect((await presenceOf(id, late.discordId))!.presenceMs).toBe(24 * MIN);
      // E quem já estava inscrito não é afetado por nada disso.
      expect((await presenceOf(id, early.discordId))!.presenceMs).toBe(120 * MIN);
    });

    it("quem se inscreveu antes do evento continua contando desde o início da call (presence_from nulo)", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-02T20:00:00.000Z");
      const end = new Date("2026-04-02T21:00:00.000Z");
      const early = await user();
      const { id } = await runningEvent(channel, start, { earlySignups: [early.id] });
      await voice(early.discordId, channel, start, end);
      await finish(id, end);

      const [row] = await handle.db.select({ presenceFrom: schema.eventSignups.presenceFrom }).from(schema.eventSignups).where(eq(schema.eventSignups.userId, early.id));
      expect(row!.presenceFrom).toBeNull();
      expect((await presenceOf(id, early.discordId))!.presenceMs).toBe(60 * MIN);
    });

    it("aceito depois de já ter saído e voltado só conta o pedaço posterior ao aceite", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-03T20:00:00.000Z");
      const accept = new Date("2026-04-03T20:30:00.000Z");
      const end = new Date("2026-04-03T21:00:00.000Z");
      const late = await user();
      const { id, healer } = await runningEvent(channel, start);
      // Duas passagens de 20 min: uma inteira antes do aceite, outra metade antes e metade depois.
      await voice(late.discordId, channel, start, new Date("2026-04-03T20:20:00.000Z"));
      await voice(late.discordId, channel, new Date("2026-04-03T20:20:00.000Z"), new Date("2026-04-03T20:40:00.000Z"));

      const added = await addLateEventSignup(handle.db, { eventId: id, userId: late.id, slotId: healer.id, actorUserId: owner, at: accept });
      if (!added.ok) throw new Error(added.reason);
      await finish(id, end);

      expect((await presenceOf(id, late.discordId))!.presenceMs).toBe(10 * MIN);
    });

    it("sem aceite ninguém ganha presença: quem só apareceu na call fica em 0 (PE6 + AC#4)", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-04T20:00:00.000Z");
      const end = new Date("2026-04-04T21:00:00.000Z");
      const ghost = await user();
      const { id } = await runningEvent(channel, start);
      await voice(ghost.discordId, channel, start, end);
      await finish(id, end);

      const row = (await presenceOf(id, ghost.discordId))!;
      // A pessoa aparece (o caller vê que ela esteve lá), mas sem inscrição e com presença 0.
      expect(row.signedUp).toBe(false);
      expect(row.presenceBp).toBe(0);
    });
  });

  describe("regra da inscrição no meio (AC#2)", () => {
    it("inscreve confirmado, nunca na espera: role cheia é recusa", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-05T20:00:00.000Z");
      const first = await user();
      const second = await user();
      const { id, tank } = await runningEvent(channel, start, { earlySignups: [first.id] });

      // Tank tem 1 vaga só, e ela já foi.
      const full = await addLateEventSignup(handle.db, { eventId: id, userId: second.id, slotId: tank.id, actorUserId: owner });
      expect(full).toEqual({ ok: false, reason: "role_full" });
      // Nada foi gravado: a recusa não deixa inscrição na espera.
      const rows = await handle.db.select({ id: schema.eventSignups.id }).from(schema.eventSignups).where(eq(schema.eventSignups.userId, second.id));
      expect(rows).toHaveLength(0);
    });

    it("recusa quem já está no evento", async () => {
      const channel = `late-ch-${++seq}`;
      const early = await user();
      const { id, healer } = await runningEvent(channel, new Date("2026-04-06T20:00:00.000Z"), { earlySignups: [early.id] });
      expect(await addLateEventSignup(handle.db, { eventId: id, userId: early.id, slotId: healer.id, actorUserId: owner })).toEqual({
        ok: false,
        reason: "already_signed_up",
      });
    });

    it("recusa role que não é do evento e evento inexistente", async () => {
      const { id, healer } = await runningEvent(`late-ch-${++seq}`, new Date("2026-04-07T20:00:00.000Z"));
      const someone = await user();
      expect(await addLateEventSignup(handle.db, { eventId: id, userId: someone.id, slotId: "00000000-0000-4000-8000-000000000001", actorUserId: owner })).toEqual({
        ok: false,
        reason: "unknown_role",
      });
      expect(
        await addLateEventSignup(handle.db, { eventId: "00000000-0000-4000-8000-000000000002", userId: someone.id, slotId: healer.id, actorUserId: owner }),
      ).toEqual({ ok: false, reason: "not_found" });
    });

    it("evento finalizado não aceita mais ninguém", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-08T20:00:00.000Z");
      const { id, healer } = await runningEvent(channel, start);
      await finish(id, new Date("2026-04-08T21:00:00.000Z"));
      const late = await user();
      expect(await addLateEventSignup(handle.db, { eventId: id, userId: late.id, slotId: healer.id, actorUserId: owner })).toEqual({
        ok: false,
        reason: "not_running",
        status: "finished",
      });
    });

    it("cobra a taxa de entrada igual à inscrição normal, e sem saldo não inscreve ninguém", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-09T20:00:00.000Z");
      const { id, healer } = await runningEvent(channel, start, { entryFee: 40n });
      const rich = await user(100n);
      const broke = await user(10n);

      const paid = await addLateEventSignup(handle.db, { eventId: id, userId: rich.id, slotId: healer.id, actorUserId: owner });
      if (!paid.ok) throw new Error(paid.reason);
      expect(paid.charged).toBe(40n);
      expect(await getLedgerBalance(handle.db, rich.id, "buffunfa")).toBe(60n);

      const refused = await addLateEventSignup(handle.db, { eventId: id, userId: broke.id, slotId: healer.id, actorUserId: owner });
      expect(refused).toMatchObject({ ok: false, reason: "insufficient_funds", fee: 40n, balance: 10n });
      // A recusa não cobrou nem inscreveu: a vaga e a cobrança são a mesma transação.
      expect(await getLedgerBalance(handle.db, broke.id, "buffunfa")).toBe(10n);
      const rows = await handle.db.select({ id: schema.eventSignups.id }).from(schema.eventSignups).where(eq(schema.eventSignups.userId, broke.id));
      expect(rows).toHaveLength(0);
    });

    it("guarda quem aceitou em decided_by: a inscrição não foi gesto da própria pessoa", async () => {
      const { id, healer } = await runningEvent(`late-ch-${++seq}`, new Date("2026-04-10T20:00:00.000Z"));
      const late = await user();
      const added = await addLateEventSignup(handle.db, { eventId: id, userId: late.id, slotId: healer.id, actorUserId: owner });
      if (!added.ok) throw new Error(added.reason);
      expect(added.signup.decidedByUserId).toBe(owner);
    });
  });

  describe("o que a pergunta consulta", () => {
    it("só devolve role com vaga, e some quando a última é tomada", async () => {
      const { id, tank, healer } = await runningEvent(`late-ch-${++seq}`, new Date("2026-04-11T20:00:00.000Z"));
      expect(await listEventFreeRoleSlots(handle.db, id)).toEqual([
        { id: tank.id, name: "Tank", free: 1 },
        { id: healer.id, name: "Healer", free: 2 },
      ]);
      const late = await user();
      const added = await addLateEventSignup(handle.db, { eventId: id, userId: late.id, slotId: tank.id, actorUserId: owner });
      if (!added.ok) throw new Error(added.reason);
      // A única vaga de Tank foi para o aceite, então Tank some da lista e só sobra o Healer.
      expect(await listEventFreeRoleSlots(handle.db, id)).toEqual([{ id: healer.id, name: "Healer", free: 2 }]);
    });

    it("acha o evento pelo canal de voz só enquanto ele está em andamento (AC#1)", async () => {
      const channel = `late-ch-${++seq}`;
      const start = new Date("2026-04-12T20:00:00.000Z");
      const { id } = await runningEvent(channel, start);
      expect((await findRunningEventByVoiceChannelId(handle.db, channel))?.id).toBe(id);
      // Canal que não é de evento nenhum: silêncio.
      expect(await findRunningEventByVoiceChannelId(handle.db, "canal-solto")).toBeNull();
      // Finalizado: o bot não pergunta mais nada por aquele canal.
      await finish(id, new Date("2026-04-12T21:00:00.000Z"));
      expect(await findRunningEventByVoiceChannelId(handle.db, channel)).toBeNull();
    });
  });
});
