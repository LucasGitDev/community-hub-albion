import { z } from "zod";

const SNOWFLAKE = /^\d{17,20}$/;
// Token de bot Discord: três segmentos base64url separados por ponto.
const BOT_TOKEN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

const envSchema = z.object({
  DISCORD_TOKEN: z
    .string({ error: "obrigatória" })
    .trim()
    .min(1, { error: "obrigatória" })
    .regex(BOT_TOKEN, { error: "formato inválido (esperado token de bot do Discord)" }),
  GUILD_ID: z
    .string({ error: "obrigatória" })
    .trim()
    .min(1, { error: "obrigatória" })
    .regex(SNOWFLAKE, { error: "formato inválido (esperado snowflake numérico de 17 a 20 dígitos)" }),
  PORT: z.coerce
    .number({ error: "deve ser um número" })
    .int({ error: "deve ser inteiro" })
    .min(1, { error: "deve estar entre 1 e 65535" })
    .max(65535, { error: "deve estar entre 1 e 65535" })
    .default(3000),
  // "false" sobe só a API, sem login no Discord (dev de API/SPA, e2e). Token e GUILD_ID seguem obrigatórios.
  DISCORD_BOT_ENABLED: z
    .enum(["true", "false"], { error: "deve ser true ou false" })
    .default("true")
    .transform((value) => value === "true"),
  NODE_ENV: z.enum(["development", "test", "production"], { error: "deve ser development, test ou production" }).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export type EnvResult = { ok: true; env: Env } | { ok: false; message: string };

/**
 * Valida variáveis de ambiente. A mensagem de erro lista só nomes e regras,
 * nunca os valores recebidos (evita vazar token em log).
 */
export function parseEnv(source: Record<string, string | undefined>): EnvResult {
  const result = envSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  return {
    ok: false,
    message: ["Configuração inválida. Corrija as variáveis de ambiente (veja apps/server/.env.example):", ...lines].join("\n"),
  };
}
