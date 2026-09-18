import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.s3cr3t-token_value";
const DB = "postgres://albion:albion@localhost:5432/albion_hub";
const OAUTH = { DISCORD_CLIENT_ID: "223456789012345678", DISCORD_CLIENT_SECRET: "client-secret", PUBLIC_URL: "http://localhost:3000" };
const ROLE = "323456789012345678";
const CHANNEL = "423456789012345678";
const EVENTS_CHANNEL = "523456789012345678";
const WAITING_VOICE = "623456789012345678";
const EVENT_CATEGORY = "723456789012345678";
const valid = { DISCORD_TOKEN: TOKEN, GUILD_ID: "123456789012345678", DATABASE_URL: DB, DISCORD_MEMBER_ROLE_ID: ROLE, DISCORD_STAFF_CHANNEL_ID: CHANNEL, DISCORD_EVENTS_CHANNEL_ID: EVENTS_CHANNEL, DISCORD_WAITING_VOICE_CHANNEL_ID: WAITING_VOICE, DISCORD_EVENT_CATEGORY_ID: EVENT_CATEGORY, ...OAUTH };

describe("parseEnv", () => {
  it("aceita config válida e aplica defaults", () => {
    const result = parseEnv(valid);
    expect(result).toEqual({
      ok: true,
      env: {
        DISCORD_TOKEN: TOKEN,
        GUILD_ID: "123456789012345678",
        DATABASE_URL: DB,
        DISCORD_MEMBER_ROLE_ID: ROLE,
        DISCORD_STAFF_CHANNEL_ID: CHANNEL,
        DISCORD_EVENTS_CHANNEL_ID: EVENTS_CHANNEL,
        DISCORD_WAITING_VOICE_CHANNEL_ID: WAITING_VOICE,
        DISCORD_EVENT_CATEGORY_ID: EVENT_CATEGORY,
        ...OAUTH,
        SESSION_TTL_DAYS: 30,
        BOOTSTRAP_ADMIN_DISCORD_IDS: [],
        PORT: 3000,
        NODE_ENV: "development",
        DISCORD_BOT_ENABLED: true,
        RUN_MIGRATIONS: true,
        AUTH_DEV_LOGIN: false,
        WEB_DIST_DIR: expect.stringMatching(/apps[\\/]web[\\/]dist$/),
      // PNG do emoji da Buffunfa (F6-28): default no assets/ do repo, o Docker sobrescreve.
      BUFFUNFA_EMOJI_FILE: expect.stringMatching(/assets[\\/]buffunfa_emoji_simples_128\.png$/),
      },
    });
  });

  it("converte PORT e DISCORD_BOT_ENABLED", () => {
    const result = parseEnv({ ...valid, PORT: "8080", DISCORD_BOT_ENABLED: "false", NODE_ENV: "production", PUBLIC_URL: "https://painel.exemplo.com" });
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

  it("exige DATABASE_URL postgres", () => {
    const missing = parseEnv({ DISCORD_TOKEN: TOKEN, GUILD_ID: "123456789012345678", ...OAUTH });
    expect(!missing.ok && missing.message).toContain("DATABASE_URL: obrigatória");
    const wrong = parseEnv({ ...valid, DATABASE_URL: "mysql://x" });
    expect(!wrong.ok && wrong.message).toContain("DATABASE_URL: formato inválido");
    expect(!wrong.ok && wrong.message).not.toContain("mysql://x");
  });

  it("ALBION_REGION opcional: vazio desliga, região válida passa, outra é recusada (TASK-016, Q15)", () => {
    for (const source of [valid, { ...valid, ALBION_REGION: " " }]) {
      const result = parseEnv(source);
      expect(result.ok).toBe(true);
      expect(result.ok && result.env.ALBION_REGION).toBeUndefined();
    }
    expect(parseEnv({ ...valid, ALBION_REGION: " americas " })).toMatchObject({ ok: true, env: { ALBION_REGION: "americas" } });
    const bad = parseEnv({ ...valid, ALBION_REGION: "http://evil.example" });
    expect(!bad.ok && bad.message).toContain("ALBION_REGION: deve ser americas, europe ou asia");
    expect(!bad.ok && bad.message).not.toContain("evil");
  });

  describe("OAuth do painel (TASK-008)", () => {
    it("exige client id, secret e PUBLIC_URL sem vazar o secret", () => {
      const result = parseEnv({ DISCORD_TOKEN: TOKEN, GUILD_ID: "123456789012345678", DATABASE_URL: DB });
      const message = !result.ok ? result.message : "";
      expect(message).toContain("DISCORD_CLIENT_ID: obrigatória");
      expect(message).toContain("DISCORD_CLIENT_SECRET: obrigatória");
      expect(message).toContain("PUBLIC_URL: obrigatória");
      const bad = parseEnv({ ...valid, DISCORD_CLIENT_ID: "abc", DISCORD_CLIENT_SECRET: "super-secreto" , PUBLIC_URL: "http://localhost:3000/" });
      expect(!bad.ok && bad.message).toContain("DISCORD_CLIENT_ID: formato inválido");
      expect(!bad.ok && bad.message).toContain("PUBLIC_URL: formato inválido");
      expect(!bad.ok && bad.message).not.toContain("super-secreto");
    });

    it("exige PUBLIC_URL https em produção", () => {
      const result = parseEnv({ ...valid, NODE_ENV: "production" });
      expect(!result.ok && result.message).toContain("PUBLIC_URL: deve usar https em produção");
    });

    it("AUTH_DEV_LOGIN só fora de produção", () => {
      expect(parseEnv({ ...valid, AUTH_DEV_LOGIN: "true" })).toMatchObject({ ok: true, env: { AUTH_DEV_LOGIN: true } });
      const prod = parseEnv({ ...valid, AUTH_DEV_LOGIN: "true", NODE_ENV: "production", PUBLIC_URL: "https://painel.exemplo.com" });
      expect(!prod.ok && prod.message).toContain("AUTH_DEV_LOGIN: não pode ser true em produção");
    });

    it("SESSION_TTL_DAYS entre 1 e 90", () => {
      expect(parseEnv({ ...valid, SESSION_TTL_DAYS: "7" })).toMatchObject({ ok: true, env: { SESSION_TTL_DAYS: 7 } });
      const result = parseEnv({ ...valid, SESSION_TTL_DAYS: "0" });
      expect(!result.ok && result.message).toContain("SESSION_TTL_DAYS: deve estar entre 1 e 90");
    });

    it("BOOTSTRAP_ADMIN_DISCORD_IDS vira lista de snowflakes", () => {
      const result = parseEnv({ ...valid, BOOTSTRAP_ADMIN_DISCORD_IDS: " 111111111111111111, 222222222222222222 ," });
      expect(result.ok && result.env.BOOTSTRAP_ADMIN_DISCORD_IDS).toEqual(["111111111111111111", "222222222222222222"]);
      const bad = parseEnv({ ...valid, BOOTSTRAP_ADMIN_DISCORD_IDS: "111111111111111111,fulano" });
      expect(!bad.ok && bad.message).toContain("BOOTSTRAP_ADMIN_DISCORD_IDS.1: formato inválido");
    });
  });

  describe("namespace de manutenção (TASK-048, G5)", () => {
    it("ausente ou vazio deixa o namespace desligado, sem default nem fallback", () => {
      for (const source of [valid, { ...valid, MAINTENANCE_TOKEN: "" }, { ...valid, MAINTENANCE_TOKEN: "   " }]) {
        const result = parseEnv(source);
        expect(result.ok).toBe(true);
        expect(result.ok && result.env.MAINTENANCE_TOKEN).toBeUndefined();
      }
    });

    it("token curto é recusado sem aparecer na mensagem", () => {
      const curto = "curto-demais";
      const result = parseEnv({ ...valid, MAINTENANCE_TOKEN: curto });
      expect(!result.ok && result.message).toContain("MAINTENANCE_TOKEN: deve ter pelo menos 32 caracteres");
      expect(!result.ok && result.message).not.toContain(curto);
    });

    it("token longo passa e chega limpo", () => {
      const token = "segredo-de-manutencao-com-mais-de-32-chars";
      expect(parseEnv({ ...valid, MAINTENANCE_TOKEN: ` ${token} ` })).toMatchObject({ ok: true, env: { MAINTENANCE_TOKEN: token } });
    });
  });

  describe("cargo Membro (TASK-014)", () => {
    it("obrigatório com o bot ligado", () => {
      const rest: Record<string, string | undefined> = { ...valid, DISCORD_MEMBER_ROLE_ID: undefined };
      for (const source of [rest, { ...valid, DISCORD_MEMBER_ROLE_ID: "" }]) {
        const result = parseEnv(source);
        expect(!result.ok && result.message).toContain("DISCORD_MEMBER_ROLE_ID: obrigatória com DISCORD_BOT_ENABLED=true");
      }
    });

    it("opcional com o bot desligado e validado como snowflake", () => {
      const rest: Record<string, string | undefined> = { ...valid, DISCORD_MEMBER_ROLE_ID: undefined };
      const off = parseEnv({ ...rest, DISCORD_BOT_ENABLED: "false" });
      expect(off.ok && off.env.DISCORD_MEMBER_ROLE_ID).toBeUndefined();
      expect(off.ok).toBe(true);
      const bad = parseEnv({ ...valid, DISCORD_MEMBER_ROLE_ID: "membro" });
      expect(!bad.ok && bad.message).toContain("DISCORD_MEMBER_ROLE_ID: formato inválido");
    });
  });

  describe("canal da staff (TASK-015)", () => {
    it("obrigatório com o bot ligado", () => {
      const rest: Record<string, string | undefined> = { ...valid, DISCORD_STAFF_CHANNEL_ID: undefined };
      for (const source of [rest, { ...valid, DISCORD_STAFF_CHANNEL_ID: "" }]) {
        const result = parseEnv(source);
        expect(!result.ok && result.message).toContain("DISCORD_STAFF_CHANNEL_ID: obrigatória com DISCORD_BOT_ENABLED=true");
      }
    });

    it("opcional com o bot desligado e validado como snowflake", () => {
      const off = parseEnv({ ...valid, DISCORD_STAFF_CHANNEL_ID: undefined, DISCORD_BOT_ENABLED: "false" });
      expect(off.ok && off.env.DISCORD_STAFF_CHANNEL_ID).toBeUndefined();
      expect(off.ok).toBe(true);
      const bad = parseEnv({ ...valid, DISCORD_STAFF_CHANNEL_ID: "staff" });
      expect(!bad.ok && bad.message).toContain("DISCORD_STAFF_CHANNEL_ID: formato inválido");
    });
  });

  describe("canal da timeline (TASK-076, T6)", () => {
    it("opcional mesmo com o bot ligado: ausente ou vazio desliga a timeline", () => {
      for (const value of [undefined, "", "  "]) {
        const result = parseEnv({ ...valid, DISCORD_TIMELINE_CHANNEL_ID: value });
        expect(result.ok && result.env.DISCORD_BOT_ENABLED).toBe(true);
        expect(result.ok && result.env.DISCORD_TIMELINE_CHANNEL_ID).toBeUndefined();
      }
    });

    it("com valor, é validado como snowflake e chega limpo", () => {
      const ok = parseEnv({ ...valid, DISCORD_TIMELINE_CHANNEL_ID: " 823456789012345678 " });
      expect(ok.ok && ok.env.DISCORD_TIMELINE_CHANNEL_ID).toBe("823456789012345678");
      const bad = parseEnv({ ...valid, DISCORD_TIMELINE_CHANNEL_ID: "timeline" });
      expect(!bad.ok && bad.message).toContain("DISCORD_TIMELINE_CHANNEL_ID: formato inválido");
    });
  });

  describe("canal de eventos (TASK-022)", () => {
    it("obrigatório com o bot ligado", () => {
      const rest: Record<string, string | undefined> = { ...valid, DISCORD_EVENTS_CHANNEL_ID: undefined };
      for (const source of [rest, { ...valid, DISCORD_EVENTS_CHANNEL_ID: "" }]) {
        const result = parseEnv(source);
        expect(!result.ok && result.message).toContain("DISCORD_EVENTS_CHANNEL_ID: obrigatória com DISCORD_BOT_ENABLED=true");
      }
    });

    it("opcional com o bot desligado e validado como snowflake", () => {
      const off = parseEnv({ ...valid, DISCORD_EVENTS_CHANNEL_ID: undefined, DISCORD_BOT_ENABLED: "false" });
      expect(off.ok && off.env.DISCORD_EVENTS_CHANNEL_ID).toBeUndefined();
      expect(off.ok).toBe(true);
      const bad = parseEnv({ ...valid, DISCORD_EVENTS_CHANNEL_ID: "eventos" });
      expect(!bad.ok && bad.message).toContain("DISCORD_EVENTS_CHANNEL_ID: formato inválido");
    });
  });

  describe("voz do evento (TASK-024)", () => {
    for (const [name, value] of [
      ["DISCORD_WAITING_VOICE_CHANNEL_ID", "aguardando"],
      ["DISCORD_EVENT_CATEGORY_ID", "categoria"],
    ] as const) {
      it(`${name} é obrigatória com o bot ligado, opcional com ele desligado e validada como snowflake`, () => {
        for (const source of [{ ...valid, [name]: undefined }, { ...valid, [name]: "" }]) {
          const result = parseEnv(source);
          expect(!result.ok && result.message).toContain(`${name}: obrigatória com DISCORD_BOT_ENABLED=true`);
        }
        const off = parseEnv({ ...valid, [name]: undefined, DISCORD_BOT_ENABLED: "false" });
        expect(off.ok).toBe(true);
        expect(off.ok && off.env[name]).toBeUndefined();
        const bad = parseEnv({ ...valid, [name]: value });
        expect(!bad.ok && bad.message).toContain(`${name}: formato inválido`);
      });
    }
  });
});
