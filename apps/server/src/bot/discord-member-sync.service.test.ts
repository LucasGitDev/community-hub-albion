import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, requestNick, runMigrations, schema, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { NickDecisionService } from "../members/nick-decision.service.js";
import { DISCORD_GUILD_GATEWAY, type DiscordGuildGateway } from "./discord-guild.gateway.js";
import { DISCORD_MEMBER_ROLE_ID, DiscordMemberSync } from "./discord-member-sync.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do sync Discord não podem ser pulados");

const ROLE = "323456789012345678";
const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

describe.skipIf(!baseUrl)("DiscordMemberSync (TASK-014, Postgres real + gateway falso)", () => {
  let handle: DbHandle;
  let decisions: NickDecisionService;
  let sync: DiscordMemberSync;
  let close: () => Promise<void>;
  const gateway = { setNickname: vi.fn<DiscordGuildGateway["setNickname"]>(), addRole: vi.fn<DiscordGuildGateway["addRole"]>(), removeRole: vi.fn<DiscordGuildGateway["removeRole"]>() };
  let seq = 0;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_member_sync`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const moduleRef = await Test.createTestingModule({
      providers: [
        NickDecisionService,
        DiscordMemberSync,
        { provide: DB_HANDLE, useValue: handle },
        { provide: DISCORD_GUILD_GATEWAY, useValue: gateway },
        { provide: DISCORD_MEMBER_ROLE_ID, useValue: ROLE },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    decisions = moduleRef.get(NickDecisionService);
    sync = moduleRef.get(DiscordMemberSync);
    close = () => app.close();
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => {
    gateway.setNickname.mockReset().mockResolvedValue(undefined);
    gateway.addRole.mockReset().mockResolvedValue(undefined);
  });

  async function pending(nick: string, currentNick: string | null = null) {
    seq++;
    const discordId = `5000000000000000${String(seq).padStart(2, "0")}`;
    const staff = await upsertUserByDiscordId(handle.db, { discordId: `6000000000000000${String(seq).padStart(2, "0")}`, discordUsername: `staff${seq}` });
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${seq}` });
    if (currentNick) await setGameNick(handle.db, user.id, currentNick);
    const { request } = await requestNick(handle.db, user.id, nick);
    return { discordId, user, staff, request };
  }
  const gameNickOf = async (userId: string) => (await handle.db.select({ n: schema.users.gameNick }).from(schema.users).where(eq(schema.users.id, userId)))[0]!.n;

  it("primeira aprovação aplica apelido e concede cargo Membro (AC#1, AC#2)", async () => {
    const { discordId, staff, request } = await pending("Lucas");
    expect((await decisions.approve(request.id, staff.id)).ok).toBe(true);
    expect(gateway.setNickname).toHaveBeenCalledWith(discordId, "Lucas", expect.stringContaining(request.id));
    expect(gateway.addRole).toHaveBeenCalledWith(discordId, ROLE, expect.any(String));
  });

  it("troca de nick aprovada altera o apelido e garante o cargo Membro (TASK-034 AC#2, Q31 revisada)", async () => {
    const { discordId, staff, request } = await pending("Novo", "Antigo");
    await decisions.approve(request.id, staff.id);
    expect(gateway.setNickname).toHaveBeenCalledWith(discordId, "Novo", expect.any(String));
    expect(gateway.addRole).toHaveBeenCalledWith(discordId, ROLE, expect.stringContaining(request.id));
  });

  it("recusa não altera apelido nem cargos (AC#4)", async () => {
    const { staff, request, user } = await pending("Ruim", "Atual");
    await decisions.reject(request.id, staff.id, "nick não existe");
    const first = await pending("Ruim2");
    await decisions.reject(first.request.id, first.staff.id, "nick não existe");
    expect(gateway.setNickname).not.toHaveBeenCalled();
    expect(gateway.addRole).not.toHaveBeenCalled();
    expect(await gameNickOf(user.id)).toBe("Atual");
  });

  it("falha de permissão é logada, não lança e a aprovação fica gravada (AC#3)", async () => {
    const log = vi.spyOn((sync as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    gateway.setNickname.mockRejectedValue(discordError(50013, "Missing Permissions"));
    gateway.addRole.mockRejectedValue(discordError(10007, "Unknown Member"));
    const { user, staff, request } = await pending("SemPerm");
    const result = await decisions.approve(request.id, staff.id);
    expect(result).toMatchObject({ ok: true, request: { status: "approved" } });
    expect(gateway.addRole).toHaveBeenCalled(); // apelido falhar não impede o cargo
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/setNickname.*Bot sem permissão/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/addRole.*Membro não está na guild/));
    expect(await gameNickOf(user.id)).toBe("SemPerm");
    const [row] = await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.id, request.id));
    expect(row!.status).toBe("approved");
    log.mockRestore();
  });

  it("usuário inexistente ou erro de banco: loga e não chama o Discord", async () => {
    const log = vi.spyOn((sync as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    const event = { decision: "approved" as const, previousGameNick: null, deciderUserId: "x", request: { id: "r1", userId: "00000000-0000-0000-0000-000000000000", nick: "X" } };
    await sync.sync(event as never);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("não encontrado"));
    const broken = new DiscordMemberSync(decisions, { db: { select: () => { throw new Error("db down"); } } } as never, gateway, ROLE);
    const brokenLog = vi.spyOn((broken as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    await expect(broken.sync(event as never)).resolves.toBeUndefined();
    expect(brokenLog).toHaveBeenCalledWith(expect.stringContaining("db down"));
    expect(gateway.setNickname).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("onModuleDestroy remove o listener", async () => {
    sync.onModuleDestroy();
    const { staff, request } = await pending("Depois");
    await decisions.approve(request.id, staff.id);
    expect(gateway.setNickname).not.toHaveBeenCalled();
    sync.onModuleInit();
  });
});
