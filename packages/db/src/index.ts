export { createDb, ping, type CreateDbOptions, type Database, type DbHandle } from "./client.js";
export { migrationsFolder, runMigrations } from "./migrate.js";
export * as schema from "./schema.js";
export { generateSessionToken, hashSessionToken, isSessionExpired } from "./session-token.js";
export {
  createSession,
  findDiscordIdByUserId,
  findUserIdByDiscordId,
  findValidSession,
  grantRole,
  listRoles,
  revokeRole,
  revokeSession,
  upsertUserByDiscordId,
  type DiscordProfile,
  type Session,
  type User,
} from "./auth-repo.js";
export {
  closeStaleSessionsAtHeartbeat,
  closeVoiceSession,
  listOpenVoiceSessions,
  openVoiceSession,
  overlapMs,
  touchHeartbeat,
  type OpenVoiceSessionInput,
  type VoiceSession,
} from "./voice-repo.js";
export { listUsersWithRoles, revokeRoleGuarded, userExists, type RevokeRoleResult, type UserWithRoles } from "./admin-roles-repo.js";
export {
  decideNickRequest,
  getNickRequestEmbedData,
  getNickStatus,
  listPendingNickRequests,
  requestNick,
  setGameNick,
  setNickRequestDiscordMessageId,
  type DecideNickRequestInput,
  type NickRequestEmbedData,
  type DecideNickRequestResult,
  type NickDecision,
  type NickRequest,
  type NickStatus,
} from "./nick-repo.js";
export {
  createEventRole,
  deleteEventRole,
  deleteEventTemplate,
  getEventTemplate,
  listEventRoles,
  listEventTemplates,
  saveEventTemplate,
  updateEventRole,
  type EventRoleDeleteResult,
  type EventRoleWriteResult,
  type EventTemplateWriteResult,
} from "./event-templates-repo.js";
