export { createDb, ping, type CreateDbOptions, type Database, type DbHandle } from "./client.js";
export { migrationsFolder, runMigrations } from "./migrate.js";
export * as schema from "./schema.js";
export { generateSessionToken, hashSessionToken, isSessionExpired } from "./session-token.js";
export {
  createSession,
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
