import { Inject, Injectable } from "@nestjs/common";
import { getNickStatus, grantRole, upsertUserByDiscordId, type DbHandle, type DiscordProfile, type NickRequest, type NickStatus } from "@albion-hub/db";
import { sameNick, validateNick } from "@albion-hub/shared";
import { AUTH_ENV } from "../auth/auth.controller.js";
import type { Env } from "../config/env.js";
import { DB_HANDLE } from "../db/db.module.js";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { rolesForLogin } from "../domain/auth.js";
import type { RegisterNickOutcome } from "../domain/register-nick.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { NickRequestService } from "./nick-request.service.js";

export type NickRegistrationResult =
  | Exclude<RegisterNickOutcome, { kind: "requested" }>
  | { kind: "requested"; created: boolean; request: NickRequest; status: NickStatus };

/** Converte para o resultado plano usado nas respostas do comando. */
export function toRegisterOutcome(result: NickRegistrationResult): RegisterNickOutcome {
  if (result.kind !== "requested") return result;
  return { kind: "requested", created: result.created, nick: result.request.nick, gameNick: result.status.gameNick };
}

/**
 * Registro/troca de nick do membro (TASK-012 + TASK-035). Único caminho para painel (POST /api/me/nick) e slash
 * command `/registrar`: valida (Q14), recusa o nick vigente, cria/corrige a pendência via NickRequestService (hook do
 * embed da staff) e pré-aquece a consulta Albion sem esperar. Nunca mexe no nick vigente nem nos papéis (Q31).
 */
@Injectable()
export class NickRegistrationService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AUTH_ENV) private readonly env: Env,
    @Inject(ALBION_PLAYER_LOOKUP) private readonly albion: AlbionPlayerLookup,
    @Inject(NickRequestService) private readonly requests: NickRequestService,
  ) {}

  async register(userId: string, input: unknown): Promise<NickRegistrationResult> {
    const parsed = validateNick(input);
    if (!parsed.ok) return { kind: "invalid", error: parsed.error };
    return this.registerValid(userId, parsed.nick);
  }

  /**
   * Comando do bot: identidade vem da interação na guild configurada (o chamador confere a guild). Valida antes de
   * criar o usuário e concede os mesmos papéis do login OAuth (`member`, `admin` só para BOOTSTRAP_ADMIN_DISCORD_IDS).
   */
  async registerFromDiscord(profile: DiscordProfile, input: unknown): Promise<NickRegistrationResult> {
    const parsed = validateNick(input);
    if (!parsed.ok) return { kind: "invalid", error: parsed.error };
    const user = await upsertUserByDiscordId(this.handle.db, profile);
    for (const role of rolesForLogin(profile.discordId, this.env.BOOTSTRAP_ADMIN_DISCORD_IDS)) await grantRole(this.handle.db, user.id, role);
    return this.registerValid(user.id, parsed.nick);
  }

  private async registerValid(userId: string, nick: string): Promise<NickRegistrationResult> {
    const status = await getNickStatus(this.handle.db, userId);
    if (status.gameNick && sameNick(status.gameNick, nick)) return { kind: "same_nick", gameNick: status.gameNick };
    const { request, created } = await this.requests.request(userId, nick);
    // Pré-aquece o cache da consulta Albion pra fila/embed da staff (TASK-016). Sem await: nunca atrasa nem derruba o pedido.
    this.albion.lookup(request.nick).catch(() => undefined);
    return { kind: "requested", created, request, status };
  }
}
