import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { DiscordJsGuildMembersGateway, toGuildMemberSnapshot, type MembersClientLike } from "./discord-guild-members.gateway.js";

const GUILD = "123456789012345678";
const raw = (id: string, nick: string | null, roles: string[] = ["323456789012345678"], bot = false) => ({
  user: { id, username: `u${id.slice(-2)}`, global_name: `G${id.slice(-2)}`, avatar: "abc", bot },
  nick,
  roles,
});

const gatewayWith = (get: MembersClientLike["rest"]["get"]) => new DiscordJsGuildMembersGateway({ rest: { get } }, GUILD);

describe("DiscordJsGuildMembersGateway (TASK-042)", () => {
  it("lista os membros da guild pela REST", async () => {
    const get = vi.fn().mockResolvedValue([raw("920000000000000001", "[GENEI] Erijj"), raw("920000000000000002", null, [], true)]);
    const members = await gatewayWith(get).listMembers();

    expect(get).toHaveBeenCalledTimes(1);
    const [route, options] = get.mock.calls[0]!;
    expect(route).toBe(`/guilds/${GUILD}/members`);
    expect(options.query.get("limit")).toBe("1000");
    expect(members).toEqual([
      { discordId: "920000000000000001", username: "u01", globalName: "G01", nickname: "[GENEI] Erijj", avatar: "abc", roleIds: ["323456789012345678"], bot: false },
      { discordId: "920000000000000002", username: "u02", globalName: "G02", nickname: null, avatar: "abc", roleIds: [], bot: true },
    ]);
  });

  it("pagina com `after` quando a página vem cheia", async () => {
    const page = (start: number) => Array.from({ length: 1000 }, (_, i) => raw(`92000000000000${String(start + i).padStart(4, "0")}`, "Nick"));
    const get = vi.fn().mockResolvedValueOnce(page(0)).mockResolvedValueOnce([raw("930000000000000001", "Ultimo")]);
    const members = await gatewayWith(get).listMembers();

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]![1].query.get("after")).toBe("920000000000000999");
    expect(members).toHaveLength(1001);
  });

  it("resposta vazia ou fora do formato não quebra", async () => {
    expect(await gatewayWith(vi.fn().mockResolvedValue([])).listMembers()).toEqual([]);
    expect(await gatewayWith(vi.fn().mockResolvedValue({ message: "Missing Access" })).listMembers()).toEqual([]);
    expect(await gatewayWith(vi.fn().mockResolvedValue([null, {}, { user: { id: 1 } }, raw("920000000000000003", "Ok")])).listMembers()).toHaveLength(1);
  });

  it("erro da REST sobe para o chamador (403 sem o Server Members Intent)", async () => {
    const get = vi.fn().mockRejectedValue(Object.assign(new Error("Missing Access"), { status: 403 }));
    await expect(gatewayWith(get).listMembers()).rejects.toThrow("Missing Access");
  });

  it("toGuildMemberSnapshot descarta entrada sem id ou username", () => {
    expect(toGuildMemberSnapshot(null)).toBeNull();
    expect(toGuildMemberSnapshot({ user: { id: "1" } })).toBeNull();
    expect(toGuildMemberSnapshot({ user: { id: "1", username: "x" } })).toMatchObject({ discordId: "1", roleIds: [], globalName: null, avatar: null });
  });
});
