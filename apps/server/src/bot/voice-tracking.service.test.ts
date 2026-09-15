import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, listOpenVoiceSessions, runMigrations, schema, type DbHandle } from "@albion-hub/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { classifyVoiceUpdate } from "../domain/voice.js";
import { VOICE_CLOCK, VoiceTrackingService } from "./voice-tracking.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de voz não podem ser pulados");

const GUILD = "123456789012345678";
const USER = "400000000000000001";

/** Banco próprio deste arquivo (mesmo padrão de auth.http.test.ts). */
function isolatedUrl(url: string) {
  const name = `${new URL(url).pathname.slice(1)}_server_voice`;
  const target = new URL(url);
  target.pathname = `/${name}`;
  return { name, url: target.toString() };
}

describe.skipIf(!baseUrl)("VoiceTrackingService (TASK-018, Postgres real)", () => {
  let handle: DbHandle;
  let service: VoiceTrackingService;
  let now = new Date("2026-09-15T20:00:00Z");
  const tick = (min: number) => (now = new Date(now.getTime() + min * 60_000));

  const update = (oldChannelId: string | null, newChannelId: string | null, user = USER) =>
    service.apply({ discordUserId: user, guildId: GUILD, action: classifyVoiceUpdate({ oldChannelId, newChannelId }) });
  const sessionsOf = (user = USER) =>
    handle.db.select().from(schema.voiceSessions).where(eq(schema.voiceSessions.discordUserId, user)).orderBy(asc(schema.voiceSessions.startedAt));

  beforeAll(async () => {
    const target = isolatedUrl(baseUrl!);
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${target.name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${target.name}"`));
    await admin.close();
    await runMigrations(target.url);
    handle = createDb(target.url);
    const moduleRef = await Test.createTestingModule({
      providers: [VoiceTrackingService, { provide: DB_HANDLE, useValue: handle }, { provide: VOICE_CLOCK, useValue: () => now }],
    }).compile();
    service = moduleRef.get(VoiceTrackingService);
  });

  afterAll(async () => {
    await handle?.close();
  });

  beforeEach(async () => {
    await handle.db.delete(schema.voiceSessions);
    now = new Date("2026-09-15T20:00:00Z");
  });

  it("join abre sessão com início no relógio (AC#1)", async () => {
    await update(null, "c1");
    const [s] = await sessionsOf();
    expect(s).toMatchObject({ channelId: "c1", guildId: GUILD, endedAt: null });
    expect(s!.startedAt).toEqual(now);
  });

  it("leave fecha a sessão com horário de fim (AC#2)", async () => {
    await update(null, "c1");
    const end = tick(30);
    await update("c1", null);
    const [s] = await sessionsOf();
    expect(s!.endedAt).toEqual(end);
    expect(await listOpenVoiceSessions(handle.db, USER)).toHaveLength(0);
  });

  it("move fecha a anterior e abre no destino (AC#3)", async () => {
    await update(null, "c1");
    const moved = tick(10);
    await update("c1", "c2");
    const rows = await sessionsOf();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channelId: "c1", endedAt: moved });
    expect(rows[1]).toMatchObject({ channelId: "c2", endedAt: null, startedAt: moved });
  });

  it("leave sem sessão aberta é no-op", async () => {
    await update("c1", null);
    expect(await sessionsOf()).toHaveLength(0);
  });

  it("mute/deafen no mesmo canal não mexe na sessão", async () => {
    await update(null, "c1");
    tick(5);
    await update("c1", "c1");
    expect(await sessionsOf()).toHaveLength(1);
  });

  it("cadeia rápida de moves mantém exatamente uma sessão aberta", async () => {
    await update(null, "c1");
    await Promise.all([update("c1", "c2"), update("c2", "c3")]);
    await update("c3", "c4");
    await update("c4", "c5");
    const open = await listOpenVoiceSessions(handle.db, USER);
    expect(open).toHaveLength(1);
    expect(open[0]!.channelId).toBe("c5");
    expect(await listOpenVoiceSessions(handle.db)).toHaveLength(1);
  });

  it("usuários diferentes têm sessões independentes", async () => {
    await update(null, "c1", USER);
    await update(null, "c1", "400000000000000002");
    await update("c1", null, USER);
    expect(await listOpenVoiceSessions(handle.db)).toHaveLength(1);
  });

  it("erro de banco é logado sem lançar", async () => {
    const broken = { db: { transaction: () => Promise.reject(new Error("db down")) } } as unknown as DbHandle;
    const svc = new VoiceTrackingService(broken, () => now);
    const log = vi.spyOn((svc as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    await expect(svc.apply({ discordUserId: USER, guildId: GUILD, action: { kind: "join", channelId: "c1" } })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });
});
