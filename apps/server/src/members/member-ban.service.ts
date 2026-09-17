import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { addUserNote, banUser, getBanStatus, unbanUser, type BanUserResult, type DbHandle, type UnbanUserResult } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { DISCORD_GUILD_GATEWAY, type DiscordGuildGateway } from "../bot/discord-guild.gateway.js";
import { DISCORD_MEMBER_ROLE_ID } from "../bot/discord-member-sync.service.js";

/**
 * Banimento de jogador (TASK-050). Um serviço só, como manda o CLAUDE.md: painel, e no futuro qualquer
 * comando do bot, chamam daqui — as recusas não podem viver em um controller.
 *
 * Ordem de propósito: o banco primeiro (marca a conta e apaga as sessões na mesma transação), o Discord
 * depois. O Discord é melhor-esforço e nunca derruba o banimento: se a remoção do cargo falhar, o acesso
 * já está cortado e a falha vira log + nota. O contrário (Discord primeiro) deixaria o cargo removido
 * de alguém que continuou entrando no painel.
 *
 * O que este serviço **não** faz, por decisão: expulsar ou banir do servidor do Discord (isso continua
 * sendo feito no Discord, à mão) e mexer no ledger — nenhum estorno, nenhum lançamento (Q24/Q25).
 */
@Injectable()
export class MemberBanService {
  private readonly logger = new Logger("MemberBan");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(DISCORD_GUILD_GATEWAY) private readonly gateway: DiscordGuildGateway | null = null,
    @Optional() @Inject(DISCORD_MEMBER_ROLE_ID) private readonly memberRoleId: string | null = null,
  ) {}

  async ban(userId: string, actorId: string, reason: string): Promise<BanUserResult> {
    const result = await banUser(this.handle.db, { userId, actorId, reason });
    if (!result.ok) return result;

    await addUserNote(this.handle.db, { userId, authorId: actorId, kind: "system", body: `Banido. Motivo: ${reason}` });
    this.logger.warn(`Usuário ${userId} banido por ${actorId}; ${result.sessionsRevoked} sessão(ões) revogada(s).`);
    await this.syncMemberRole("remove", result.discordId, `Banido no painel: ${reason}`);
    return result;
  }

  async unban(userId: string, actorId: string): Promise<UnbanUserResult> {
    const before = await getBanStatus(this.handle.db, userId);
    const result = await unbanUser(this.handle.db, userId);
    if (!result.ok) return result;

    await addUserNote(this.handle.db, {
      userId,
      authorId: actorId,
      kind: "system",
      body: before ? `Desbanido. O banimento era por: ${before.banReason}` : "Desbanido.",
    });
    this.logger.warn(`Usuário ${userId} desbanido por ${actorId}.`);
    // O cargo Membro volta na próxima aprovação de nick, não aqui: quem foi banido pode ter perdido o nick
    // no meio do caminho, e devolver cargo às cegas é dar acesso que ninguém conferiu.
    return result;
  }

  /** Cargo Membro no Discord. Sem bot ligado (teste, e2e) não há o que sincronizar. */
  private async syncMemberRole(action: "remove", discordId: string, reason: string): Promise<void> {
    if (!this.gateway || !this.memberRoleId) return;
    try {
      await this.gateway.removeRole(discordId, this.memberRoleId, reason);
      this.logger.log(`Cargo Membro removido de ${discordId} (${action}).`);
    } catch (error) {
      this.logger.error(`Falha ao remover o cargo Membro de ${discordId}: ${describeDiscordError(error)}`);
    }
  }
}
