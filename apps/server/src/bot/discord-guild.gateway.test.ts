import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { BotModule } from "./bot.module.js";
import { DiscordJsGuildGateway, GUILD_OWNER_NICKNAME, type GuildClientLike } from "./discord-guild.gateway.js";

const GUILD = "123456789012345678";
const OWNER = "900000000000000001";
const MEMBER = "400000000000000001";

function setup() {
  const setNickname = vi.fn().mockResolvedValue(undefined);
  const add = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const membersFetch = vi.fn().mockResolvedValue({ setNickname, roles: { add, remove } });
  const guildsFetch = vi.fn().mockResolvedValue({ ownerId: OWNER, members: { fetch: membersFetch } });
  const client: GuildClientLike = { guilds: { fetch: guildsFetch } };
  return { gateway: new DiscordJsGuildGateway(client, GUILD), setNickname, add, remove, membersFetch, guildsFetch };
}

describe("DiscordJsGuildGateway (TASK-014, client falso)", () => {
  it("setNickname busca guild e membro e aplica com motivo", async () => {
    const { gateway, setNickname, membersFetch, guildsFetch } = setup();
    await gateway.setNickname(MEMBER, "Lucas", "motivo");
    expect(guildsFetch).toHaveBeenCalledWith(GUILD);
    expect(membersFetch).toHaveBeenCalledWith(MEMBER);
    expect(setNickname).toHaveBeenCalledWith("Lucas", "motivo");
  });

  it("addRole adiciona o cargo ao membro", async () => {
    const { gateway, add } = setup();
    await gateway.addRole(MEMBER, "323456789012345678", "motivo");
    expect(add).toHaveBeenCalledWith("323456789012345678", "motivo");
  });

  it("removeRole tira o cargo do membro sem expulsar ninguém da guild (TASK-050)", async () => {
    const { gateway, remove, membersFetch, guildsFetch } = setup();
    await gateway.removeRole(MEMBER, "323456789012345678", "Banido no painel: roubou o loot");
    expect(guildsFetch).toHaveBeenCalledWith(GUILD);
    expect(membersFetch).toHaveBeenCalledWith(MEMBER);
    expect(remove).toHaveBeenCalledWith("323456789012345678", "Banido no painel: roubou o loot");
  });

  it("dono da guild: erro claro sem chamar o Discord", async () => {
    const { gateway, setNickname } = setup();
    await expect(gateway.setNickname(OWNER, "Dono", "m")).rejects.toMatchObject({ code: GUILD_OWNER_NICKNAME });
    expect(setNickname).not.toHaveBeenCalled();
  });
});

describe("BotModule.register", () => {
  it("exige DISCORD_MEMBER_ROLE_ID", () => {
    expect(() => BotModule.register({ DISCORD_TOKEN: "a.b.c", GUILD_ID: GUILD, DISCORD_MEMBER_ROLE_ID: undefined, DISCORD_STAFF_CHANNEL_ID: "423456789012345678", DISCORD_EVENTS_CHANNEL_ID: "523456789012345678", DISCORD_WAITING_VOICE_CHANNEL_ID: "623456789012345678", DISCORD_EVENT_CATEGORY_ID: "723456789012345678", DISCORD_BUFFUNFA_EMOJI_ID: undefined, BUFFUNFA_EMOJI_FILE: "/tmp/buffunfa.png" })).toThrow("DISCORD_MEMBER_ROLE_ID");
  });
});
