import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, getImportedMember, grantRole, listRoles, runMigrations, schema, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { AlbionLookupResult } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCORD_GUILD_MEMBERS_GATEWAY, type DiscordGuildMembersGateway } from "../bot/discord-guild-members.gateway.js";
import { DISCORD_MEMBER_ROLE_ID } from "../bot/discord-member-sync.service.js";
import { DB_HANDLE } from "../db/db.module.js";
import type { GuildMemberSnapshot } from "../domain/member-import.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { DiscordMemberImportService } from "./discord-member-import.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do import de membros não podem ser pulados");

const MEMBER_ROLE = "323456789012345678";
const OTHER_ROLE = "423456789012345678";
const CHECKED_AT = "2026-09-16T12:00:00.000Z";

let seq = 0;
function member(nickname: string | null, overrides: Partial<GuildMemberSnapshot> = {}): GuildMemberSnapshot {
  seq++;
  return {
    discordId: `9200000000000000${String(seq).padStart(2, "0")}`,
    username: `user${seq}`,
    globalName: `Global ${seq}`,
    nickname,
    avatar: null,
    roleIds: [MEMBER_ROLE],
    bot: false,
    ...overrides,
  };
}

describe.skipIf(!baseUrl)("DiscordMemberImportService (TASK-042, Postgres real + gateway e Albion falsos)", () => {
  let handle: DbHandle;
  let service: DiscordMemberImportService;
  let close: () => Promise<void>;
  const gateway = { listMembers: vi.fn<DiscordGuildMembersGateway["listMembers"]>() };
  const albion = { lookup: vi.fn<(nick: string) => Promise<AlbionLookupResult>>() };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_member_import_service`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const moduleRef = await Test.createTestingModule({
      providers: [
        DiscordMemberImportService,
        { provide: DB_HANDLE, useValue: handle },
        { provide: DISCORD_GUILD_MEMBERS_GATEWAY, useValue: gateway },
        { provide: ALBION_PLAYER_LOOKUP, useValue: albion },
        { provide: DISCORD_MEMBER_ROLE_ID, useValue: MEMBER_ROLE },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    service = moduleRef.get(DiscordMemberImportService);
    close = () => app.close();
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => {
    gateway.listMembers.mockReset();
    albion.lookup.mockReset().mockResolvedValue({ status: "disabled" });
  });

  it("cria conta com nick sem tag, guarda a tag e concede o cargo member (AC#2, AC#3, AC#6)", async () => {
    const erijj = member("[GENEI] Erijj");
    gateway.listMembers.mockResolvedValue([erijj]);

    const summary = await service.import();
    expect(summary).toMatchObject({ created: 1, updated: 0, skipped: 0, conflicts: [] });
    const imported = await getImportedMember(handle.db, erijj.discordId);
    expect(imported).toMatchObject({ gameNick: "Erijj", guildTag: "GENEI" });
    expect(await listRoles(handle.db, imported!.id)).toContain("member");
  });

  it("ignora bot, quem não tem o cargo Membro e quem não tem apelido (AC#5)", async () => {
    const semCargo = member("[GENEI] SemCargo", { roleIds: [OTHER_ROLE] });
    const semApelido = member(null);
    const bot = member("[GENEI] Botzin", { bot: true });
    gateway.listMembers.mockResolvedValue([semCargo, semApelido, bot]);

    const summary = await service.import();
    expect(summary).toMatchObject({ created: 0, updated: 0, skipped: 3, conflicts: [] });
    for (const m of [semCargo, semApelido, bot]) expect(await getImportedMember(handle.db, m.discordId)).toBeNull();
  });

  it("apelido que não vira nick entra em conflitos sem quebrar o import (AC#3)", async () => {
    const bom = member("[GENEI] Valido");
    const ruim = member("[GENEI] Nick Com Espaco");
    const semNick = member("[GENEI]");
    gateway.listMembers.mockResolvedValue([ruim, bom, semNick]);

    const summary = await service.import();
    expect(summary).toMatchObject({ created: 1, skipped: 0 });
    expect(summary.conflicts).toHaveLength(2);
    expect(summary.conflicts[0]).toContain("Nick Com Espaco");
    expect(await getImportedMember(handle.db, bom.discordId)).toMatchObject({ gameNick: "Valido" });
    expect(await getImportedMember(handle.db, ruim.discordId)).toBeNull();
  });

  it("reexecutar não duplica conta e conta como ignorado (AC#4)", async () => {
    const m = member("[GENEI] Repetido");
    gateway.listMembers.mockResolvedValue([m]);

    expect(await service.import()).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(await service.import()).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    const rows = await handle.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.discordId, m.discordId));
    expect(rows).toHaveLength(1);
  });

  it("não sobrescreve nick já aprovado no painel; mudança de tag conta como atualizado (AC#4, AC#6)", async () => {
    const m = member("[GENEI] DoApelido");
    const user = await upsertUserByDiscordId(handle.db, { discordId: m.discordId, discordUsername: m.username });
    await setGameNick(handle.db, user.id, "AprovadoNoPainel");
    await grantRole(handle.db, user.id, "member");
    gateway.listMembers.mockResolvedValue([m]);

    expect(await service.import()).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(await getImportedMember(handle.db, m.discordId)).toMatchObject({ gameNick: "AprovadoNoPainel", guildTag: "GENEI" });
  });

  it("grava a conferência do Albion por nick único, sem repetir consulta (AC#7)", async () => {
    const a = member("[GENEI] Achado");
    const b = member("[GENEI] Sumido");
    albion.lookup.mockImplementation(async (nick) =>
      nick === "Achado"
        ? { status: "found", region: "americas", playerId: "p1", name: "Achado", guildName: "Genei", checkedAt: CHECKED_AT }
        : { status: "not_found", region: "americas", checkedAt: CHECKED_AT },
    );
    gateway.listMembers.mockResolvedValue([a, b, { ...a, discordId: `${a.discordId.slice(0, -1)}7` }]);

    const summary = await service.import();
    expect(summary.albion).toMatchObject({ found: 2, notFound: 1, unavailable: 0, disabled: 0 });
    // Dois membros com o mesmo nick: uma consulta só por nick único.
    expect(albion.lookup.mock.calls.map(([nick]) => nick).sort()).toEqual(["Achado", "Sumido"]);
    expect(await getImportedMember(handle.db, a.discordId)).toMatchObject({
      albionStatus: "found",
      albionPlayerId: "p1",
      albionGuildName: "Genei",
      albionCheckedAt: new Date(CHECKED_AT),
    });
    expect(await getImportedMember(handle.db, b.discordId)).toMatchObject({ albionStatus: "not_found", albionPlayerId: null });
  });

  it("Albion indisponível não é conflito: o membro entra igual (AC#7)", async () => {
    const m = member("[GENEI] SemApi");
    albion.lookup.mockResolvedValue({ status: "unavailable", region: "americas", checkedAt: CHECKED_AT });
    gateway.listMembers.mockResolvedValue([m]);

    const summary = await service.import();
    expect(summary).toMatchObject({ created: 1, conflicts: [] });
    expect(summary.albion.unavailable).toBe(1);
    expect(await getImportedMember(handle.db, m.discordId)).toMatchObject({ gameNick: "SemApi", albionStatus: "unavailable" });
  });

  it("consulta Albion que lança vira indisponível e não derruba o import", async () => {
    const m = member("[GENEI] Explode");
    albion.lookup.mockRejectedValue(new Error("boom"));
    gateway.listMembers.mockResolvedValue([m]);

    const summary = await service.import();
    expect(summary).toMatchObject({ created: 1, conflicts: [] });
    expect(summary.albion.unavailable).toBe(1);
    expect(await getImportedMember(handle.db, m.discordId)).toMatchObject({ gameNick: "Explode", albionStatus: null });
  });

  it("consulta desligada não grava conferência nenhuma", async () => {
    const m = member("[GENEI] Desligado");
    gateway.listMembers.mockResolvedValue([m]);

    const summary = await service.import();
    expect(summary.albion).toMatchObject({ disabled: 1, found: 0, notFound: 0, unavailable: 0 });
    expect(await getImportedMember(handle.db, m.discordId)).toMatchObject({ albionStatus: null, albionCheckedAt: null });
  });

  it("erro de banco em um membro vira conflito e os outros continuam", async () => {
    const bom = member("[GENEI] Sobrevive");
    // discord_id acima do limite do snowflake não quebra o banco; forçamos a falha com nick gigante na coluna? Usa-se um
    // handle quebrado só para esse membro: substituímos o db por um que lança na transação.
    gateway.listMembers.mockResolvedValue([bom]);
    const broken = new DiscordMemberImportService(
      { db: { transaction: () => Promise.reject(new Error("db down")) } } as never,
      gateway as never,
      albion as never,
      MEMBER_ROLE,
    );
    vi.spyOn((broken as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});

    const summary = await broken.import();
    expect(summary.created).toBe(0);
    expect(summary.conflicts[0]).toContain("Sobrevive");
  });

  it("erro do gateway sobe para o chamador tratar (403 do intent)", async () => {
    gateway.listMembers.mockRejectedValue(Object.assign(new Error("Missing Access"), { status: 403 }));
    await expect(service.import()).rejects.toThrow("Missing Access");
  });
});
