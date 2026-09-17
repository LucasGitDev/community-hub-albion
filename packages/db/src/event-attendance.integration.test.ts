import type { EventDto } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyEventTransition,
  createDb,
  createEvent,
  getEvent,
  getLedgerBalance,
  joinEventRole,
  listEventRoleBuffunfa,
  listEventRoles,
  listLedgerEntriesByReference,
  openVoiceSession,
  payEventAttendance,
  previewEventAttendance,
  runMigrations,
  saveEventTemplate,
  schema,
  setEventRoleBuffunfa,
  setEventVoiceChannelId,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de Buffunfa por presença não podem ser pulados");

const HOUR = 3_600_000;

/**
 * Buffunfa por participação em evento (TASK-057, F6-8 a F6-11) contra Postgres real: a faixa que o
 * template impõe, o valor que o caller move dentro dela, o corte binário dos 90% e o pagamento que
 * só acontece uma vez.
 */
describe.skipIf(!baseUrl)("Buffunfa por presença em evento (TASK-057, Postgres real)", () => {
  let handle: DbHandle;
  let templateId: string;
  let seq = 0;

  const nextUser = async (): Promise<{ id: string; discordId: string }> => {
    const discordId = `7400000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `buf${seq}` });
    return { id: user.id, discordId };
  };

  /** Inscreve na role pedida (as duas vagas do template têm nome de role diferente). */
  const signUp = async (eventId: string, userId: string, roleName: string) => {
    const slots = await handle.db.select().from(schema.eventRoleSlots).where(eq(schema.eventRoleSlots.eventId, eventId));
    const slot = slots.find((s) => s.name === roleName)!;
    const joined = await joinEventRole(handle.db, { eventId, userId, slotId: slot.id });
    if (!joined.ok) throw new Error(joined.reason);
  };

  const slotIdOf = async (eventId: string, roleName: string): Promise<string> => {
    const slots = await listEventRoleBuffunfa(handle.db, eventId);
    return slots.find((s) => s.name === roleName)!.slotId;
  };

  /**
   * Evento finalizado com janela de uma hora. `channelId` null = evento sem canal carimbado, que é o
   * caso da F6-11 (o bot nunca gravou o canal, então não houve medição).
   */
  const finishedEvent = async (owner: string, channelId: string | null, signUps: { userId: string; roleName: string }[] = []): Promise<{ event: EventDto; startedAt: Date; finishedAt: Date }> => {
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
    if (!(await applyEventTransition(handle.db, id, "open")).ok) throw new Error("não abriu");
    for (const s of signUps) await signUp(id, s.userId, s.roleName);
    if (!(await applyEventTransition(handle.db, id, "running")).ok) throw new Error("não iniciou");
    if (channelId) await setEventVoiceChannelId(handle.db, id, channelId);
    const startedAt = new Date("2026-03-01T20:00:00.000Z");
    const finishedAt = new Date(startedAt.getTime() + HOUR);
    await handle.db.update(schema.events).set({ startedAt }).where(eq(schema.events.id, id));
    if (!(await applyEventTransition(handle.db, id, "finished", { at: finishedAt })).ok) throw new Error("não finalizou");
    return { event: (await getEvent(handle.db, id))!, startedAt, finishedAt };
  };

  const voice = async (discordUserId: string, channelId: string, from: Date, to: Date) => {
    const session = await openVoiceSession(handle.db, { discordUserId, channelId, at: from });
    await handle.db.update(schema.voiceSessions).set({ endedAt: to }).where(eq(schema.voiceSessions.id, session.id));
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_attendance`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());

    const roles = await listEventRoles(handle.db);
    const template = await saveEventTemplate(handle.db, {
      name: "Template da Buffunfa",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 5, buffunfaMin: 10n, buffunfaMax: 40n },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 5, buffunfaMin: 0n, buffunfaMax: 0n },
      ],
    });
    if (!template.ok) throw new Error(template.reason);
    templateId = template.template.id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("a faixa do template vira snapshot na vaga e o valor nasce no mínimo (AC#1)", async () => {
    const owner = await nextUser();
    const { event } = await finishedEvent(owner.id, "chan-faixa");
    const tank = event.roles.find((r) => r.name === "Tank")!;
    expect([tank.buffunfaMin, tank.buffunfaMax, tank.buffunfaValue]).toEqual(["10", "40", "10"]);
    const healer = event.roles.find((r) => r.name === "Healer")!;
    expect([healer.buffunfaMin, healer.buffunfaMax, healer.buffunfaValue]).toEqual(["0", "0", "0"]);
  });

  it("o caller mexe no valor dentro da faixa e o banco recusa fora dela (AC#2)", async () => {
    const owner = await nextUser();
    const { event } = await finishedEvent(owner.id, "chan-ajuste");
    const slotId = await slotIdOf(event.id, "Tank");
    expect(await setEventRoleBuffunfa(handle.db, event.id, slotId, 40n)).toEqual({ ok: true });
    expect((await getEvent(handle.db, event.id))!.roles.find((r) => r.name === "Tank")!.buffunfaValue).toBe("40");
    const above = await setEventRoleBuffunfa(handle.db, event.id, slotId, 41n);
    expect(above).toMatchObject({ ok: false, reason: "out_of_range" });
    const below = await setEventRoleBuffunfa(handle.db, event.id, slotId, 9n);
    expect(below).toMatchObject({ ok: false, reason: "out_of_range" });
    // A recusa não deixa rastro: o valor continua o último aceito.
    expect((await getEvent(handle.db, event.id))!.roles.find((r) => r.name === "Tank")!.buffunfaValue).toBe("40");
  });

  it("a janela começa na primeira entrada no canal, não no início do evento (TASK-073)", async () => {
    const owner = await nextUser();
    const dono = await nextUser();
    const atrasado = await nextUser();
    const { event, startedAt, finishedAt } = await finishedEvent(owner.id, "chan-janela", [
      { userId: dono.id, roleName: "Tank" },
      { userId: atrasado.id, roleName: "Tank" },
    ]);

    // O relato que originou a correção: call de menos de um minuto, e a pessoa ficou com 72,66% de
    // presença mesmo tendo ficado do começo ao fim. Entre o evento começar e alguém entrar, o bot
    // ainda cria o canal e arrasta gente da sala de espera — numa call curta esse intervalo é a maior
    // parte da janela, e derrubava justamente quem estava lá o tempo todo.
    const fimCurto = new Date(startedAt.getTime() + 50_000);
    await handle.db.update(schema.events).set({ finishedAt: fimCurto }).where(eq(schema.events.id, event.id));
    const abriuAcall = new Date(startedAt.getTime() + 16_000);
    await voice(dono.discordId, "chan-janela", abriuAcall, fimCurto);
    // Quem entrou na metade da call continua abaixo do corte: o denominador mudou, a regra não.
    await voice(atrasado.discordId, "chan-janela", new Date(abriuAcall.getTime() + 17_000), fimCurto);

    const slotId = await slotIdOf(event.id, "Tank");
    expect(await setEventRoleBuffunfa(handle.db, event.id, slotId, 12n)).toEqual({ ok: true });

    const preview = (await previewEventAttendance(handle.db, event.id))!;
    expect(preview.windowMs).toBe(fimCurto.getTime() - abriuAcall.getTime());
    expect(preview.rows.find((r) => r.userId === dono.id)).toMatchObject({ skip: null, amount: 12n });
    expect(preview.rows.find((r) => r.userId === atrasado.id)!.skip).toBe("below_presence");

    expect(await payEventAttendance(handle.db, event.id, { actorUserId: owner.id })).toMatchObject({ ok: true, alreadyPaid: false });
    expect(await getLedgerBalance(handle.db, dono.id, "buffunfa")).toBe(12n);
    expect(await getLedgerBalance(handle.db, atrasado.id, "buffunfa")).toBe(0n);
    void finishedAt;
  });

  it("paga cheio quem bateu 90% e nada a quem ficou abaixo, com o valor do fechamento (AC#3, AC#4, AC#6)", async () => {
    const owner = await nextUser();
    const cheio = await nextUser();
    const quase = await nextUser();
    const { event, startedAt } = await finishedEvent(owner.id, "chan-corte", [
      { userId: cheio.id, roleName: "Tank" },
      { userId: quase.id, roleName: "Tank" },
    ]);
    await voice(cheio.discordId, "chan-corte", startedAt, new Date(startedAt.getTime() + HOUR));
    // 89% da janela: um pouco abaixo do corte, e o corte é binário (F6-10).
    await voice(quase.discordId, "chan-corte", startedAt, new Date(startedAt.getTime() + HOUR * 0.89));

    // O valor sobe **depois** das inscrições: quem entrou antes recebe o valor do fechamento (F6-9).
    const slotId = await slotIdOf(event.id, "Tank");
    expect(await setEventRoleBuffunfa(handle.db, event.id, slotId, 35n)).toEqual({ ok: true });

    const preview = (await previewEventAttendance(handle.db, event.id))!;
    expect(preview.measured).toBe(true);
    expect(preview.total).toBe(35n);
    expect(preview.rows.find((r) => r.userId === quase.id)!.skip).toBe("below_presence");

    const paid = await payEventAttendance(handle.db, event.id, { actorUserId: owner.id });
    expect(paid).toMatchObject({ ok: true, alreadyPaid: false });
    expect(await getLedgerBalance(handle.db, cheio.id, "buffunfa")).toBe(35n);
    expect(await getLedgerBalance(handle.db, quase.id, "buffunfa")).toBe(0n);
    // Buffunfa não é prata: o saldo de prata não se move (F6-1).
    expect(await getLedgerBalance(handle.db, cheio.id, "silver")).toBe(0n);

    const entries = await listLedgerEntriesByReference(handle.db, "event", event.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: cheio.id, amount: 35n, currency: "buffunfa", kind: "event_attendance" });
    expect(entries[0]!.memo).toContain("(Tank)");
  });

  it("todos da mesma role recebem o mesmo valor, seja qual for o instante da inscrição (AC#3)", async () => {
    const owner = await nextUser();
    const cedo = await nextUser();
    const tarde = await nextUser();
    const { event, startedAt } = await finishedEvent(owner.id, "chan-igual", [
      { userId: cedo.id, roleName: "Tank" },
      { userId: tarde.id, roleName: "Tank" },
    ]);
    await voice(cedo.discordId, "chan-igual", startedAt, new Date(startedAt.getTime() + HOUR));
    await voice(tarde.discordId, "chan-igual", startedAt, new Date(startedAt.getTime() + HOUR * 0.92));
    await setEventRoleBuffunfa(handle.db, event.id, await slotIdOf(event.id, "Tank"), 22n);
    await payEventAttendance(handle.db, event.id, { actorUserId: owner.id });
    expect(await getLedgerBalance(handle.db, cedo.id, "buffunfa")).toBe(22n);
    expect(await getLedgerBalance(handle.db, tarde.id, "buffunfa")).toBe(22n);
  });

  it("evento sem canal de presença não paga a ninguém (AC#5)", async () => {
    const owner = await nextUser();
    const membro = await nextUser();
    const { event } = await finishedEvent(owner.id, null, [{ userId: membro.id, roleName: "Tank" }]);
    expect(event.presenceChannelId).toBeNull();
    const preview = (await previewEventAttendance(handle.db, event.id))!;
    expect(preview.measured).toBe(false);
    expect(preview.total).toBe(0n);
    expect(preview.rows.every((r) => r.skip === "no_channel")).toBe(true);

    const paid = await payEventAttendance(handle.db, event.id, { actorUserId: owner.id });
    expect(paid).toEqual({ ok: false, reason: "not_measured" });
    expect(await getLedgerBalance(handle.db, membro.id, "buffunfa")).toBe(0n);
    // Nem carimbo: recusar sem carimbar é o que deixa o caller voltar depois de arrumar o evento.
    expect((await getEvent(handle.db, event.id))!.buffunfaPaidAt).toBeNull();
  });

  it("paga uma vez só e congela o valor por role depois do fechamento (AC#6)", async () => {
    const owner = await nextUser();
    const membro = await nextUser();
    const { event, startedAt } = await finishedEvent(owner.id, "chan-idem", [{ userId: membro.id, roleName: "Tank" }]);
    await voice(membro.discordId, "chan-idem", startedAt, new Date(startedAt.getTime() + HOUR));
    const slotId = await slotIdOf(event.id, "Tank");
    await setEventRoleBuffunfa(handle.db, event.id, slotId, 30n);

    const first = await payEventAttendance(handle.db, event.id, { actorUserId: owner.id });
    expect(first).toMatchObject({ ok: true, alreadyPaid: false });
    const second = await payEventAttendance(handle.db, event.id, { actorUserId: owner.id });
    expect(second).toMatchObject({ ok: true, alreadyPaid: true });
    expect(await getLedgerBalance(handle.db, membro.id, "buffunfa")).toBe(30n);
    expect(await listLedgerEntriesByReference(handle.db, "event", event.id)).toHaveLength(1);

    expect(await setEventRoleBuffunfa(handle.db, event.id, slotId, 10n)).toEqual({ ok: false, reason: "already_paid" });
    expect((await getEvent(handle.db, event.id))!.buffunfaPaidAt).not.toBeNull();
  });

  it("dois pagamentos simultâneos criam Buffunfa uma vez só", async () => {
    const owner = await nextUser();
    const membro = await nextUser();
    const { event, startedAt } = await finishedEvent(owner.id, "chan-corrida", [{ userId: membro.id, roleName: "Tank" }]);
    await voice(membro.discordId, "chan-corrida", startedAt, new Date(startedAt.getTime() + HOUR));
    await setEventRoleBuffunfa(handle.db, event.id, await slotIdOf(event.id, "Tank"), 12n);
    const [a, b] = await Promise.all([payEventAttendance(handle.db, event.id), payEventAttendance(handle.db, event.id)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await getLedgerBalance(handle.db, membro.id, "buffunfa")).toBe(12n);
  });

  it("role sem valor e presente sem inscrição ficam de fora, cada um com seu motivo (AC#4)", async () => {
    const owner = await nextUser();
    const healer = await nextUser();
    const penetra = await nextUser();
    const { event, startedAt } = await finishedEvent(owner.id, "chan-fora", [{ userId: healer.id, roleName: "Healer" }]);
    await voice(healer.discordId, "chan-fora", startedAt, new Date(startedAt.getTime() + HOUR));
    await voice(penetra.discordId, "chan-fora", startedAt, new Date(startedAt.getTime() + HOUR));
    const preview = (await previewEventAttendance(handle.db, event.id))!;
    expect(preview.rows.find((r) => r.userId === healer.id)!.skip).toBe("zero_value");
    expect(preview.rows.find((r) => r.userId === penetra.id)!.skip).toBe("not_signed_up");
    const paid = await payEventAttendance(handle.db, event.id);
    expect(paid).toMatchObject({ ok: true, alreadyPaid: false });
    expect(await listLedgerEntriesByReference(handle.db, "event", event.id)).toHaveLength(0);
    expect(await getLedgerBalance(handle.db, healer.id, "buffunfa")).toBe(0n);
  });
});
