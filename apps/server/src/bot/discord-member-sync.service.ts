import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { findDiscordIdByUserId, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { planMemberSync } from "../domain/member-sync.js";
import { NickDecisionService, type NickDecidedEvent } from "../members/nick-decision.service.js";
import { DISCORD_GUILD_GATEWAY, type DiscordGuildGateway } from "./discord-guild.gateway.js";

export const DISCORD_MEMBER_ROLE_ID = Symbol("DISCORD_MEMBER_ROLE_ID");

/**
 * Aplica no Discord o resultado da decisão de nick (TASK-014): apelido na aprovação e cargo Membro na primeira.
 * Roda depois do commit (hook do NickDecisionService). Falha do Discord é logada e nunca lança: a aprovação fica (AC#3).
 */
@Injectable()
export class DiscordMemberSync implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("DiscordMemberSync");
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly decisions: NickDecisionService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_GUILD_GATEWAY) private readonly gateway: DiscordGuildGateway,
    @Inject(DISCORD_MEMBER_ROLE_ID) private readonly memberRoleId: string,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.decisions.onDecided((event) => this.sync(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async sync(event: NickDecidedEvent): Promise<void> {
    const actions = planMemberSync({ decision: event.decision, nick: event.request.nick, previousGameNick: event.previousGameNick }, this.memberRoleId);
    if (actions.length === 0) return;
    const requestId = event.request.id;
    let discordId: string | null;
    try {
      discordId = await findDiscordIdByUserId(this.handle.db, event.request.userId);
    } catch (error) {
      this.logger.error(`Sync Discord do pedido ${requestId}: falha ao buscar usuário: ${String(error)}`);
      return;
    }
    if (!discordId) {
      this.logger.error(`Sync Discord do pedido ${requestId}: usuário ${event.request.userId} não encontrado`);
      return;
    }
    const reason = `Nick aprovado pela staff (pedido ${requestId})`;
    // Cada ação é independente: apelido falhar (ex.: dono da guild) não impede o cargo.
    for (const action of actions) {
      try {
        if (action.kind === "setNickname") await this.gateway.setNickname(discordId, action.nick, reason);
        else await this.gateway.addRole(discordId, action.roleId, reason);
        this.logger.log(`Sync Discord ok: ${action.kind} para ${discordId} (pedido ${requestId})`);
      } catch (error) {
        this.logger.error(`Sync Discord falhou: ${action.kind} para ${discordId} (pedido ${requestId}). ${describeDiscordError(error)}`);
      }
    }
  }
}
