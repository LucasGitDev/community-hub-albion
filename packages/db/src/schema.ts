import { NICK_REQUEST_STATUSES, ROLES } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  /** Nick vigente do Albion (último aprovado pela staff, Q14/Q31). Troca pendente não altera. */
  gameNick: text("game_nick"),
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

export const nickRequestStatusEnum = pgEnum("nick_request_status", NICK_REQUEST_STATUSES);

/**
 * Solicitações de nick (TASK-012): entrada de membro e troca de nick (Q14, Q31).
 * No máximo uma `pending` por usuário (índice único parcial). Decisão da staff é TASK-013.
 */
export const nickRequests = pgTable(
  "nick_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nick: text("nick").notNull(),
    status: nickRequestStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    // Mensagem do embed no canal da staff (TASK-015): editada na decisão ou na correção do nick pendente.
    discordMessageId: text("discord_message_id"),
  },
  (t) => [
    uniqueIndex("nick_requests_one_pending_per_user_idx").on(t.userId).where(sql`${t.status} = 'pending'`),
    index("nick_requests_status_created_idx").on(t.status, t.createdAt),
    check("nick_requests_decided_consistent", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
  ],
);

/**
 * Catálogo global de roles de evento (TASK-020, Q8). Nome único sem diferenciar maiúsculas.
 * Seed inicial (Tank, Healer, DPS Melee, DPS Range, Support, Scout) vive na migration: roda uma vez por banco,
 * então restart não duplica e edição/remoção da staff nunca é sobrescrita.
 */
export const eventRoles = pgTable(
  "event_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_roles_name_lower_idx").on(sql`lower(${t.name})`), check("event_roles_name_not_blank", sql`length(trim(${t.name})) > 0`)],
);

/**
 * Template de evento (TASK-020, Q8): DB é fonte de verdade (doc-002). `max_party_size` null = sem teto (PvP Roaming 2-∞).
 * Sem faixa de moeda por role nem taxa de entrada: economia temática fica para quando o ledger existir (migration aditiva).
 */
export const eventTemplates = pgTable(
  "event_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    minPartySize: integer("min_party_size").notNull(),
    maxPartySize: integer("max_party_size"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_templates_name_lower_idx").on(sql`lower(${t.name})`),
    check("event_templates_party_size", sql`${t.minPartySize} >= 1 and (${t.maxPartySize} is null or ${t.maxPartySize} >= ${t.minPartySize})`),
  ],
);

/** Roles do template com vagas. Role em uso não pode ser apagada (AC#3): FK `on delete restrict` é a última barreira. */
export const eventTemplateRoles = pgTable(
  "event_template_roles",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => eventTemplates.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => eventRoles.id, { onDelete: "restrict" }),
    slots: integer("slots").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.roleId] }), index("event_template_roles_role_idx").on(t.roleId), check("event_template_roles_slots_positive", sql`${t.slots} > 0`)],
);
