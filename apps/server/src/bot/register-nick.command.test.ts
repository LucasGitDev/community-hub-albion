import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { createDb, createSession, findUserIdByDiscordId, grantRole, listRoles, runMigrations, schema, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { MessageFlags } from "discord.js";
import { eq, sql } from "drizzle-orm";
import { SlashCommand } from "necord";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";
import { NickRegistrationService } from "../members/nick-registration.service.js";
import { NickRequestService, type NickRequestedEvent } from "../members/nick-request.service.js";
import { RegisterNickCommand, type SlashInteractionLike } from "./register-nick.command.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do /registrar não podem ser pulados");

const GUILD = "123456789012345678";
const BOOTSTRAP_ADMIN = "700000000000000099";
const PUBLIC_URL = "http://localhost:3000";
const albionCalls: string[] = [];
const hangingAlbion = { lookup: (nick: string) => (albionCalls.push(nick), new Promise<never>(() => undefined)) };

function fakeInteraction(discordId: string, guildId: string | null = GUILD) {
  const replies: string[] = [];
  const interaction = {
    guildId,
    user: { id: discordId, username: `user${discordId.slice(-3)}`, globalName: `Global ${discordId.slice(-3)}`, avatar: "abc" },
    reply: vi.fn(async (o: { content: string; flags: MessageFlags.Ephemeral }) => void replies.push(o.content)),
    deferReply: vi.fn(async (_o: { flags: MessageFlags.Ephemeral }) => undefined),
    editReply: vi.fn(async (o: { content: string }) => void replies.push(o.content)),
  } satisfies SlashInteractionLike;
  return { interaction, replies };
}

describe("/registrar metadados Necord (TASK-035)", () => {
  it("registra slash command registrar com opção string nick obrigatória 3–16 (AC#1)", () => {
    const handler = RegisterNickCommand.prototype.onRegister;
    expect(JSON.parse(JSON.stringify(new Reflector().get(SlashCommand, handler)))).toMatchObject({ name: "registrar", description: expect.stringContaining("nick") });
    expect(Reflect.getMetadata("necord:options_meta", handler)).toEqual({
      nick: expect.objectContaining({ name: "nick", required: true, min_length: 3, max_length: 16, resolver: "getString" }),
    });
  });
});

describe.skipIf(!baseUrl)("/registrar nick pelo Discord (TASK-035, Postgres real + interação falsa)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let command: RegisterNickCommand;
  const events: NickRequestedEvent[] = [];

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_register_nick`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const parsed = parseEnv({
      DISCORD_TOKEN: "a.b.c",
      GUILD_ID: GUILD,
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_MEMBER_ROLE_ID: "323456789012345678",
      DISCORD_STAFF_CHANNEL_ID: "423456789012345678",
      DISCORD_EVENTS_CHANNEL_ID: "523456789012345678",
      BOOTSTRAP_ADMIN_DISCORD_IDS: BOOTSTRAP_ADMIN,
      PUBLIC_URL,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] })
      .overrideProvider(ALBION_PLAYER_LOOKUP)
      .useValue(hangingAlbion)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    // Hook do embed da staff (TASK-015) assina o mesmo serviço: aqui um listener registra o disparo.
    app.get(NickRequestService).onRequested((e) => void events.push(e));
    command = new RegisterNickCommand(app.get(NickRegistrationService), GUILD);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  const run = async (discordId: string, nick: string, guildId: string | null = GUILD) => {
    const fake = fakeInteraction(discordId, guildId);
    await command.onRegister([fake.interaction], { nick });
    return fake;
  };
  const requestsOf = async (userId: string) =>
    (await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.userId, userId))).map((r) => [r.nick, r.status]);

  it("usuário novo: criado da conta Discord com papel member, pedido pending, hook do embed e consulta Albion disparados (AC#1, AC#2)", async () => {
    const { interaction, replies } = await run("700000000000000001", "  Ravenmoor ");
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(replies).toEqual([expect.stringContaining("**Ravenmoor** enviado para aprovação")]);
    const userId = await findUserIdByDiscordId(handle.db, "700000000000000001");
    expect(userId).not.toBeNull();
    const [user] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId!));
    expect(user).toMatchObject({ discordUsername: "user001", displayName: "Global 001", avatar: "abc", gameNick: null });
    expect(await listRoles(handle.db, userId!)).toEqual(["member"]);
    expect(await requestsOf(userId!)).toEqual([["Ravenmoor", "pending"]]);
    expect(events.map((e) => [e.created, e.request.nick, e.request.userId])).toEqual([[true, "Ravenmoor", userId]]);
    expect(albionCalls).toContain("Ravenmoor");
  });

  it("segundo comando corrige a pendência sem duplicar (AC#3, AC#4)", async () => {
    await run("700000000000000002", "Thalya");
    const { replies } = await run("700000000000000002", "ThalyaReal");
    expect(replies[0]).toContain("pedido pendente foi corrigido para **ThalyaReal**");
    const userId = (await findUserIdByDiscordId(handle.db, "700000000000000002"))!;
    expect(await requestsOf(userId)).toEqual([["ThalyaReal", "pending"]]);
    expect(events.map((e) => e.created)).toEqual([true, false]);
  });

  it("troca: nick vigente e papéis mantidos até aprovar; mesmo nick responde já é o seu (AC#3, AC#4, Q31)", async () => {
    const user = await upsertUserByDiscordId(handle.db, { discordId: "700000000000000003", discordUsername: "old" });
    await grantRole(handle.db, user.id, "staff");
    await setGameNick(handle.db, user.id, "Grimwald");
    const same = await run("700000000000000003", "grimwald");
    expect(same.replies).toEqual(["**Grimwald** já é o seu nick atual. Nada foi enviado."]);
    expect(await requestsOf(user.id)).toEqual([]);
    expect(events).toEqual([]);
    const change = await run("700000000000000003", "GrimwaldII");
    expect(change.replies[0]).toContain("continua como **Grimwald**, com o mesmo acesso");
    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row!.gameNick).toBe("Grimwald");
    expect(await listRoles(handle.db, user.id)).toEqual(["member", "staff"]);
  });

  it("nick inválido: mostra a regra e não cria usuário nem pedido (AC#3, AC#4)", async () => {
    const { replies } = await run("700000000000000004", "Kes trel!");
    expect(replies[0]).toContain("só letras e números");
    expect(await findUserIdByDiscordId(handle.db, "700000000000000004")).toBeNull();
    expect(events).toEqual([]);
  });

  it("fora da guild configurada (outro servidor ou DM): recusa efêmera sem tocar o banco (AC#5)", async () => {
    for (const guildId of ["999999999999999999", null]) {
      const { interaction, replies } = await run("700000000000000005", "OutraGuild", guildId);
      expect(interaction.reply).toHaveBeenCalledWith({ content: "Esse comando só funciona no servidor da guilda.", flags: MessageFlags.Ephemeral });
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(replies).toHaveLength(1);
    }
    expect(await findUserIdByDiscordId(handle.db, "700000000000000005")).toBeNull();
  });

  it("id do BOOTSTRAP_ADMIN_DISCORD_IDS recebe admin como no login; ninguém mais ganha papel acima de member", async () => {
    await run(BOOTSTRAP_ADMIN, "ChefeDaGuilda");
    expect(await listRoles(handle.db, (await findUserIdByDiscordId(handle.db, BOOTSTRAP_ADMIN))!)).toEqual(["member", "admin"]);
  });

  it("erro inesperado: loga e responde efêmero sem vazar detalhe; falha ao responder não lança", async () => {
    const broken = new RegisterNickCommand({ registerFromDiscord: () => Promise.reject(new Error("db down")) } as never, GUILD);
    const log = vi.spyOn((broken as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    const fake = fakeInteraction("700000000000000006");
    await broken.onRegister([fake.interaction], { nick: "Qualquer" });
    expect(fake.replies).toEqual(["Não consegui registrar seu nick agora. Tente de novo em instantes ou use o painel."]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db down"));

    const deferFails = fakeInteraction("700000000000000007");
    deferFails.interaction.deferReply.mockRejectedValue(new Error("Unknown interaction"));
    deferFails.interaction.reply.mockRejectedValue(new Error("Unknown interaction"));
    await expect(broken.onRegister([deferFails.interaction], { nick: "Qualquer" })).resolves.toBeUndefined();
    expect(deferFails.interaction.reply).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Não consegui responder"));
  });

  it("painel e comando produzem o mesmo resultado no banco (doc-002)", async () => {
    const panelUser = await upsertUserByDiscordId(handle.db, { discordId: "700000000000000008", discordUsername: "painel" });
    await grantRole(handle.db, panelUser.id, "member");
    await setGameNick(handle.db, panelUser.id, "Antigo");
    const { token } = await createSession(handle.db, panelUser.id, new Date(Date.now() + 3_600_000));
    const post = (nick: string) => request(app.getHttpServer()).post("/api/me/nick").set("Origin", PUBLIC_URL).set("Cookie", `ah_session=${token}`).send({ nick });

    const botUser = await upsertUserByDiscordId(handle.db, { discordId: "700000000000000009", discordUsername: "bot" });
    await grantRole(handle.db, botUser.id, "member");
    await setGameNick(handle.db, botUser.id, "Antigo");

    expect((await post("Primeiro")).status).toBe(201);
    expect((await post("Segundo")).status).toBe(200);
    expect((await post("antigo")).status).toBe(409);
    expect((await post("in valido")).status).toBe(400);
    for (const nick of ["Primeiro", "Segundo", "antigo", "in valido"]) await run("700000000000000009", nick);

    const shape = async (userId: string) => ({
      requests: await requestsOf(userId),
      roles: await listRoles(handle.db, userId),
      gameNick: (await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]!.gameNick,
    });
    expect(await shape(botUser.id)).toEqual(await shape(panelUser.id));
    expect(await shape(botUser.id)).toEqual({ requests: [["Segundo", "pending"]], roles: ["member"], gameNick: "Antigo" });
  });
});
