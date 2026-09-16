import { fileURLToPath } from "node:url";
import { ALBION_REGIONS } from "@albion-hub/shared";
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
  DATABASE_URL: z
    .string({ error: "obrigatória" })
    .trim()
    .min(1, { error: "obrigatória" })
    .regex(/^postgres(ql)?:\/\//, { error: "formato inválido (esperado postgres://usuario:senha@host:porta/banco)" }),
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
  // Cargo "Membro" concedido na primeira aprovação de nick (TASK-014, Q31). Obrigatório com o bot ligado.
  DISCORD_MEMBER_ROLE_ID: z
    .string()
    .trim()
    .regex(SNOWFLAKE, { error: "formato inválido (esperado snowflake numérico de 17 a 20 dígitos)" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Canal da staff onde o bot publica pedidos de nick com botões (TASK-015). Obrigatório com o bot ligado.
  DISCORD_STAFF_CHANNEL_ID: z
    .string()
    .trim()
    .regex(SNOWFLAKE, { error: "formato inválido (esperado snowflake numérico de 17 a 20 dígitos)" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Canal onde o bot publica o embed de inscrição dos eventos (TASK-022). Obrigatório com o bot ligado.
  DISCORD_EVENTS_CHANNEL_ID: z
    .string()
    .trim()
    .regex(SNOWFLAKE, { error: "formato inválido (esperado snowflake numérico de 17 a 20 dígitos)" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Build da SPA servida na raiz. Default: apps/web/dist relativo ao dist do server (monorepo). Docker define explícito.
  WEB_DIST_DIR: z
    .string()
    .trim()
    .min(1)
    .default(fileURLToPath(new URL("../../../web/dist", import.meta.url))),
  // Aplica migrations do @albion-hub/db antes de subir (padrão no container). "false" pula (dev/e2e sem banco).
  RUN_MIGRATIONS: z
    .enum(["true", "false"], { error: "deve ser true ou false" })
    .default("true")
    .transform((value) => value === "true"),
  // OAuth2 do painel (TASK-008): Discord Developer Portal > OAuth2.
  DISCORD_CLIENT_ID: z
    .string({ error: "obrigatória" })
    .trim()
    .min(1, { error: "obrigatória" })
    .regex(SNOWFLAKE, { error: "formato inválido (esperado snowflake numérico de 17 a 20 dígitos)" }),
  DISCORD_CLIENT_SECRET: z.string({ error: "obrigatória" }).trim().min(1, { error: "obrigatória" }),
  // Origem pública do painel; redirect OAuth = PUBLIC_URL/api/auth/discord/callback.
  PUBLIC_URL: z
    .string({ error: "obrigatória" })
    .trim()
    .min(1, { error: "obrigatória" })
    .regex(/^https?:\/\/[^/?#\s]+$/, { error: "formato inválido (esperado origem http(s)://host[:porta], sem caminho nem barra final)" }),
  SESSION_TTL_DAYS: z.coerce
    .number({ error: "deve ser um número" })
    .int({ error: "deve ser inteiro" })
    .min(1, { error: "deve estar entre 1 e 90" })
    .max(90, { error: "deve estar entre 1 e 90" })
    .default(30),
  // Snowflakes separados por vírgula que recebem `admin` ao logar (bootstrap do primeiro admin, TASK-011).
  BOOTSTRAP_ADMIN_DISCORD_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(SNOWFLAKE, { error: "formato inválido (esperado snowflakes separados por vírgula)" }))),
  // Login sem Discord (POST /api/auth/dev-login) só pra dev/e2e. Proibido em produção.
  AUTH_DEV_LOGIN: z
    .enum(["true", "false"], { error: "deve ser true ou false" })
    .default("false")
    .transform((value) => value === "true"),
  // Região do Albion pra conferir nick na API pública (TASK-016, Q15). Vazio/ausente = consulta desligada; nunca bloqueia.
  ALBION_REGION: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value),
    z.enum(ALBION_REGIONS, { error: "deve ser americas, europe ou asia (ou vazio para desligar)" }).optional(),
  ),
  NODE_ENV: z.enum(["development", "test", "production"], { error: "deve ser development, test ou production" }).default("development"),
}).refine((env) => !env.DISCORD_BOT_ENABLED || env.DISCORD_MEMBER_ROLE_ID !== undefined, {
  error: "obrigatória com DISCORD_BOT_ENABLED=true",
  path: ["DISCORD_MEMBER_ROLE_ID"],
}).refine((env) => !env.DISCORD_BOT_ENABLED || env.DISCORD_STAFF_CHANNEL_ID !== undefined, {
  error: "obrigatória com DISCORD_BOT_ENABLED=true",
  path: ["DISCORD_STAFF_CHANNEL_ID"],
}).refine((env) => !env.DISCORD_BOT_ENABLED || env.DISCORD_EVENTS_CHANNEL_ID !== undefined, {
  error: "obrigatória com DISCORD_BOT_ENABLED=true",
  path: ["DISCORD_EVENTS_CHANNEL_ID"],
}).refine((env) => env.NODE_ENV !== "production" || !env.AUTH_DEV_LOGIN, {
  error: "não pode ser true em produção",
  path: ["AUTH_DEV_LOGIN"],
}).refine((env) => env.NODE_ENV !== "production" || env.PUBLIC_URL.startsWith("https://"), {
  error: "deve usar https em produção (cookie secure)",
  path: ["PUBLIC_URL"],
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
