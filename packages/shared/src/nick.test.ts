import { describe, expect, it } from "vitest";
import { sameNick, validateNick } from "./nick.js";

describe("validateNick (Q14, regra de nick do Albion)", () => {
  it.each(["Ravenmoor", "abc", "A1b2C3d4E5f6G7h8", "  Thalya  "])("aceita %j", (input) => {
    const res = validateNick(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.nick).toBe(input.trim());
  });

  it.each([
    [undefined, "Digite o nick"],
    ["   ", "Digite o nick"],
    ["ab", "de 3 a 16"],
    ["A1b2C3d4E5f6G7h8X", "de 3 a 16"],
    ["Raven moor", "só letras e números"],
    ["João", "só letras e números"],
    ["raven_moor", "só letras e números"],
    ["<script>", "só letras e números"],
  ])("recusa %j", (input, message) => {
    const res = validateNick(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(message);
  });

  it("sameNick ignora caixa e trata vazio como diferente", () => {
    expect(sameNick("Raven", "raven")).toBe(true);
    expect(sameNick("Raven", "Ravena")).toBe(false);
    expect(sameNick(null, "raven")).toBe(false);
  });
});
