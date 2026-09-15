import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.s3cr3t-token_value";
const valid = { DISCORD_TOKEN: TOKEN, GUILD_ID: "123456789012345678" };

describe("parseEnv", () => {
  it("aceita config válida e aplica defaults", () => {
    const result = parseEnv(valid);
    expect(result).toEqual({
      ok: true,
      env: { DISCORD_TOKEN: TOKEN, GUILD_ID: "123456789012345678", PORT: 3000, NODE_ENV: "development", DISCORD_BOT_ENABLED: true },
    });
  });

  it("converte PORT e DISCORD_BOT_ENABLED", () => {
    const result = parseEnv({ ...valid, PORT: "8080", DISCORD_BOT_ENABLED: "false", NODE_ENV: "production" });
    expect(result.ok && result.env).toMatchObject({ PORT: 8080, DISCORD_BOT_ENABLED: false, NODE_ENV: "production" });
  });

  it("rejeita token e GUILD_ID ausentes listando as duas variáveis", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("DISCORD_TOKEN: obrigatória");
    expect(!result.ok && result.message).toContain("GUILD_ID: obrigatória");
  });

  it("rejeita valores vazios", () => {
    const result = parseEnv({ DISCORD_TOKEN: " ", GUILD_ID: "" });
    expect(!result.ok && result.message).toMatch(/DISCORD_TOKEN: obrigatória[\s\S]*GUILD_ID: obrigatória/);
  });

  it("rejeita GUILD_ID fora do formato snowflake", () => {
    const result = parseEnv({ ...valid, GUILD_ID: "minha-guild" });
    expect(!result.ok && result.message).toContain("GUILD_ID: formato inválido");
    expect(!result.ok && result.message).not.toContain("DISCORD_TOKEN");
  });

  it("rejeita PORT, NODE_ENV e DISCORD_BOT_ENABLED inválidos", () => {
    const result = parseEnv({ ...valid, PORT: "99999", NODE_ENV: "staging", DISCORD_BOT_ENABLED: "sim" });
    const message = !result.ok ? result.message : "";
    expect(message).toContain("PORT: deve estar entre 1 e 65535");
    expect(message).toContain("NODE_ENV:");
    expect(message).toContain("DISCORD_BOT_ENABLED: deve ser true ou false");
  });

  it("nunca inclui o valor do token na mensagem de erro", () => {
    const leaked = "segredo.muito.vazado!";
    const result = parseEnv({ DISCORD_TOKEN: leaked, GUILD_ID: "x" });
    expect(!result.ok && result.message).toContain("DISCORD_TOKEN: formato inválido");
    expect(!result.ok && result.message).not.toContain(leaked);
  });
});
