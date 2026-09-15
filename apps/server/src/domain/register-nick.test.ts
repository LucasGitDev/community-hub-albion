import { validateNick } from "@albion-hub/shared";
import { describe, expect, it } from "vitest";
import { buildRegisterReply, isConfiguredGuild, REGISTER_COMMAND } from "./register-nick.js";

describe("respostas do /registrar (TASK-035)", () => {
  it("comando PT-BR com opção nick limitada à regra do jogo (AC#1)", () => {
    expect(REGISTER_COMMAND.name).toBe("registrar");
    expect(REGISTER_COMMAND.option).toMatchObject({ name: "nick", minLength: 3, maxLength: 16 });
    expect(REGISTER_COMMAND.description.length).toBeLessThanOrEqual(100);
    expect(REGISTER_COMMAND.option.description.length).toBeLessThanOrEqual(100);
  });

  it("primeiro pedido: enviado para aprovação e o que acontece ao aprovar (AC#4)", () => {
    const text = buildRegisterReply({ kind: "requested", created: true, nick: "Ravenmoor", gameNick: null });
    expect(text).toContain("**Ravenmoor** enviado para aprovação");
    expect(text).toContain("cargo Membro");
  });

  it("troca: avisa que nick e acesso ficam até aprovar (Q31)", () => {
    const text = buildRegisterReply({ kind: "requested", created: true, nick: "Novo", gameNick: "Antigo" });
    expect(text).toContain("enviado para aprovação");
    expect(text).toContain("continua como **Antigo**, com o mesmo acesso");
  });

  it("pendente corrigido (AC#4)", () => {
    expect(buildRegisterReply({ kind: "requested", created: false, nick: "Certo", gameNick: null })).toContain("pedido pendente foi corrigido para **Certo**");
  });

  it("já é o nick atual e nick inválido com a regra (AC#4)", () => {
    expect(buildRegisterReply({ kind: "same_nick", gameNick: "Kestrel" })).toBe("**Kestrel** já é o seu nick atual. Nada foi enviado.");
    const invalid = validateNick("Kes trel!");
    if (invalid.ok) throw new Error("devia ser inválido");
    const text = buildRegisterReply({ kind: "invalid", error: invalid.error });
    expect(text).toContain("só letras e números");
    expect(text).toContain("3 a 16 caracteres");
  });

  it("só a guild configurada (AC#5)", () => {
    expect(isConfiguredGuild("123", "123")).toBe(true);
    expect(isConfiguredGuild("999", "123")).toBe(false);
    expect(isConfiguredGuild(null, "123")).toBe(false);
    expect(isConfiguredGuild(undefined, "123")).toBe(false);
  });
});
