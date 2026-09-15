import { describe, expect, it } from "vitest";
import { describeDiscordError } from "./discord-errors.js";

const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

describe("describeDiscordError", () => {
  it("50001 orienta a convidar o bot com applications.commands", () => {
    expect(describeDiscordError(discordError(50001, "Missing Access"))).toContain('"bot" e "applications.commands"');
  });

  it("50013 orienta a revisar permissões", () => {
    expect(describeDiscordError(discordError(50013, "Missing Permissions"))).toContain("Bot sem permissão");
  });

  it("10007 explica que o membro não está na guild", () => {
    expect(describeDiscordError(discordError(10007, "Unknown Member"))).toContain("Membro não está na guild");
  });

  it("dono da guild orienta ajuste manual", () => {
    expect(describeDiscordError(Object.assign(new Error("Dono"), { code: "GUILD_OWNER_NICKNAME" }))).toContain("manualmente");
  });

  it("outros erros e valores não-Error", () => {
    expect(describeDiscordError(new Error("boom"))).toBe("Erro do cliente Discord: boom");
    expect(describeDiscordError("x")).toBe("Erro do cliente Discord: x");
  });
});
