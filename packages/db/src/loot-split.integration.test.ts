import type { EventDto } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyEventTransition,
  confirmLootSplit,
  createDb,
  createEvent,
  createLootSplit,
  getEvent,
  getLedgerBalance,
  getLootSplit,
  hasConfirmedLootSplit,
  hasDraftLootSplit,
  joinEventRole,
  listEventLootSplits,
  listEventPresence,
  listEventRoles,
  listLedgerEntriesByReference,
  openVoiceSession,
  runMigrations,
  reverseLootSplit,
  saveEventTemplate,
  schema,
  setEventFee,
  updateEventDetails,
  setEventVoiceChannelId,
  updateLootSplitDraft,
  upsertUserByDiscordId,
  type DbHandle,
  type EventTransitionPrecondition,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de loot split não podem ser pulados");

const MIN = 60_000;
const NO_FEE = { type: "percent", value: 0n } as const;

describe.skipIf(!baseUrl)("rascunho de loot split (TASK-027, Postgres real)", () => {
  let handle: DbHandle;
  let templateId: string;
  let tankSlotName: string;
  let seq = 0;

  /** Conta nova; `discordId` é o snowflake que `voice_sessions` usa. */
  const nextUser = async (): Promise<{ id: string; discordId: string }> => {
    const discordId = `7300000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `split${seq}` });
    return { id: user.id, discordId };
  };

  const signUp = async (eventId: string, userId: string) => {
    const [slot] = await handle.db.select().from(schema.eventRoleSlots).where(eq(schema.eventRoleSlots.eventId, eventId));
    const joined = await joinEventRole(handle.db, { eventId, userId, slotId: slot!.id });
    if (!joined.ok) throw new Error(joined.reason);
  };

  /**
   * Evento levado até `finished`, com canal de voz e janela de presença conhecida. As inscrições são
   * feitas enquanto o evento está `open`, que é a única janela em que o repo aceita (TASK-022).
   */
  const finishedEvent = async (owner: string, channelId: string, startedAt: Date, finishedAt: Date, signUps: string[] = []): Promise<EventDto> => {
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
    const opened = await applyEventTransition(handle.db, id, "open");
    if (!opened.ok) throw new Error("não abriu");
    for (const userId of signUps) await signUp(id, userId);
    const running = await applyEventTransition(handle.db, id, "running");
    if (!running.ok) throw new Error("não iniciou");
    // O bot grava o canal no start; isso também carimba `presence_channel_id`.
    await setEventVoiceChannelId(handle.db, id, channelId);
    // Carimbos exatos: a janela de presença é start→finish (Q6).
    await handle.db.update(schema.events).set({ startedAt, finishedAt: null }).where(eq(schema.events.id, id));
    const finished = await applyEventTransition(handle.db, id, "finished", { at: finishedAt });
    if (!finished.ok) throw new Error("não finalizou");
    return (await getEvent(handle.db, id))!;
  };

  /** Sessão de voz fechada no canal, entre dois instantes. */
  const voice = async (discordUserId: string, channelId: string, from: Date, to: Date) => {
    const session = await openVoiceSession(handle.db, { discordUserId, channelId, at: from });
    await handle.db.update(schema.voiceSessions).set({ endedAt: to }).where(eq(schema.voiceSessions.id, session.id));
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_loot_split`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());

    const roles = await listEventRoles(handle.db);
    const tank = roles.find((r) => r.name === "Tank")!;
    tankSlotName = tank.name;
    const template = await saveEventTemplate(handle.db, {
      name: "Template do split",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [{ roleId: tank.id, slots: 20 }],
    });
    if (!template.ok) throw new Error(template.reason);
    templateId = template.template.id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  describe("percentual por tempo no canal entre start e finish (AC#1, Q5/Q6)", () => {
    it("rateia pela presença medida e guarda os milissegundos que originaram o número", async () => {
      const owner = await nextUser();
      const [a, b] = [await nextUser(), await nextUser()];
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-01T20:00:00.000Z");
      const finish = new Date("2026-03-01T22:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id, b.id]);
      // a ficou as 2h; b só a última hora.
      await voice(a.discordId, channel, start, finish);
      await voice(b.discordId, channel, new Date("2026-03-01T21:00:00.000Z"), finish);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 3_000_000n, fee: NO_FEE, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      const byNick = new Map(created.split.lines.map((l) => [l.discordUserId, l]));
      // A prata sai do percentual exibido (66,67% e 33,33%), não dos milissegundos: é o número que o
      // caller confere na tela e é exatamente o que a confirmação credita (TASK-028).
      expect(byNick.get(a.discordId)).toMatchObject({ shareBp: 6667, presenceMs: 120 * MIN, signedUp: true, amount: "2000100", roleName: tankSlotName });
      expect(byNick.get(b.discordId)).toMatchObject({ shareBp: 3333, presenceMs: 60 * MIN, amount: "999900" });
      expect(created.split.lines.reduce((s, l) => s + l.shareBp, 0)).toBe(10_000);
      expect(created.split.residualSilver).toBe("0");
      expect(created.split.status).toBe("draft");
      expect(created.split.createdByUserId).toBe(owner.id);
    });

    it("conta só o pedaço da sessão dentro da janela, e só no canal do evento", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-02T20:00:00.000Z");
      const finish = new Date("2026-03-02T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      // Entrou meia hora antes de começar e saiu meia hora depois de acabar: conta 1h, não 2h.
      await voice(a.discordId, channel, new Date("2026-03-02T19:30:00.000Z"), new Date("2026-03-02T21:30:00.000Z"));
      // Tempo em outro canal não conta (Q6).
      await voice(a.discordId, "outro-canal", start, finish);

      const presence = await listEventPresence(handle.db, event.id);
      expect(presence.find((p) => p.discordUserId === a.discordId)!.presenceMs).toBe(60 * MIN);
    });

    it("soma várias entradas e saídas da mesma pessoa no canal", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-03T20:00:00.000Z");
      const finish = new Date("2026-03-03T22:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, new Date("2026-03-03T20:20:00.000Z"));
      await voice(a.discordId, channel, new Date("2026-03-03T21:00:00.000Z"), new Date("2026-03-03T21:10:00.000Z"));

      const presence = await listEventPresence(handle.db, event.id);
      expect(presence.find((p) => p.discordUserId === a.discordId)!.presenceMs).toBe(30 * MIN);
    });

    it("a janela sobrevive ao canal apagado no finish (presence_channel_id)", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-04T20:00:00.000Z");
      const finish = new Date("2026-03-04T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, finish);
      // O bot apaga o canal no finish e zera voice_channel_id; o split nasce depois disso.
      await setEventVoiceChannelId(handle.db, event.id, null);
      const after = (await getEvent(handle.db, event.id))!;
      expect(after.voiceChannelId).toBeNull();
      expect(after.presenceChannelId).toBe(channel);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 100n, fee: NO_FEE, createdBy: null });
      if (!created.ok) throw new Error(created.reason);
      expect(created.split.lines.find((l) => l.discordUserId === a.discordId)).toMatchObject({ shareBp: 10_000, amount: "100" });
    });
  });

  describe("presente não inscrito entra com 0% (AC#2, Q7)", () => {
    it("aparece na lista com o tempo dele, sem participação, e sem diluir os inscritos", async () => {
      const owner = await nextUser();
      const inscrito = await nextUser();
      const intruso = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-05T20:00:00.000Z");
      const finish = new Date("2026-03-05T22:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [inscrito.id]);
      await voice(inscrito.discordId, channel, start, new Date("2026-03-05T21:00:00.000Z"));
      // O intruso ficou o dobro do tempo e mesmo assim não leva nada.
      await voice(intruso.discordId, channel, start, finish);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 1_000_000n, fee: NO_FEE, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      const line = created.split.lines.find((l) => l.discordUserId === intruso.discordId)!;
      expect(line).toMatchObject({ signedUp: false, shareBp: 0, amount: "0", presenceMs: 120 * MIN, roleName: null });
      // A conta do painel é resolvida mesmo sem inscrição, para a staff poder decidir depois.
      expect(line.userId).toBe(intruso.id);
      expect(created.split.lines.find((l) => l.discordUserId === inscrito.discordId)).toMatchObject({ shareBp: 10_000, amount: "1000000" });
    });

    it("presente sem conta no painel entra com userId null, sem quebrar o rascunho", async () => {
      const owner = await nextUser();
      const inscrito = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-06T20:00:00.000Z");
      const finish = new Date("2026-03-06T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [inscrito.id]);
      await voice(inscrito.discordId, channel, start, finish);
      await voice("880000000000000099", channel, start, finish);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 500n, fee: NO_FEE, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      expect(created.split.lines.find((l) => l.discordUserId === "880000000000000099")).toMatchObject({ userId: null, nick: null, shareBp: 0, amount: "0" });
    });

    it("inscrito que nunca entrou na voz aparece com 0ms e 0%", async () => {
      const owner = await nextUser();
      const presente = await nextUser();
      const ausente = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-07T20:00:00.000Z");
      const finish = new Date("2026-03-07T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [presente.id, ausente.id]);
      await voice(presente.discordId, channel, start, finish);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 900n, fee: NO_FEE, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      expect(created.split.lines.find((l) => l.discordUserId === ausente.discordId)).toMatchObject({ signedUp: true, presenceMs: 0, shareBp: 0, amount: "0" });
    });

    it("o banco recusa dar participação a quem não estava inscrito", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-08T20:00:00.000Z");
      const finish = new Date("2026-03-08T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, finish);
      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 10n, fee: NO_FEE, createdBy: null });
      if (!created.ok) throw new Error(created.reason);

      await expect(
        handle.db.insert(schema.lootSplitLines).values({
          splitId: created.split.id,
          discordUserId: "990000000000000001",
          signedUp: false,
          presenceMs: 10,
          shareBp: 500,
          amountSilver: 5n,
        }),
      ).rejects.toThrow();
    });
  });

  describe("N splits por evento (AC#3, Q23)", () => {
    it("o mesmo evento aceita várias levas, cada uma fechando 100% do próprio total", async () => {
      const owner = await nextUser();
      const [a, b] = [await nextUser(), await nextUser()];
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-09T20:00:00.000Z");
      const finish = new Date("2026-03-09T22:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id, b.id]);
      await voice(a.discordId, channel, start, finish);
      await voice(b.discordId, channel, start, finish);

      const first = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 1_000_000n, fee: NO_FEE, createdBy: owner.id });
      const second = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 500_001n, fee: { type: "fixed", value: 25_000n }, createdBy: owner.id });
      if (!first.ok || !second.ok) throw new Error("não criou os dois splits");
      expect(first.split.id).not.toBe(second.split.id);

      const splits = await listEventLootSplits(handle.db, event.id);
      expect(splits).toHaveLength(2);
      for (const split of splits) expect(split.lines.reduce((s, l) => s + l.shareBp, 0)).toBe(10_000);
      // Cada leva fecha o próprio total: linhas + sobra + taxa retida, nem um tostão a mais ou a menos.
      const closes = (split: (typeof splits)[number]) =>
        split.lines.reduce((s, l) => s + BigInt(l.amount), 0n) + BigInt(split.residualSilver) + BigInt(split.feeSilver);
      expect(closes(splits[0]!)).toBe(1_000_000n);
      expect(closes(splits[1]!)).toBe(500_001n);
      // A segunda leva tem taxa fixa de 25.000: sai antes da divisão (doc-005, "Taxa do split").
      expect(splits[1]!.feeSilver).toBe("25000");
      expect(splits[1]!.distributableSilver).toBe("475001");
      // A taxa é congelada por split: a segunda leva guardou a sua.
      expect(splits[1]!.fee).toEqual({ type: "fixed", value: "25000" });
    });

    it("a mesma pessoa nunca aparece duas vezes no mesmo split", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-10T20:00:00.000Z");
      const finish = new Date("2026-03-10T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, new Date("2026-03-10T20:20:00.000Z"));
      await voice(a.discordId, channel, new Date("2026-03-10T20:30:00.000Z"), finish);
      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 10n, fee: NO_FEE, createdBy: null });
      if (!created.ok) throw new Error(created.reason);
      expect(created.split.lines.filter((l) => l.discordUserId === a.discordId)).toHaveLength(1);

      await expect(
        handle.db.insert(schema.lootSplitLines).values({
          splitId: created.split.id,
          discordUserId: a.discordId,
          signedUp: true,
          presenceMs: 1,
          shareBp: 1,
          amountSilver: 1n,
        }),
      ).rejects.toThrow();
    });
  });

  describe("estado do evento (AC#4, Q26)", () => {
    const makeEvent = async (owner: string) => {
      const created = await createEvent(handle.db, {
        templateId,
        name: `Estado ${++seq}`,
        description: null,
        startsAt: null,
        signupsCloseAt: null,
        ownerUserId: owner,
        createdBy: owner,
      });
      if (!created.ok) throw new Error(created.reason);
      return created.event.id;
    };

    it("evento cancelado não aceita split", async () => {
      const owner = await nextUser();
      const id = await makeEvent(owner.id);
      const cancelled = await applyEventTransition(handle.db, id, "cancelled", { reason: "Sem gente" });
      if (!cancelled.ok) throw new Error("não cancelou");
      expect(await createLootSplit(handle.db, { eventId: id, totalSilver: 100n, fee: NO_FEE, createdBy: owner.id })).toEqual({
        ok: false,
        reason: "invalid_status",
        status: "cancelled",
      });
      expect(await listEventLootSplits(handle.db, id)).toEqual([]);
    });

    it("evento que ainda não terminou não aceita split: a janela de presença não fechou", async () => {
      const owner = await nextUser();
      const id = await makeEvent(owner.id);
      for (const status of ["draft", "open", "running"] as const) {
        const result = await createLootSplit(handle.db, { eventId: id, totalSilver: 100n, fee: NO_FEE, createdBy: owner.id });
        expect(result).toEqual({ ok: false, reason: "invalid_status", status });
        if (status !== "running") {
          const next = status === "draft" ? "open" : "running";
          const moved = await applyEventTransition(handle.db, id, next);
          if (!moved.ok) throw new Error(`não foi para ${next}`);
        }
      }
    });

    it("evento arquivado não aceita split", async () => {
      const owner = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-11T20:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, new Date("2026-03-11T21:00:00.000Z"));
      const archived = await applyEventTransition(handle.db, event.id, "archived");
      if (!archived.ok) throw new Error("não arquivou");
      expect(await createLootSplit(handle.db, { eventId: event.id, totalSilver: 100n, fee: NO_FEE, createdBy: owner.id })).toEqual({
        ok: false,
        reason: "invalid_status",
        status: "archived",
      });
    });

    it("evento inexistente devolve not_found", async () => {
      expect(await createLootSplit(handle.db, { eventId: "00000000-0000-4000-8000-000000000000", totalSilver: 1n, fee: NO_FEE, createdBy: null })).toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("rascunho aberto barra o arquivamento (TASK-044, AC#4)", async () => {
      const owner = await nextUser();
      const channel = `ch-${++seq}`;
      const event = await finishedEvent(owner.id, channel, new Date("2026-03-12T20:00:00.000Z"), new Date("2026-03-12T21:00:00.000Z"));
      expect(await hasDraftLootSplit(handle.db, event.id)).toBe(false);
      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 10n, fee: NO_FEE, createdBy: null });
      if (!created.ok) throw new Error(created.reason);
      expect(await hasDraftLootSplit(handle.db, event.id)).toBe(true);

      const blocked = await applyEventTransition(handle.db, event.id, "archived", {
        precondition: async (tx, { eventId }) => ((await hasDraftLootSplit(tx, eventId)) ? "tem rascunho" : null),
      });
      expect(blocked).toMatchObject({ ok: false, reason: "blocked", message: "tem rascunho" });
    });
  });

  describe("taxa do evento (doc-005: percentual ou fixo, sem teto, default do template)", () => {
    it("o evento herda a taxa default do template na criação, como cópia", async () => {
      const owner = await nextUser();
      const roles = await listEventRoles(handle.db);
      const template = await saveEventTemplate(handle.db, {
        name: `Template com taxa ${++seq}`,
        description: null,
        minPartySize: 1,
        maxPartySize: null,
        active: true,
        roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 5 }],
      });
      if (!template.ok) throw new Error(template.reason);
      await handle.db
        .update(schema.eventTemplates)
        .set({ defaultFeeType: "percent", defaultFeeValue: 1500n })
        .where(eq(schema.eventTemplates.id, template.template.id));

      const created = await createEvent(handle.db, {
        templateId: template.template.id,
        name: `Herdeiro ${seq}`,
        description: null,
        startsAt: null,
        signupsCloseAt: null,
        ownerUserId: owner.id,
        createdBy: owner.id,
      });
      if (!created.ok) throw new Error(created.reason);
      expect(created.event.fee).toEqual({ type: "percent", value: "1500" });

      // Mexer no default do template depois não mexe no evento já criado.
      await handle.db.update(schema.eventTemplates).set({ defaultFeeValue: 9999n }).where(eq(schema.eventTemplates.id, template.template.id));
      expect((await getEvent(handle.db, created.event.id))!.fee).toEqual({ type: "percent", value: "1500" });
    });

    it("a taxa do evento é editável e aceita valor fixo sem teto", async () => {
      const owner = await nextUser();
      const channel = `ch-${++seq}`;
      const event = await finishedEvent(owner.id, channel, new Date("2026-03-13T20:00:00.000Z"), new Date("2026-03-13T21:00:00.000Z"));
      expect(event.fee).toEqual({ type: "percent", value: "0" });

      const updated = await setEventFee(handle.db, event.id, { type: "fixed", value: 9_007_199_254_740_993n });
      expect(updated!.fee).toEqual({ type: "fixed", value: "9007199254740993" });
      // Percentual acima de 100% é aceito: não há teto (decisão do usuário).
      expect((await setEventFee(handle.db, event.id, { type: "percent", value: 25_000n }))!.fee).toEqual({ type: "percent", value: "25000" });
    });

    it("nome e observação do evento são corrigíveis depois do finish, sem mexer no resto (TASK-029, AC#2)", async () => {
      const owner = await nextUser();
      const channel = `ch-${++seq}`;
      const event = await finishedEvent(owner.id, channel, new Date("2026-03-16T20:00:00.000Z"), new Date("2026-03-16T21:00:00.000Z"));

      const updated = await updateEventDetails(handle.db, event.id, { name: "Roads corrigida", description: "ponto em Martlock" });
      expect([updated!.name, updated!.description]).toEqual(["Roads corrigida", "ponto em Martlock"]);
      // Nada além dos dois campos se move: status, dono, taxa e a janela de presença continuam iguais.
      expect([updated!.status, updated!.ownerUserId, updated!.fee, updated!.presenceChannelId]).toEqual([
        event.status,
        event.ownerUserId,
        event.fee,
        event.presenceChannelId,
      ]);
      expect((await updateEventDetails(handle.db, event.id, { name: "Sem observação", description: null }))!.description).toBeNull();
      expect(await updateEventDetails(handle.db, "00000000-0000-4000-8000-000000000000", { name: "x", description: null })).toBeNull();
    });

    it("taxa negativa é recusada pelo banco, no evento e no template", async () => {
      const owner = await nextUser();
      const channel = `ch-${++seq}`;
      const event = await finishedEvent(owner.id, channel, new Date("2026-03-14T20:00:00.000Z"), new Date("2026-03-14T21:00:00.000Z"));
      await expect(handle.db.update(schema.events).set({ feeValue: -1n }).where(eq(schema.events.id, event.id))).rejects.toThrow();
      await expect(handle.db.update(schema.eventTemplates).set({ defaultFeeValue: -1n }).where(eq(schema.eventTemplates.id, templateId))).rejects.toThrow();
    });

    it("o split congela a taxa do evento no instante do rascunho", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-15T20:00:00.000Z");
      const finish = new Date("2026-03-15T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, finish);

      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 1_000n, fee: { type: "percent", value: 1000n }, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      await setEventFee(handle.db, event.id, { type: "fixed", value: 777n });
      expect((await getLootSplit(handle.db, created.split.id))!.fee).toEqual({ type: "percent", value: "1000" });
      // A taxa congelada é a que foi aplicada: 10% de 1000 retidos, 900 divididos (TASK-028).
      const reread = (await getLootSplit(handle.db, created.split.id))!;
      expect(reread.feeSilver).toBe("100");
      expect(reread.distributableSilver).toBe("900");
      expect(reread.lines[0]!.amount).toBe("900");
    });
  });

  describe("leitura do split", () => {
    it("split inexistente devolve null e evento sem split devolve lista vazia", async () => {
      expect(await getLootSplit(handle.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await listEventLootSplits(handle.db, "00000000-0000-4000-8000-000000000000")).toEqual([])
    });

    it("apagar o evento leva os splits junto, mas a conta do membro não é apagável", async () => {
      const owner = await nextUser();
      const a = await nextUser();
      const channel = `ch-${++seq}`;
      const start = new Date("2026-03-16T20:00:00.000Z");
      const finish = new Date("2026-03-16T21:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
      await voice(a.discordId, channel, start, finish);
      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 10n, fee: NO_FEE, createdBy: null });
      if (!created.ok) throw new Error(created.reason);

      // Conta com linha de split é histórico do evento (mesma regra do ledger, Q10).
      await expect(handle.db.delete(schema.users).where(eq(schema.users.id, a.id))).rejects.toThrow();
      await handle.db.delete(schema.events).where(eq(schema.events.id, event.id));
      expect(await getLootSplit(handle.db, created.split.id)).toBeNull();
    });

    it("presença de evento inexistente é lista vazia", async () => {
      expect(await listEventPresence(handle.db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    });
  });

  /**
   * Confirmação e edição (TASK-028). Tudo aqui contra Postgres de verdade de propósito: o que garante
   * a idempotência e a imutabilidade é o banco (trava de linha e triggers), não o JavaScript.
   */
  describe("edição e confirmação do split (TASK-028)", () => {
    /** Evento finalizado com dois inscritos presentes em partes diferentes da janela. */
    const twoPeopleEvent = async (fee: { type: "percent" | "fixed"; value: bigint }, total: bigint) => {
      const owner = await nextUser();
      const [a, b] = [await nextUser(), await nextUser()];
      const channel = `ch-c${++seq}`;
      const start = new Date("2026-04-01T20:00:00.000Z");
      const middle = new Date("2026-04-01T21:00:00.000Z");
      const finish = new Date("2026-04-01T22:00:00.000Z");
      const event = await finishedEvent(owner.id, channel, start, finish, [a.id, b.id]);
      await voice(a.discordId, channel, start, finish);
      await voice(b.discordId, channel, middle, finish);
      const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: total, fee, createdBy: owner.id });
      if (!created.ok) throw new Error(created.reason);
      return { owner, a, b, event, split: created.split };
    };

    const balances = async (...ids: string[]) => Promise.all(ids.map((id) => getLedgerBalance(handle.db, id, "silver")));

    describe("edição do rascunho (AC#1)", () => {
      it("mudar só o total recalcula a prata de todo mundo sem mexer nos percentuais", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 3_000n);
        expect(split.lines.map((l) => [l.shareBp, l.amount])).toEqual([
          [6667, "2000"],
          [3333, "999"],
        ]);
        const updated = await updateLootSplitDraft(handle.db, split.id, { totalSilver: 30_000n });
        if (!updated.ok) throw new Error(updated.reason);
        expect(updated.split.totalSilver).toBe("30000");
        expect(updated.split.lines.map((l) => [l.shareBp, l.amount])).toEqual([
          [6667, "20001"],
          [3333, "9999"],
        ]);
      });

      it("mudar os percentuais redistribui a prata, e a sobra continua fechando o total", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const [first, second] = split.lines;
        const updated = await updateLootSplitDraft(handle.db, split.id, {
          lines: [
            { id: first!.id, shareBp: 5000 },
            { id: second!.id, shareBp: 5000 },
          ],
        });
        if (!updated.ok) throw new Error(updated.reason);
        expect(updated.split.lines.map((l) => [l.shareBp, l.amount])).toEqual([
          [5000, "500"],
          [5000, "500"],
        ]);
        expect(updated.split.residualSilver).toBe("0");
      });

      it("a soma NÃO precisa fechar 100% durante a edição: ela é exigida só na confirmação (Q22)", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const updated = await updateLootSplitDraft(handle.db, split.id, {
          lines: split.lines.map((line) => ({ id: line.id, shareBp: 1000 })),
        });
        expect(updated.ok).toBe(true);
      });

      it("lista parcial de linhas é recusada: participação é bolo fechado", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect(await updateLootSplitDraft(handle.db, split.id, { lines: [{ id: split.lines[0]!.id, shareBp: 10_000 }] })).toEqual({ ok: false, reason: "unknown_lines" });
      });

      it("dar participação a quem não estava inscrito é recusado com frase, não com erro de constraint (Q7)", async () => {
        const owner = await nextUser();
        const a = await nextUser();
        const intruso = await nextUser();
        const channel = `ch-c${++seq}`;
        const start = new Date("2026-04-02T20:00:00.000Z");
        const finish = new Date("2026-04-02T22:00:00.000Z");
        const event = await finishedEvent(owner.id, channel, start, finish, [a.id]);
        await voice(a.discordId, channel, start, finish);
        await voice(intruso.discordId, channel, start, finish);
        const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 1_000n, fee: NO_FEE, createdBy: owner.id });
        if (!created.ok) throw new Error(created.reason);
        const naoInscrito = created.split.lines.find((l) => !l.signedUp)!;
        const inscrito = created.split.lines.find((l) => l.signedUp)!;
        expect(
          await updateLootSplitDraft(handle.db, created.split.id, {
            lines: [
              { id: inscrito.id, shareBp: 5000 },
              { id: naoInscrito.id, shareBp: 5000 },
            ],
          }),
        ).toEqual({ ok: false, reason: "share_without_signup" });
      });

      it("split inexistente é not_found", async () => {
        expect(await updateLootSplitDraft(handle.db, "00000000-0000-4000-8000-000000000000", { totalSilver: 1n })).toEqual({ ok: false, reason: "not_found" });
      });

      it("evento arquivado não aceita edição (Q26)", async () => {
        const { event, split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const confirmed = await confirmLootSplit(handle.db, split.id, { actorUserId: null });
        expect(confirmed.ok).toBe(true);
        const archived = await applyEventTransition(handle.db, event.id, "archived");
        expect(archived.ok).toBe(true);
        const created = await createLootSplit(handle.db, { eventId: event.id, totalSilver: 1n, fee: NO_FEE, createdBy: null });
        expect(created).toMatchObject({ ok: false, reason: "invalid_status", status: "archived" });
      });
    });

    describe("confirmação lança no ledger (AC#2)", () => {
      it("soma ≠ 100% é recusada (AC#1, Q22)", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const torto = await updateLootSplitDraft(handle.db, split.id, { lines: split.lines.map((l) => ({ id: l.id, shareBp: 4000 })) });
        expect(torto.ok).toBe(true);
        expect(await confirmLootSplit(handle.db, split.id, { actorUserId: null })).toEqual({ ok: false, reason: "refused", refusal: "shares_not_100" });
        // E nada foi lançado.
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toEqual([]);
        expect((await getLootSplit(handle.db, split.id))!.status).toBe("draft");
      });

      it("taxa fixa maior que o total é recusada: sem isso o distribuível ficaria negativo", async () => {
        const { split } = await twoPeopleEvent({ type: "fixed", value: 5_000n }, 1_000n);
        expect((await getLootSplit(handle.db, split.id))!.distributableSilver).toBe("0");
        expect(await confirmLootSplit(handle.db, split.id, { actorUserId: null })).toEqual({ ok: false, reason: "refused", refusal: "fee_exceeds_total" });
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toEqual([]);
      });

      it("a soma dos créditos é exatamente o total do split, com taxa e sobra no dono (AC#2, Q23)", async () => {
        const { owner, a, b, split } = await twoPeopleEvent({ type: "percent", value: 1000n }, 1_000_000n);
        expect(split.feeSilver).toBe("100000");
        expect(split.distributableSilver).toBe("900000");

        const confirmed = await confirmLootSplit(handle.db, split.id, { actorUserId: owner.id });
        if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
        expect(confirmed.alreadyConfirmed).toBe(false);
        expect(confirmed.split).toMatchObject({ status: "confirmed", confirmedByUserId: owner.id });
        expect(confirmed.split.confirmedAt).not.toBeNull();

        const entries = await listLedgerEntriesByReference(handle.db, "loot_split", split.id);
        expect(entries.map((e) => e.kind).sort()).toEqual(["split_fee", "split_payout", "split_payout"]);
        // 100% da prata do split saiu em lançamento, nem um tostão a mais nem a menos.
        expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(1_000_000n);
        const [saldoA, saldoB, saldoOwner] = await balances(a.id, b.id, owner.id);
        expect(saldoA).toBe(600_030n);
        expect(saldoB).toBe(299_970n);
        // Taxa (100.000) + sobra do arredondamento (0), tudo num lançamento só.
        expect(saldoOwner).toBe(100_000n);
        expect(saldoA + saldoB + saldoOwner).toBe(1_000_000n);
      });

      it("taxa em valor fixo e sobra de arredondamento vão juntas para o dono num lançamento só (Q23)", async () => {
        const { owner, a, b, split } = await twoPeopleEvent({ type: "fixed", value: 7n }, 1_000n);
        const confirmed = await confirmLootSplit(handle.db, split.id, { actorUserId: owner.id });
        if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
        const entries = await listLedgerEntriesByReference(handle.db, "loot_split", split.id);
        expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(1_000n);
        const fee = entries.find((e) => e.kind === "split_fee")!;
        expect(fee.userId).toBe(owner.id);
        expect(fee.amount).toBe(7n + BigInt(confirmed.split.residualSilver));
        const [saldoA, saldoB] = await balances(a.id, b.id);
        expect(saldoA + saldoB + fee.amount).toBe(1_000n);
      });

      it("split sem loot nenhum confirma sem lançar nada: o ledger recusa lançamento de zero", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 0n);
        const confirmed = await confirmLootSplit(handle.db, split.id, { actorUserId: null });
        expect(confirmed.ok).toBe(true);
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toEqual([]);
        expect((await getLootSplit(handle.db, split.id))!.status).toBe("confirmed");
      });

      it("prata acima de 2^53 chega inteira na carteira (Q20)", async () => {
        const total = 9_007_199_254_740_993_000n;
        const { owner, a, b, split } = await twoPeopleEvent(NO_FEE, total);
        const confirmed = await confirmLootSplit(handle.db, split.id, { actorUserId: null });
        if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
        const [saldoA, saldoB, saldoOwner] = await balances(a.id, b.id, owner.id);
        expect(saldoA + saldoB + saldoOwner).toBe(total);
      });
    });

    describe("idempotência e concorrência (AC#4)", () => {
      it("confirmar duas vezes em sequência não credita duas vezes", async () => {
        const { a, split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const first = await confirmLootSplit(handle.db, split.id, { actorUserId: null });
        const second = await confirmLootSplit(handle.db, split.id, { actorUserId: null });
        expect(first).toMatchObject({ ok: true, alreadyConfirmed: false });
        expect(second).toMatchObject({ ok: true, alreadyConfirmed: true });
        // Dois pagamentos e o lançamento da sobra do arredondamento para o dono: um conjunto só.
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toHaveLength(3);
        expect(await getLedgerBalance(handle.db, a.id, "silver")).toBe(666n);
      });

      it("duas confirmações SIMULTÂNEAS, em conexões diferentes, lançam um único conjunto (AC#4)", async () => {
        const { owner, a, b, split } = await twoPeopleEvent({ type: "percent", value: 500n }, 1_000_000n);
        const [first, second] = await Promise.all([
          confirmLootSplit(handle.db, split.id, { actorUserId: owner.id }),
          confirmLootSplit(handle.db, split.id, { actorUserId: owner.id }),
        ]);
        expect(first.ok && second.ok).toBe(true);
        // Uma das duas fez o trabalho; a outra chegou depois da trava e não lançou nada.
        expect([first, second].filter((r) => r.ok && r.alreadyConfirmed)).toHaveLength(1);
        const entries = await listLedgerEntriesByReference(handle.db, "loot_split", split.id);
        expect(entries).toHaveLength(3);
        expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(1_000_000n);
        const [saldoA, saldoB, saldoOwner] = await balances(a.id, b.id, owner.id);
        expect(saldoA + saldoB + saldoOwner).toBe(1_000_000n);
      });

      it("dez confirmações simultâneas continuam dando um conjunto só", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000_000n);
        const results = await Promise.all(Array.from({ length: 10 }, () => confirmLootSplit(handle.db, split.id, { actorUserId: null })));
        expect(results.every((r) => r.ok)).toBe(true);
        expect(results.filter((r) => r.ok && !r.alreadyConfirmed)).toHaveLength(1);
        // 1.000.000 fecha exato entre os dois (66,67% + 33,33%): sem sobra, sem lançamento do dono.
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toHaveLength(2);
      });
    });

    describe("split confirmado é imutável; correção é estorno", () => {
      /** O driver embrulha o erro do Postgres; a frase da trigger está na causa. */
      const expectBlockedByTrigger = async (query: Promise<unknown>) => {
        const error = await query.then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).not.toBeNull();
        const messages: string[] = [];
        for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) messages.push(String((e as { message?: unknown }).message ?? ""));
        expect(messages.join(" | ")).toMatch(/imutavel/);
      };

      it("o banco recusa UPDATE e DELETE num split confirmado e nas linhas dele", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: null })).ok).toBe(true);
        await expectBlockedByTrigger(handle.db.update(schema.lootSplits).set({ totalSilver: 1n }).where(eq(schema.lootSplits.id, split.id)));
        await expectBlockedByTrigger(handle.db.delete(schema.lootSplits).where(eq(schema.lootSplits.id, split.id)));
        await expectBlockedByTrigger(handle.db.update(schema.lootSplitLines).set({ shareBp: 1 }).where(eq(schema.lootSplitLines.splitId, split.id)));
        await expectBlockedByTrigger(handle.db.delete(schema.lootSplitLines).where(eq(schema.lootSplitLines.splitId, split.id)));
      });

      it("editar split confirmado pelo repo é recusado antes de tocar no banco", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: null })).ok).toBe(true);
        expect(await updateLootSplitDraft(handle.db, split.id, { totalSilver: 5n })).toEqual({ ok: false, reason: "not_draft", status: "confirmed" });
      });

      it("estorno devolve o saldo de todo mundo a zero, sem apagar lançamento nenhum", async () => {
        const { owner, a, b, split } = await twoPeopleEvent({ type: "percent", value: 1000n }, 1_000_000n);
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: owner.id })).ok).toBe(true);
        const estorno = await reverseLootSplit(handle.db, split.id, { reason: "loot contado errado", actorUserId: owner.id });
        expect(estorno).toEqual({ ok: true, reversed: 3 });
        const [saldoA, saldoB, saldoOwner] = await balances(a.id, b.id, owner.id);
        expect([saldoA, saldoB, saldoOwner]).toEqual([0n, 0n, 0n]);
        // Os originais continuam lá: o extrato mostra as duas metades (Q24).
        const entries = await listLedgerEntriesByReference(handle.db, "loot_split", split.id);
        expect(entries).toHaveLength(6);
        expect(entries.filter((e) => e.kind === "reversal")).toHaveLength(3);
        expect(entries.filter((e) => e.kind === "reversal").every((e) => e.memo === "loot contado errado")).toBe(true);
        // E o split continua confirmado: ele aconteceu.
        expect((await getLootSplit(handle.db, split.id))!.status).toBe("confirmed");
      });

      it("estornar duas vezes não duplica o estorno", async () => {
        const { owner, split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: owner.id })).ok).toBe(true);
        expect(await reverseLootSplit(handle.db, split.id, { reason: "errado", actorUserId: null })).toMatchObject({ ok: true });
        expect(await reverseLootSplit(handle.db, split.id, { reason: "errado", actorUserId: null })).toEqual({ ok: false, reason: "already_reversed" });
      });

      it("rascunho não tem o que estornar", async () => {
        const { split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect(await reverseLootSplit(handle.db, split.id, { reason: "errado", actorUserId: null })).toEqual({ ok: false, reason: "not_confirmed", status: "draft" });
      });
    });

    describe("evento com split confirmado (AC#5, Q26)", () => {
      it("evento finalizado não pode ser cancelado, com ou sem split confirmado", async () => {
        const { event, split } = await twoPeopleEvent(NO_FEE, 1_000n);
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: null })).ok).toBe(true);
        expect(await hasConfirmedLootSplit(handle.db, event.id)).toBe(true);
        // A máquina de estados é quem garante: de `finished` só se vai para `archived`.
        const cancelled = await applyEventTransition(handle.db, event.id, "cancelled");
        expect(cancelled).toMatchObject({ ok: false, reason: "invalid", from: "finished" });
        expect((await getEvent(handle.db, event.id))!.status).toBe("finished");
        // E a prata continua lá.
        expect(await listLedgerEntriesByReference(handle.db, "loot_split", split.id)).toHaveLength(3);
      });

      it("rascunho pendente barra o arquivamento; confirmar libera", async () => {
        const { event, split } = await twoPeopleEvent(NO_FEE, 1_000n);
        const precondition: EventTransitionPrecondition = async (tx, { eventId }) => ((await hasDraftLootSplit(tx, eventId)) ? "tem rascunho" : null);
        expect(await applyEventTransition(handle.db, event.id, "archived", { precondition })).toMatchObject({ ok: false, reason: "blocked" });
        expect((await confirmLootSplit(handle.db, split.id, { actorUserId: null })).ok).toBe(true);
        expect(await hasDraftLootSplit(handle.db, event.id)).toBe(false);
        expect(await applyEventTransition(handle.db, event.id, "archived", { precondition })).toMatchObject({ ok: true });
      });
    });
  });
});
