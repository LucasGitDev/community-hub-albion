import { ROLES } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Metadados da aplicação (chave/valor). Tabela mínima para provar o pipeline de migrations.
 * Regra: valores monetários usam `bigint("...", { mode: "bigint" })` (Q20), nunca number/float.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Papéis RBAC da v1 (Q13). Fonte única: `ROLES` de @albion-hub/shared. */
export const roleEnum = pgEnum("role", ROLES);

/**
 * Usuário do painel, vinculado a uma conta Discord (Q13).
 * `id` interno é uuid (não enumerável quando exposto na API); `discord_id` é o snowflake, único.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  displayName: text("display_name"),
  avatar: text("avatar"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Papéis atribuídos. PK (user_id, role): vários papéis por usuário, sem duplicata. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/**
 * Sessões do painel. O token do cookie nunca é persistido: só `token_hash` (sha256 hex).
 * Sem IP/user-agent por minimização de dados pessoais.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_at_idx").on(t.expiresAt)],
);

/**
 * Sessões de voz (doc-002): uma linha por entrada/saída de canal. Base de presença (TASK-018/019/027).
 * `discord_user_id` NÃO é FK para `users`: membros acumulam presença antes de logar no painel;
 * junta com `users.discord_id` quando necessário.
 * Sessão aberta = `ended_at is null`; no máximo uma por usuário (índice único parcial).
 */
export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("voice_sessions_one_open_per_user_idx").on(t.discordUserId).where(sql`${t.endedAt} is null`),
    index("voice_sessions_user_started_idx").on(t.discordUserId, t.startedAt),
    index("voice_sessions_channel_window_idx").on(t.channelId, t.startedAt, t.endedAt),
    check("voice_sessions_ended_after_started", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    check("voice_sessions_heartbeat_after_started", sql`${t.lastHeartbeatAt} >= ${t.startedAt}`),
  ],
);
