import { CURRENCIES, EVENT_FEE_TYPES, EVENT_SIGNUP_STATUSES, EVENT_STATUSES, LEDGER_ENTRY_KINDS, LEDGER_REFERENCE_TYPES, LOOT_SPLIT_STATUSES, NICK_REQUEST_STATUSES, ROLES, USER_NOTE_KINDS, WITHDRAWAL_STATUSES } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  /** Tag de guilda do apelido do Discord (`[GENEI] Erijj` → `GENEI`), guardada à parte do nick (TASK-042, AC#6). */
  guildTag: text("guild_tag"),
  /**
   * Última conferência do nick na API do Albion (TASK-016/042, AC#7). `albion_status` guarda found/not_found/unavailable
   * (consulta desligada não grava nada); os demais campos só têm valor quando found. Informativo: nunca bloqueia acesso.
   */
  albionStatus: text("albion_status"),
  albionPlayerId: text("albion_player_id"),
  albionGuildName: text("albion_guild_name"),
  albionCheckedAt: timestamp("albion_checked_at", { withTimezone: true }),
  /**
   * Banimento (TASK-050). Soft delete: a linha continua aqui, o nick continua ocupado e o extrato
   * fica intacto — `banned_at` preenchido é a única coisa que define "banido". Desbanir é voltar
   * os três campos para null, e é o único caminho de volta.
   */
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  bannedBy: uuid("banned_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  banReason: text("ban_reason"),
  /**
   * Saída do servidor do Discord (TASK-049, G6). A limpeza diária preenche isto para quem não está
   * mais na guild e apaga de novo se a pessoa voltar — é a marca de "conta inativa" da lista de membros.
   *
   * Independente do banimento: um banido que também saiu tem as duas datas, e limpar uma nunca limpa a
   * outra. Saldo, lançamentos do ledger e saques **não** são tocados por esta marca: prata é dívida da
   * comunidade com a pessoa, mesmo depois de ela sair.
   */
  leftGuildAt: timestamp("left_guild_at", { withTimezone: true }),
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
 * Taxa do evento (TASK-027, decisão do usuário no doc-005): percentual ou valor fixo, sem teto.
 * O par (`type`, `value`) se repete no template (default), no evento (herdado e editável) e no split
 * (congelado no momento do rascunho) — três lugares, uma regra só.
 */
export const eventFeeTypeEnum = pgEnum("event_fee_type", EVENT_FEE_TYPES);

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
    /**
     * Taxa default herdada pelo evento criado a partir deste template (TASK-027). `percent` guarda
     * basis points (1250 = 12,5%), `fixed` guarda prata inteira (Q20). Zero = sem taxa.
     */
    defaultFeeType: eventFeeTypeEnum("default_fee_type").notNull().default("percent"),
    defaultFeeValue: bigint("default_fee_value", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_templates_name_lower_idx").on(sql`lower(${t.name})`),
    // Sem teto por decisão do usuário; só não pode ser negativa.
    check("event_templates_default_fee_not_negative", sql`${t.defaultFeeValue} >= 0`),
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

export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);

/**
 * Evento (TASK-021, Q26). Estado atual + um timestamp por transição já ocorrida: o histórico do
 * fluxo feliz cabe na própria linha (quem quiser auditar `open→cancelled` olha `cancelled_at`).
 * `template_id` com `on delete restrict`: apagar template que já virou evento apagaria a origem do evento.
 * `voice_channel_id` fica null até o start criar o canal (TASK-024, Q28).
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => eventTemplates.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: eventStatusEnum("status").notNull().default("draft"),
    /** Owner único, transferível pela staff (Q21). Recebe as sobras da distribuição. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    /** Fechamento automático da inscrição (AC#5); null = só fecha na mão ou no start. */
    signupsCloseAt: timestamp("signups_close_at", { withTimezone: true }),
    voiceChannelId: text("voice_channel_id"),
    /**
     * Canal onde a presença do evento foi medida (TASK-027, Q6). Existe separado de `voice_channel_id`
     * porque este último volta a ser null quando o bot apaga o canal no finish (TASK-024, Q28) — e o
     * split nasce **depois** do finish. Sem este carimbo, a janela de presença do evento sumiria junto
     * com o canal. Gravado uma vez, no start, e nunca mais limpo.
     */
    presenceChannelId: text("presence_channel_id"),
    /**
     * Taxa deste evento (TASK-027): copiada do template na criação e editável até o arquivamento
     * (Q26). O split congela a taxa vigente no momento em que o rascunho é criado; aplicar a taxa e
     * creditar o dono é da TASK-028.
     */
    feeType: eventFeeTypeEnum("fee_type").notNull().default("percent"),
    feeValue: bigint("fee_value", { mode: "bigint" }).notNull().default(sql`0`),
    /** Mensagem do embed de inscrição no canal de eventos (TASK-022); null até o evento abrir. */
    discordMessageId: text("discord_message_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Arquivamento (TASK-044, Q26): o evento virou histórico e não aceita mais nenhuma edição. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Motivo que o caller/staff escreveu ao cancelar (TASK-025); o inscrito lê no embed e no painel. */
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_status_starts_idx").on(t.status, t.startsAt),
    index("events_owner_idx").on(t.ownerUserId),
    index("events_template_idx").on(t.templateId),
    // Fechamento automático varre só os abertos com prazo (AC#5).
    index("events_signups_close_idx").on(t.signupsCloseAt).where(sql`${t.status} = 'open'`),
    check("events_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("events_fee_not_negative", sql`${t.feeValue} >= 0`),
    // Estado e carimbo andam juntos: running só existe com started_at, finished/archived com finished_at,
    // cancelled com cancelled_at e archived com archived_at.
    // `archived` vem por `::text` de propósito: comparar com o literal do enum recém-criado quebraria a
    // migração ("unsafe use of new value"), já que `alter type ... add value` roda na mesma transação.
    check("events_started_consistent", sql`((${t.status})::text in ('running', 'finished', 'archived')) <= (${t.startedAt} is not null)`),
    // `archived` guarda o finished_at de quando o jogo acabou: o carimbo do fim de jogo não se perde ao arquivar.
    check("events_finished_consistent", sql`(${t.finishedAt} is not null) = ((${t.status})::text in ('finished', 'archived'))`),
    check("events_cancelled_consistent", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    check("events_archived_consistent", sql`((${t.status})::text = 'archived') = (${t.archivedAt} is not null)`),
    // Motivo só existe em evento cancelado, e com tamanho: o texto vai parar no embed do Discord.
    check(
      "events_cancel_reason_consistent",
      sql`${t.cancelReason} is null or (${t.status} = 'cancelled' and length(trim(${t.cancelReason})) between 1 and 300)`,
    ),
    check("events_signups_close_before_start", sql`${t.signupsCloseAt} is null or ${t.startsAt} is null or ${t.signupsCloseAt} <= ${t.startsAt}`),
  ],
);

/**
 * Cópia das roles e vagas do template no instante da criação (TASK-021 AC#1). É snapshot de propósito:
 * editar o template depois (staff mexe no catálogo a qualquer hora, TASK-020) não pode mudar as vagas de
 * um evento já publicado, senão inscrito perderia lugar sem ninguém tocar no evento. `name` é copiado pelo
 * mesmo motivo; `role_id` é `set null` para não travar a limpeza do catálogo — o nome já está guardado.
 */
export const eventRoleSlots = pgTable(
  "event_role_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => eventRoles.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slots: integer("slots").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("event_role_slots_event_idx").on(t.eventId, t.sortOrder),
    uniqueIndex("event_role_slots_event_name_idx").on(t.eventId, t.name),
    check("event_role_slots_slots_positive", sql`${t.slots} > 0`),
  ],
);

/** Trocas de owner (Q21, AC#4): append-only, uma linha por transferência. A criação grava a primeira (from null). */
export const eventOwnerHistory = pgTable(
  "event_owner_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_owner_history_event_idx").on(t.eventId, t.changedAt)],
);

export const eventSignupStatusEnum = pgEnum("event_signup_status", EVENT_SIGNUP_STATUSES);

/**
 * Inscrição de um membro numa role do evento (TASK-022, Q27). `slot_id` aponta para a vaga já copiada
 * do template (`event_role_slots`), então editar o template depois não move ninguém de lugar; `role_name`
 * repete o nome porque a role pode ser apagada do catálogo e a lista precisa continuar legível.
 *
 * `position` é a ordem na espera **daquela role** (1, 2, 3...) e vale 0 para confirmado. Trocar de role ou
 * sair não apaga linha: a inscrição antiga vira `cancelled` e uma nova é criada, então o histórico do
 * evento fica inteiro (mesma ideia do ledger imutável).
 */
export const eventSignups = pgTable(
  "event_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => eventRoleSlots.id, { onDelete: "cascade" }),
    roleName: text("role_name").notNull(),
    status: eventSignupStatusEnum("status").notNull(),
    position: integer("position").notNull().default(0),
    /** Caller/owner ou staff que moveu a pessoa (AC#4); null quando ela mesma se inscreveu. */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Uma inscrição ativa por pessoa por evento: o banco impede estar confirmado e na espera ao mesmo tempo.
    uniqueIndex("event_signups_active_idx")
      .on(t.eventId, t.userId)
      .where(sql`${t.status} in ('confirmed', 'waitlist')`),
    index("event_signups_event_idx").on(t.eventId, t.status),
    index("event_signups_slot_idx").on(t.slotId, t.status, t.position),
    index("event_signups_user_idx").on(t.userId),
    check("event_signups_position_positive", sql`${t.position} >= 0`),
    // Confirmado não tem posição de espera; quem espera tem sempre uma.
    check("event_signups_waitlist_position", sql`(${t.status} = 'waitlist') = (${t.position} > 0)`),
  ],
);

export const ledgerEntryKindEnum = pgEnum("ledger_entry_kind", LEDGER_ENTRY_KINDS);
export const ledgerReferenceTypeEnum = pgEnum("ledger_reference_type", LEDGER_REFERENCE_TYPES);

/** Moeda do lançamento (F6-1). Fonte única: `CURRENCIES` de @albion-hub/shared. */
export const ledgerCurrencyEnum = pgEnum("ledger_currency", CURRENCIES);

/**
 * Ledger único de prata (doc-002, TASK-026): **append-only**. `amount` é prata inteira em bigint (Q20),
 * positivo credita e negativo debita; saldo é `sum(amount)` no banco e pode ficar negativo (Q24).
 *
 * Imutabilidade não depende do código da aplicação: a migration cria triggers que rejeitam UPDATE,
 * DELETE e TRUNCATE nesta tabela (AC#1). Correção só existe como estorno — um lançamento `reversal`
 * com `reversal_of` apontando para o original, e o índice único parcial garante **um estorno por
 * lançamento** mesmo com duas requisições concorrentes (AC#2).
 *
 * `reference_type`/`reference_id` guardam a origem (evento, loot split, saque) sem FK: o lançamento
 * precisa sobreviver ao sumiço da origem, senão o histórico financeiro deixaria de bater.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Dono do saldo. `restrict`: conta com lançamento não é apagada, o histórico é a dívida com o membro (Q10). */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    /**
     * Moeda do lançamento (F6-1). Nasceu `default 'silver'` para o Postgres preencher as linhas antigas
     * sem UPDATE — as triggers append-only abaixo recusam UPDATE, então backfill era impossível — e o
     * default caiu na **mesma** migration (F6-2): insert sem moeda volta a ser erro.
     */
    currency: ledgerCurrencyEnum("currency").notNull(),
    kind: ledgerEntryKindEnum("kind").notNull(),
    referenceType: ledgerReferenceTypeEnum("reference_type"),
    /** Id da origem (uuid do evento/split/saque) como texto: nem toda origem é uuid no futuro. */
    referenceId: text("reference_id"),
    reversalOf: uuid("reversal_of").references((): AnyPgColumn => ledgerEntries.id, { onDelete: "restrict" }),
    /**
     * Quem lançou; null quando foi um job automático. `restrict` como em `user_id`: apagar a conta
     * exigiria **alterar** o lançamento (`set null`), e o trigger de imutabilidade recusa — no ledger
     * a autoria também é histórico.
     */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [
    // Um lançamento só pode ser estornado uma vez (AC#2): a corrida é resolvida pelo banco.
    uniqueIndex("ledger_entries_reversal_of_unique").on(t.reversalOf).where(sql`${t.reversalOf} is not null`),
    // Extrato e saldo por usuário **e moeda**: `currency` antes de `created_at` (F6-3), senão ler
    // uma moeda varreria os lançamentos da outra. Ordem estável por (created_at, id).
    index("ledger_entries_user_currency_idx").on(t.userId, t.currency, t.createdAt, t.id),
    index("ledger_entries_reference_idx").on(t.referenceType, t.referenceId),
    check("ledger_entries_amount_not_zero", sql`${t.amount} <> 0`),
    // Estorno e `reversal_of` andam juntos: nenhum dos dois existe sozinho.
    check("ledger_entries_reversal_consistent", sql`(${t.reversalOf} is not null) = (${t.kind} = 'reversal')`),
    // Origem é par completo ou ausente.
    check("ledger_entries_reference_consistent", sql`(${t.referenceType} is null) = (${t.referenceId} is null)`),
  ],
);

/** Origem da nota interna (TASK-045). Fonte única: `USER_NOTE_KINDS` de @albion-hub/shared. */
export const userNoteKindEnum = pgEnum("user_note_kind", USER_NOTE_KINDS);

/**
 * Notas internas por membro (TASK-045, AC#3). **Append-only**: o repositório só faz insert e select, e
 * não existe coluna de edição nem de remoção — uma nota errada é corrigida escrevendo outra nota, do mesmo
 * jeito que o ledger se corrige por estorno. `kind = 'system'` é o registro automático de uma edição (AC#2).
 *
 * `author_id` é `set null` (não `cascade`): apagar a conta de quem escreveu não pode apagar o histórico
 * do membro sobre quem se escreveu. Quem some vira "autor removido" na tela, e a nota continua lá.
 */
export const userNotes = pgTable(
  "user_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: userNoteKindEnum("kind").notNull().default("staff"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // A tela lê sempre "as notas deste membro em ordem"; o índice cobre exatamente essa consulta.
    index("user_notes_user_idx").on(t.userId, t.createdAt),
    check("user_notes_body_not_blank", sql`length(btrim(${t.body})) > 0`),
  ],
);

export const withdrawalStatusEnum = pgEnum("withdrawal_status", WITHDRAWAL_STATUSES);

/**
 * Pedido de saque de prata (TASK-030, doc-002). Tabela própria, **fora** do ledger: enquanto o saque está
 * `pending` ele só reserva saldo (AC#2, Q25) e nada aparece no extrato do membro. A aprovação é que cria o
 * lançamento de débito, e `ledger_entry_id` guarda qual foi — é o vínculo que prova que não houve débito
 * duplicado nem aprovação sem lançamento.
 *
 * Diferente do ledger, esta linha **muda de estado** (é um pedido, não um fato contábil), mas cada passo
 * é carimbado e só anda para frente: `pending → approved → settled`, ou `pending → rejected`.
 */
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Dono do saque. `restrict` como no ledger: a dívida com o membro (Q10) não some junto com a conta. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Prata inteira (Q20), sempre positiva: o sinal de débito é do lançamento, não do pedido. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    /** Débito lançado na aprovação. `restrict`: o lançamento é append-only e não pode ser apagado. */
    ledgerEntryId: uuid("ledger_entry_id").references(() => ledgerEntries.id, { onDelete: "restrict" }),
    /** Staff que aprovou ou recusou (AC#3). */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Motivo da recusa (obrigatório) ou observação da aprovação (opcional). */
    decisionNote: text("decision_note"),
    /** Quem pagou in-game e quando (Q11, AC#4). */
    settledBy: uuid("settled_by").references(() => users.id, { onDelete: "restrict" }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settlementNote: text("settlement_note"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fila da staff e reserva por membro: as duas consultas quentes.
    index("withdrawals_status_idx").on(t.status, t.createdAt),
    index("withdrawals_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("withdrawals_ledger_entry_unique").on(t.ledgerEntryId).where(sql`${t.ledgerEntryId} is not null`),
    check("withdrawals_amount_positive", sql`${t.amount} > 0`),
    // Débito no ledger existe exatamente nos estados em que a prata já saiu (Q25).
    check("withdrawals_ledger_entry_consistent", sql`(${t.ledgerEntryId} is not null) = (${t.status} in ('approved', 'settled'))`),
    // Decisão completa: quem, quando e (na recusa) por quê.
    check("withdrawals_decision_consistent", sql`(${t.decidedBy} is null) = (${t.decidedAt} is null)`),
    check("withdrawals_decided_when_not_pending", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
    check("withdrawals_rejection_note_required", sql`${t.status} <> 'rejected' or (${t.decisionNote} is not null and length(btrim(${t.decisionNote})) > 0)`),
    // Liquidação exige quem + quando + nota, e só existe em `settled` (AC#4, Q11).
    check(
      "withdrawals_settlement_consistent",
      sql`(${t.status} = 'settled') = (${t.settledBy} is not null and ${t.settledAt} is not null and ${t.settlementNote} is not null and length(btrim(${t.settlementNote})) > 0)`,
    ),
  ],
);

export const lootSplitStatusEnum = pgEnum("loot_split_status", LOOT_SPLIT_STATUSES);

/**
 * Loot split de um evento (TASK-027, Q5/Q6/Q7/Q23). Um evento aceita **N** splits (AC#3) — o loot de
 * uma noite chega em levas —, e cada um fecha 100% por conta própria, com o seu próprio total.
 *
 * Enquanto é `draft` o split é editável (total e percentuais). `confirmed` é o fim: a TASK-028 lança
 * um `split_payout` por participante e um `split_fee` com taxa + resíduo para o dono, tudo numa
 * transação, e daí em diante **triggers recusam UPDATE/DELETE** neste split e nas linhas dele — a
 * correção de um split confirmado é estornar os lançamentos, nunca reescrever a história (Q24).
 *
 * `fee_type`/`fee_value` são a taxa **congelada** no instante do rascunho, copiada do evento. Mexer na
 * taxa do evento depois não muda um split já rascunhado — senão a conta que o caller conferiu mudaria
 * sozinha debaixo dele.
 */
export const lootSplits = pgTable(
  "loot_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    status: lootSplitStatusEnum("status").notNull().default("draft"),
    /** Prata bruta arrecadada nesta leva (Q20). Zero é permitido: split de evento que não deu loot. */
    totalSilver: bigint("total_silver", { mode: "bigint" }).notNull(),
    feeType: eventFeeTypeEnum("fee_type").notNull(),
    feeValue: bigint("fee_value", { mode: "bigint" }).notNull(),
    /**
     * Prata de fato retida pela taxa (TASK-028): `percent` já resolvido em prata, ou o valor fixo.
     * Guardada separada de `fee_value` porque é ela que foi creditada ao dono — reconstruir a conta a
     * partir do percentual depois de um estorno dependeria de refazer a divisão inteira.
     */
    feeSilver: bigint("fee_silver", { mode: "bigint" }).notNull().default(sql`0`),
    /**
     * Sobra do arredondamento do rateio (Q23): `distribuível - soma(linhas)`, sempre menor que o
     * número de linhas. Vai para o caller/dono do evento junto com a taxa, num lançamento só
     * (`split_fee`). Explícito aqui para a conferência ser possível sem refazer a divisão.
     */
    residualSilver: bigint("residual_silver", { mode: "bigint" }).notNull().default(sql`0`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Quem confirmou e quando (TASK-028). Null enquanto o split é rascunho. */
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loot_splits_event_idx").on(t.eventId, t.createdAt),
    check("loot_splits_total_not_negative", sql`${t.totalSilver} >= 0`),
    check("loot_splits_fee_not_negative", sql`${t.feeValue} >= 0`),
    check("loot_splits_fee_silver_not_negative", sql`${t.feeSilver} >= 0`),
    check("loot_splits_residual_not_negative", sql`${t.residualSilver} >= 0`),
    // Confirmado tem carimbo, rascunho não tem: não existe split "confirmado por ninguém".
    check("loot_splits_confirmed_consistent", sql`(${t.status} = 'confirmed') = (${t.confirmedAt} is not null)`),
  ],
);

/**
 * Uma linha por pessoa que esteve no canal do evento na janela start→finish (Q6).
 *
 * A chave é `discord_user_id`, não `user_id`: `voice_sessions` mede presença por snowflake e quem
 * nunca entrou no painel não tem conta (doc-002). `user_id` é resolvido quando existe e é o que a
 * TASK-028 vai exigir para creditar — linha sem conta não recebe prata, aparece para a staff resolver.
 *
 * `presence_ms` é guardado junto com o percentual de propósito: é o número que originou a
 * participação, e a tela da TASK-029 precisa dele para explicar "por que eu fiquei com 8%".
 * Presente não inscrito fica com `signed_up = false` e `share_bp = 0` (Q7).
 */
export const lootSplitLines = pgTable(
  "loot_split_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    splitId: uuid("split_id")
      .notNull()
      .references(() => lootSplits.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    /** `restrict` como no ledger: conta que já entrou num split é histórico do evento (Q10). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    /** Tinha inscrição ativa (confirmada ou em espera) no evento. */
    signedUp: boolean("signed_up").notNull(),
    /** Role da inscrição, copiada como em `event_signups`: a role pode sumir do catálogo depois. */
    roleName: text("role_name"),
    presenceMs: bigint("presence_ms", { mode: "number" }).notNull(),
    /** Participação em basis points: 10000 = 100%. A soma das linhas fecha 10000 exato. */
    shareBp: integer("share_bp").notNull(),
    /** Prata desta linha sobre o **distribuível** (total menos a taxa). É o valor creditado no ledger. */
    amountSilver: bigint("amount_silver", { mode: "bigint" }).notNull(),
  },
  (t) => [
    // Uma linha por pessoa por split: a mesma presença nunca é contada duas vezes.
    uniqueIndex("loot_split_lines_split_user_idx").on(t.splitId, t.discordUserId),
    index("loot_split_lines_user_idx").on(t.userId),
    check("loot_split_lines_presence_not_negative", sql`${t.presenceMs} >= 0`),
    check("loot_split_lines_share_range", sql`${t.shareBp} between 0 and 10000`),
    check("loot_split_lines_amount_not_negative", sql`${t.amountSilver} >= 0`),
    // Q7: não inscrito entra na lista para ser visto, mas sem participação.
    check("loot_split_lines_not_signed_up_has_no_share", sql`${t.signedUp} or (${t.shareBp} = 0 and ${t.amountSilver} = 0)`),
  ],
);
