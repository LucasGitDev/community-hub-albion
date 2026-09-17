import "reflect-metadata";
import { banUser, createDb, findUserIdByDiscordId, runMigrations, schema, unbanUser, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventSignupInteractions, type EventButtonInteraction } from "./event-signup.interactions.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do botão de inscrição não podem ser pulados");

const user = (discordId: string): EventButtonInteraction["user"] => ({ id: discordId, username: `u${discordId.slice(-3)}`, globalName: null, avatar: null });

/**
 * Botão de inscrição do embed x banimento (TASK-050).
 *
 * O caso que importa: hoje o botão **cria conta** para quem não tem (TASK-037). Se a checagem de banimento
 * viesse depois disso, um banido viraria uma conta nova e limpa só por clicar — que é exatamente o furo que
 * este teste tranca.
 */
describe.skipIf(!baseUrl)("banido no botão de inscrição (TASK-050)", () => {
  let handle: DbHandle;
  let interactions: EventSignupInteractions;
  const accounts = { ensureFromDiscord: vi.fn() };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_bot_signup_ban`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    interactions = new EventSignupInteractions({} as never, {} as never, handle, accounts as never);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("banido é recusado com o motivo e sem virar conta nova", async () => {
    const staffer = await upsertUserByDiscordId(handle.db, { discordId: "810000000000000001", discordUsername: "staffer" });
    const alvo = await upsertUserByDiscordId(handle.db, { discordId: "810000000000000002", discordUsername: "alvo" });
    expect((await banUser(handle.db, { userId: alvo.id, actorId: staffer.id, reason: "roubou o loot do split" })).ok).toBe(true);

    const res = await interactions.authorize(user("810000000000000002"));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain("roubou o loot do split");
    expect(accounts.ensureFromDiscord).not.toHaveBeenCalled();

    // Desbanido, o botão volta a funcionar.
    expect((await unbanUser(handle.db, alvo.id)).ok).toBe(true);
    await handle.db.insert(schema.userRoles).values({ userId: alvo.id, role: "member" });
    const depois = await interactions.authorize(user("810000000000000002"));
    expect(depois).toMatchObject({ ok: true, userId: alvo.id, accountCreated: false });
  });

  it("quem nunca teve conta e não está banido segue criando conta no clique (TASK-037 intacta)", async () => {
    accounts.ensureFromDiscord.mockImplementation(async (profile: { discordId: string; discordUsername: string }) => {
      const created = await upsertUserByDiscordId(handle.db, profile);
      await handle.db.insert(schema.userRoles).values({ userId: created.id, role: "member" });
      return { user: created, created: true };
    });
    const res = await interactions.authorize(user("810000000000000003"));
    expect(res).toMatchObject({ ok: true, accountCreated: true });
    expect(await findUserIdByDiscordId(handle.db, "810000000000000003")).toBeTruthy();
  });

  it("banido nunca chega a existir como conta pelo botão", async () => {
    // Conta banida apagada da tabela de papéis não muda nada: a recusa é pelo snowflake, antes de tudo.
    const staffer = await upsertUserByDiscordId(handle.db, { discordId: "810000000000000004", discordUsername: "staffer2" });
    const alvo = await upsertUserByDiscordId(handle.db, { discordId: "810000000000000005", discordUsername: "alvo2" });
    await banUser(handle.db, { userId: alvo.id, actorId: staffer.id, reason: "vendeu prata fora" });
    await handle.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, alvo.id));
    const res = await interactions.authorize(user("810000000000000005"));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toContain("vendeu prata fora");
  });
});
