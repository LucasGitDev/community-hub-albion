import { describe, expect, it } from "vitest";
import { describeMemberProfileChange, USER_NOTE_MAX_LENGTH, validateGuildTag, validateUserNote } from "./member-profile.js";

describe("validateGuildTag", () => {
  it("aceita letras e números e preserva a caixa", () => {
    expect(validateGuildTag("GENEI")).toEqual({ ok: true, guildTag: "GENEI" });
    expect(validateGuildTag(" Ge1 ")).toEqual({ ok: true, guildTag: "Ge1" });
  });

  it("tira os colchetes que o admin copia do apelido do Discord", () => {
    expect(validateGuildTag("[GENEI]")).toEqual({ ok: true, guildTag: "GENEI" });
  });

  it("vazio, nulo e indefinido significam sem guilda, não erro de preenchimento", () => {
    for (const input of ["", "   ", "[]", null, undefined]) expect(validateGuildTag(input)).toEqual({ ok: true, guildTag: null });
  });

  it("recusa espaço, símbolo, tag longa demais e valor que não é texto", () => {
    for (const input of ["GE NEI", "GENEI!", "A".repeat(11), 42]) expect(validateGuildTag(input).ok).toBe(false);
  });
});

describe("validateUserNote", () => {
  it("normaliza o texto e aceita até o limite", () => {
    expect(validateUserNote("  avisado sobre o nick  ")).toEqual({ ok: true, body: "avisado sobre o nick" });
    expect(validateUserNote("x".repeat(USER_NOTE_MAX_LENGTH))).toEqual({ ok: true, body: "x".repeat(USER_NOTE_MAX_LENGTH) });
  });

  it("recusa nota vazia, só espaço, longa demais ou que não é texto", () => {
    for (const input of ["", "   ", "x".repeat(USER_NOTE_MAX_LENGTH + 1), null, 7]) expect(validateUserNote(input).ok).toBe(false);
  });
});

describe("describeMemberProfileChange", () => {
  const base = { nick: { from: "Erijj", to: "Erijj" }, guildTag: { from: "GENEI", to: "GENEI" } };

  it("descreve só o que mudou", () => {
    expect(describeMemberProfileChange({ ...base, nick: { from: "Erijj", to: "Erijjo" } })).toBe("Editou nick Erijj → Erijjo.");
    expect(describeMemberProfileChange({ ...base, guildTag: { from: "GENEI", to: null } })).toBe("Editou tag de guilda GENEI → vazio.");
  });

  it("junta as duas mudanças numa nota só", () => {
    expect(describeMemberProfileChange({ nick: { from: null, to: "Erijj" }, guildTag: { from: null, to: "GENEI" } })).toBe(
      "Editou nick vazio → Erijj e tag de guilda vazio → GENEI.",
    );
  });

  it("devolve null quando nada mudou: histórico não guarda linha vazia", () => {
    expect(describeMemberProfileChange(base)).toBeNull();
  });
});
