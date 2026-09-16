import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, getImportedMember, grantRole, importDiscordMember, listRoles, runMigrations, schema, setAlbionCheck, setGameNick, type DbHandle } from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do import de membros não podem ser pulados");

describe.skipIf(!baseUrl)("import de membros do Discord (TASK-042, Postgres real)", () => {
  let handle: DbHandle;
  let seq = 0;
  const nextDiscordId = () => `9100000000000000${String(++seq).padStart(2, "0")}`;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_member_import`;
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

  const importMember = (discordId: string, nick: string, guildTag: string | null = "GENEI") =>
    importDiscordMember(handle.db, { profile: { discordId, discordUsername: `u${discordId.slice(-2)}` }, guildTag, nick });

  it("cria a conta com nick, tag de guilda e papel member (AC#2, AC#6)", async () => {
    const discordId = nextDiscordId();
    const result = await importMember(discordId, "Erijj");
    expect(result).toMatchObject({ created: true, nickApplied: true, keptNick: null, roleGranted: true, guildTagChanged: true });

    const snapshot = await getImportedMember(handle.db, discordId);
    expect(snapshot).toMatchObject({ gameNick: "Erijj", guildTag: "GENEI", albionStatus: null, albionCheckedAt: null });
    expect(await listRoles(handle.db, result.userId)).toContain("member");
  });

  it("guarda apelido sem tag de guilda", async () => {
    const discordId = nextDiscordId();
    await importMember(discordId, "SemTag", null);
    expect(await getImportedMember(handle.db, discordId)).toMatchObject({ gameNick: "SemTag", guildTag: null });
  });

  it("reexecutar não duplica conta nem muda nada (AC#4)", async () => {
    const discordId = nextDiscordId();
    const first = await importMember(discordId, "Erijj");
    const second = await importMember(discordId, "Erijj");
    expect(second).toMatchObject({ userId: first.userId, created: false, nickApplied: false, keptNick: "Erijj", roleGranted: false, guildTagChanged: false });

    const rows = await handle.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.discordId, discordId));
    expect(rows).toHaveLength(1);
    expect(await listRoles(handle.db, first.userId)).toEqual(["member"]);
  });

  it("nunca sobrescreve nick já aprovado no painel (AC#4)", async () => {
    const discordId = nextDiscordId();
    const created = await importMember(discordId, "Aprovado");
    await setGameNick(handle.db, created.userId, "AprovadoNoPainel");

    const again = await importMember(discordId, "OutroDoApelido");
    expect(again).toMatchObject({ created: false, nickApplied: false, keptNick: "AprovadoNoPainel" });
    expect(await getImportedMember(handle.db, discordId)).toMatchObject({ gameNick: "AprovadoNoPainel" });
  });

  it("conta que já existe sem nick recebe nick, tag e papel sem virar conta nova", async () => {
    const discordId = nextDiscordId();
    const existing = await handle.db.insert(schema.users).values({ discordId, discordUsername: "antigo" }).returning();
    await grantRole(handle.db, existing[0]!.id, "staff");

    const result = await importMember(discordId, "Erijj", "NOVA");
    expect(result).toMatchObject({ userId: existing[0]!.id, created: false, nickApplied: true, keptNick: null, roleGranted: true, guildTagChanged: true });
    expect(await listRoles(handle.db, existing[0]!.id)).toEqual(["member", "staff"]);
  });

  it("grava a conferência do Albion com data (AC#7)", async () => {
    const discordId = nextDiscordId();
    const { userId } = await importMember(discordId, "Erijj");
    const checkedAt = new Date("2026-09-16T12:00:00.000Z");
    await setAlbionCheck(handle.db, userId, { status: "found", playerId: "abc123", guildName: "Genei", checkedAt });
    expect(await getImportedMember(handle.db, discordId)).toMatchObject({
      albionStatus: "found",
      albionPlayerId: "abc123",
      albionGuildName: "Genei",
      albionCheckedAt: checkedAt,
    });
  });

  it("not_found e unavailable gravam só status e data, sem dados de jogador", async () => {
    const discordId = nextDiscordId();
    const { userId } = await importMember(discordId, "Erijj");
    await setAlbionCheck(handle.db, userId, { status: "found", playerId: "abc123", guildName: "Genei", checkedAt: new Date() });
    await setAlbionCheck(handle.db, userId, { status: "not_found", checkedAt: new Date("2026-09-16T13:00:00.000Z") });
    expect(await getImportedMember(handle.db, discordId)).toMatchObject({ albionStatus: "not_found", albionPlayerId: null, albionGuildName: null });

    await setAlbionCheck(handle.db, userId, { status: "unavailable", checkedAt: new Date("2026-09-16T14:00:00.000Z") });
    expect(await getImportedMember(handle.db, discordId)).toMatchObject({ albionStatus: "unavailable", albionPlayerId: null, albionGuildName: null });
  });

  it("getImportedMember devolve null para quem não existe", async () => {
    expect(await getImportedMember(handle.db, "910000000000000099")).toBeNull();
  });
});
