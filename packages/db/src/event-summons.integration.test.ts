import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimEventSummons,
  createDb,
  createEvent,
  findEventSummon,
  listEventRoles,
  runMigrations,
  saveEventTemplate,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: o intervalo do chamado não pode ser pulado");

const FIVE_MIN = 5 * 60_000;

/**
 * Intervalo de 5 minutos por pessoa (TASK-087, PE15) contra Postgres de verdade: é o banco, e não o
 * processo, que decide quem pode ser chamado de novo — inclusive com dois cliques ao mesmo tempo.
 */
describe.skipIf(!baseUrl)("intervalo do chamado no privado (TASK-087, Postgres real)", () => {
  let handle: DbHandle;
  let owner: string;
  let templateId: string;
  let seq = 0;

  const user = async () => (await upsertUserByDiscordId(handle.db, { discordId: `76000000000000${String(++seq).padStart(4, "0")}`, discordUsername: `c${seq}` })).id;

  const event = async (name: string) => {
    const result = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!result.ok) throw new Error(result.reason);
    return result.event.id;
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_event_summons`;
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
      name: "Template do chamado",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [{ roleId: roles[0]!.id, slots: 5, buffunfaMin: 0n, buffunfaMax: 0n }],
    });
    if (!saved.ok) throw new Error(saved.reason);
    templateId = saved.template.id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("primeira chamada libera todo mundo e grava quando saiu", async () => {
    const eventId = await event("Primeiro chamado");
    const [a, b] = [await user(), await user()];
    const now = new Date("2026-09-21T20:00:00Z");

    expect((await claimEventSummons(handle.db, eventId, [a, b], { now, cooldownMs: FIVE_MIN })).sort()).toEqual([a, b].sort());
    expect(await findEventSummon(handle.db, eventId, a)).toEqual(now);
  });

  it("dentro dos 5 minutos ninguém é liberado de novo, e a marca do primeiro chamado não muda (AC#6)", async () => {
    const eventId = await event("Chamado repetido");
    const membro = await user();
    const now = new Date("2026-09-21T20:00:00Z");
    await claimEventSummons(handle.db, eventId, [membro], { now, cooldownMs: FIVE_MIN });

    const again = new Date(now.getTime() + FIVE_MIN - 1000);
    expect(await claimEventSummons(handle.db, eventId, [membro], { now: again, cooldownMs: FIVE_MIN })).toEqual([]);
    expect(await findEventSummon(handle.db, eventId, membro)).toEqual(now);
  });

  it("passados os 5 minutos a mesma pessoa é liberada e a marca avança", async () => {
    const eventId = await event("Chamado depois do intervalo");
    const membro = await user();
    const now = new Date("2026-09-21T20:00:00Z");
    await claimEventSummons(handle.db, eventId, [membro], { now, cooldownMs: FIVE_MIN });

    const later = new Date(now.getTime() + FIVE_MIN);
    expect(await claimEventSummons(handle.db, eventId, [membro], { now: later, cooldownMs: FIVE_MIN })).toEqual([membro]);
    expect(await findEventSummon(handle.db, eventId, membro)).toEqual(later);
  });

  it("o intervalo é por evento: ser chamado num evento não cala o chamado do outro", async () => {
    const [um, outro] = [await event("Evento um"), await event("Evento dois")];
    const membro = await user();
    const now = new Date("2026-09-21T20:00:00Z");
    await claimEventSummons(handle.db, um, [membro], { now, cooldownMs: FIVE_MIN });
    expect(await claimEventSummons(handle.db, outro, [membro], { now, cooldownMs: FIVE_MIN })).toEqual([membro]);
  });

  it("dois cliques ao mesmo tempo liberam a pessoa uma vez só (PE15)", async () => {
    const eventId = await event("Dois callers clicando");
    const membro = await user();
    const now = new Date("2026-09-21T20:00:00Z");
    const [painel, menu] = await Promise.all([
      claimEventSummons(handle.db, eventId, [membro], { now, cooldownMs: FIVE_MIN }),
      claimEventSummons(handle.db, eventId, [membro], { now, cooldownMs: FIVE_MIN }),
    ]);
    expect([...painel, ...menu]).toEqual([membro]);
  });
});
