import { describe, expect, it } from "vitest";
import { GUILD_TAG_MAX_LENGTH, normalizeDiscordNickname, parseDiscordNickname } from "./discord-nickname.js";

describe("parseDiscordNickname", () => {
  it("separa tag de guilda e nick no padrão real do servidor", () => {
    expect(parseDiscordNickname("[GENEI] Erijj")).toEqual({ ok: true, guildTag: "GENEI", nick: "Erijj" });
  });

  it("aceita apelido sem tag", () => {
    expect(parseDiscordNickname("Erijj")).toEqual({ ok: true, guildTag: null, nick: "Erijj" });
  });

  it("normaliza espaços repetidos, NBSP e bordas", () => {
    expect(parseDiscordNickname("  [GENEI]   Erijj  ")).toEqual({ ok: true, guildTag: "GENEI", nick: "Erijj" });
    expect(parseDiscordNickname("[GENEI] Erijj")).toEqual({ ok: true, guildTag: "GENEI", nick: "Erijj" });
    expect(parseDiscordNickname("[GENEI]Erijj")).toEqual({ ok: true, guildTag: "GENEI", nick: "Erijj" });
  });

  it("aceita tag com números e no limite de tamanho", () => {
    expect(parseDiscordNickname("[G3N] Lucas")).toEqual({ ok: true, guildTag: "G3N", nick: "Lucas" });
    const maxTag = "A".repeat(GUILD_TAG_MAX_LENGTH);
    expect(parseDiscordNickname(`[${maxTag}] Lucas`)).toEqual({ ok: true, guildTag: maxTag, nick: "Lucas" });
  });

  it.each([
    ["(GENEI) Erijj", "parênteses não são tag: viram nick inválido"],
    ["「GENEI」Erijj", "colchete japonês não é tag"],
    ["-GENEI- Erijj", "hífen não é tag"],
    ["[GENEI] Eri jj", "nick com espaço"],
    ["[GENEI] Éri", "nick com acento"],
    ["[GENEI] Er", "nick curto demais"],
    ["[GENEI] ErijjErijjErijjErijj", "nick longo demais"],
    ["[GENEI]", "só a tag, sem nick"],
    ["[] Erijj", "tag vazia"],
    ["[GUILDA MUITO GRANDE] Erijj", "tag com espaço e longa demais"],
    ["", "apelido vazio"],
    ["   ", "só espaços"],
  ])("recusa %s (%s)", (apelido) => {
    const result = parseDiscordNickname(apelido);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\S/);
  });

  it("recusa entrada que não é string (membro sem apelido)", () => {
    expect(parseDiscordNickname(null)).toEqual({ ok: false, error: "Apelido vazio no Discord." });
    expect(parseDiscordNickname(undefined).ok).toBe(false);
    expect(parseDiscordNickname(42).ok).toBe(false);
  });

  it("normalizeDiscordNickname devolve string vazia para não-string", () => {
    expect(normalizeDiscordNickname(null)).toBe("");
    expect(normalizeDiscordNickname(" a  b ")).toBe("a b");
  });
});
