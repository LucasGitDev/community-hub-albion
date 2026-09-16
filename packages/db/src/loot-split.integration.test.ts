import type { EventDto } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyEventTransition,
  createDb,
  createEvent,
  createLootSplit,
  getEvent,
  getLootSplit,
  hasDraftLootSplit,
  joinEventRole,
  listEventLootSplits,
  listEventPresence,
  listEventRoles,
  openVoiceSession,
  runMigrations,
  saveEventTemplate,
  schema,
  setEventFee,
  setEventVoiceChannelId,
  upsertUserByDiscordId,
  type DbHandle,
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
      expect(byNick.get(a.discordId)).toMatchObject({ shareBp: 6667, presenceMs: 120 * MIN, signedUp: true, amount: "2000000", roleName: tankSlotName });
      expect(byNick.get(b.discordId)).toMatchObject({ shareBp: 3333, presenceMs: 60 * MIN, amount: "1000000" });
      expect(created.split.lines.reduce((s, l) => s + l.shareBp, 0)).toBe(10_000);
      // 3.000.000 em 2/3 e 1/3 não fecha: a sobra fica com o dono (Q23).
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
      // Cada leva fecha o próprio total: soma das linhas + sobra.
      expect(splits[0]!.lines.reduce((s, l) => s + BigInt(l.amount), 0n) + BigInt(splits[0]!.residualSilver)).toBe(1_000_000n);
      expect(splits[1]!.lines.reduce((s, l) => s + BigInt(l.amount), 0n) + BigInt(splits[1]!.residualSilver)).toBe(500_001n);
      // 500.001 entre dois: sobra 1 de prata para o dono (Q23).
      expect(splits[1]!.residualSilver).toBe("1");
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
      // E a taxa não foi aplicada aqui: a prévia ainda é sobre o total bruto (TASK-028 aplica).
      expect((await getLootSplit(handle.db, created.split.id))!.lines[0]!.amount).toBe("1000");
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
});
