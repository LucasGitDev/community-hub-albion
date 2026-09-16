import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, grantRole, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { Role } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { emptyImportSummary, IMPORT_MEMBERS_REPLIES } from "../domain/member-import.js";
import { DiscordMemberImportService } from "../members/discord-member-import.service.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import { ImportMembersCommand, type ImportMembersInteraction } from "./import-members.command.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do /importar-membros não podem ser pulados");

const GUILD = "123456789012345678";

function fakeInteraction(discordId: string, guildId: string | null = GUILD) {
  const replies: string[] = [];
  const interaction = {
    guildId,
    user: { id: discordId },
    reply: vi.fn(async ({ content }: { content: string }) => void replies.push(content)),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async ({ content }: { content: string }) => void replies.push(content)),
  };
  return { interaction: interaction as unknown as ImportMembersInteraction & typeof interaction, replies };
}

describe.skipIf(!baseUrl)("/importar-membros (TASK-042, Postgres real + serviço falso)", () => {
  let handle: DbHandle;
  let command: ImportMembersCommand;
  let close: () => Promise<void>;
  const importer = { import: vi.fn<DiscordMemberImportService["import"]>() };
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_import_members_command`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportMembersCommand,
        { provide: DiscordMemberImportService, useValue: importer },
        { provide: DB_HANDLE, useValue: handle },
        { provide: DISCORD_GUILD_ID, useValue: GUILD },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    command = moduleRef.get(ImportMembersCommand);
    close = () => app.close();
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => {
    importer.import.mockReset().mockResolvedValue({ ...emptyImportSummary(), created: 24, skipped: 8 });
  });

  async function userWith(...roles: Role[]) {
    seq++;
    const discordId = `9300000000000000${String(seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${seq}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    return discordId;
  }

  it("admin importa e recebe o resumo efêmero (AC#1)", async () => {
    const { interaction, replies } = fakeInteraction(await userWith("member", "admin"));
    await command.onImport([interaction]);
    expect(importer.import).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(replies[0]).toContain("**24** criados");
  });

  it.each([
    ["sem papel nenhum", [] as Role[]],
    ["só member", ["member"] as Role[]],
    ["staff (não é admin)", ["member", "staff"] as Role[]],
    ["caller", ["member", "caller"] as Role[]],
  ])("recusa quem não é admin: %s", async (_label, roles) => {
    const { interaction, replies } = fakeInteraction(await userWith(...roles));
    await command.onImport([interaction]);
    expect(importer.import).not.toHaveBeenCalled();
    expect(replies).toEqual([IMPORT_MEMBERS_REPLIES.notAdmin]);
    expect(interaction.reply).toHaveBeenCalledWith({ content: IMPORT_MEMBERS_REPLIES.notAdmin, flags: MessageFlags.Ephemeral });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it("recusa quem nunca entrou no painel", async () => {
    const { interaction, replies } = fakeInteraction("930000000000000099");
    await command.onImport([interaction]);
    expect(importer.import).not.toHaveBeenCalled();
    expect(replies).toEqual([IMPORT_MEMBERS_REPLIES.notAdmin]);
  });

  it("recusa fora da guild configurada, antes de tocar o banco", async () => {
    const { interaction, replies } = fakeInteraction(await userWith("admin"), null);
    await command.onImport([interaction]);
    expect(importer.import).not.toHaveBeenCalled();
    expect(replies).toEqual([IMPORT_MEMBERS_REPLIES.wrongGuild]);
  });

  it("403 do Discord vira instrução de ligar o Server Members Intent", async () => {
    importer.import.mockRejectedValue(Object.assign(new Error("Missing Access"), { status: 403 }));
    const { interaction, replies } = fakeInteraction(await userWith("admin"));
    vi.spyOn((command as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    await command.onImport([interaction]);
    expect(replies[0]).toContain("Server Members Intent");
  });

  it("falha genérica responde erro amigável sem vazar detalhe", async () => {
    importer.import.mockRejectedValue(new Error("db down"));
    const { interaction, replies } = fakeInteraction(await userWith("admin"));
    vi.spyOn((command as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    await command.onImport([interaction]);
    expect(replies).toEqual([IMPORT_MEMBERS_REPLIES.failed]);
    expect(replies[0]).not.toContain("db down");
  });
});
