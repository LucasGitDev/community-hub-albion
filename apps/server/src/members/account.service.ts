import { Inject, Injectable } from "@nestjs/common";
import { grantRole, upsertUserByDiscordId, type DbHandle, type DiscordProfile, type User } from "@albion-hub/db";
import { AUTH_ENV } from "../auth/auth.controller.js";
import type { Env } from "../config/env.js";
import { DB_HANDLE } from "../db/db.module.js";
import { rolesForLogin } from "../domain/auth.js";

export interface EnsuredAccount {
  user: User;
  /** true quando a conta nasceu nesta interação (TASK-037: aviso na resposta efêmera). */
  created: boolean;
}

/**
 * Conta do painel a partir da identidade do Discord (TASK-035, TASK-037).
 * Caminho único de `/registrar`, do botão de inscrição e de qualquer fluxo do bot:
 * os papéis saem sempre de `rolesForLogin` (member + admin só para BOOTSTRAP_ADMIN_DISCORD_IDS),
 * iguais aos do login OAuth. Nunca mexe em nick.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AUTH_ENV) private readonly env: Env,
  ) {}

  async ensureFromDiscord(profile: DiscordProfile): Promise<EnsuredAccount> {
    const db = this.handle.db;
    const before = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.discordId, profile.discordId), columns: { id: true } });
    const user = await upsertUserByDiscordId(db, profile);
    for (const role of rolesForLogin(profile.discordId, this.env.BOOTSTRAP_ADMIN_DISCORD_IDS)) await grantRole(db, user.id, role);
    return { user, created: !before };
  }
}
