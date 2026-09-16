import { Inject, Injectable, Logger } from "@nestjs/common";
import { importDiscordMember, setAlbionCheck, type AlbionCheck, type DbHandle } from "@albion-hub/db";
import type { AlbionLookupResult } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { DISCORD_GUILD_MEMBERS_GATEWAY, type DiscordGuildMembersGateway } from "../bot/discord-guild-members.gateway.js";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { emptyImportSummary, planMemberImport, type MemberImportSummary } from "../domain/member-import.js";
import { DISCORD_MEMBER_ROLE_ID } from "../bot/discord-member-sync.service.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";

/**
 * Importa para o painel os membros que já estão regularizados no Discord (TASK-042).
 *
 * Serviço único: `/importar-membros` (e, quando a TASK-043 precisar, um endpoint de admin) só chamam `import()`.
 * Uma transação por membro (repo do db), então apelido ruim de um não derruba os outros. Idempotente: rodar de novo
 * não duplica conta e nunca sobrescreve nick já aprovado no painel (AC#4).
 *
 * Albion (AC#7): uma consulta por nick **único**, pelo serviço já cacheado da TASK-016. `unavailable` e `disabled`
 * não são conflito: o import continua e a staff revê depois pelo `albion_checked_at`.
 */
@Injectable()
export class DiscordMemberImportService {
  private readonly logger = new Logger("DiscordMemberImport");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_GUILD_MEMBERS_GATEWAY) private readonly members: DiscordGuildMembersGateway,
    @Inject(ALBION_PLAYER_LOOKUP) private readonly albion: AlbionPlayerLookup,
    @Inject(DISCORD_MEMBER_ROLE_ID) private readonly memberRoleId: string,
  ) {}

  async import(): Promise<MemberImportSummary> {
    const summary = emptyImportSummary();
    const guildMembers = await this.members.listMembers();
    /** nick (sem caixa) → usuários importados com ele: consulta o Albion uma vez por nick. */
    const byNick = new Map<string, { nick: string; userIds: string[] }>();

    for (const member of guildMembers) {
      const plan = planMemberImport(member, this.memberRoleId);
      if (plan.kind === "skip") {
        summary.skipped++;
        continue;
      }
      if (plan.kind === "conflict") {
        summary.conflicts.push(`\`${member.nickname ?? member.username}\` — ${plan.reason}`);
        continue;
      }
      try {
        const result = await importDiscordMember(this.handle.db, {
          profile: { discordId: member.discordId, discordUsername: member.username, displayName: member.globalName, avatar: member.avatar },
          guildTag: plan.guildTag,
          nick: plan.nick,
        });
        if (result.created) summary.created++;
        else if (result.nickApplied || result.roleGranted || result.guildTagChanged) summary.updated++;
        else summary.skipped++;
        const key = (result.keptNick ?? plan.nick).toLowerCase();
        const entry = byNick.get(key) ?? { nick: result.keptNick ?? plan.nick, userIds: [] };
        entry.userIds.push(result.userId);
        byNick.set(key, entry);
      } catch (error) {
        // Falha de banco em um membro não derruba a importação: entra como conflito para o admin reexecutar.
        this.logger.error(`Import do membro ${member.discordId} falhou: ${String(error)}`);
        summary.conflicts.push(`\`${member.nickname ?? member.username}\` — erro ao gravar, tente importar de novo`);
      }
    }

    await this.checkAlbion(byNick, summary);
    return summary;
  }

  /** Confere cada nick único no Albion e persiste o resultado. Nunca lança: a consulta é ajuda, não requisito. */
  private async checkAlbion(byNick: Map<string, { nick: string; userIds: string[] }>, summary: MemberImportSummary): Promise<void> {
    for (const { nick, userIds } of byNick.values()) {
      let result: AlbionLookupResult;
      try {
        result = await this.albion.lookup(nick);
      } catch (error) {
        this.logger.warn(`Consulta Albion de ${nick} falhou: ${String(error)}`);
        summary.albion.unavailable += userIds.length;
        continue;
      }
      if (result.status === "disabled") {
        summary.albion.disabled += userIds.length;
        continue;
      }
      if (result.status === "found") summary.albion.found += userIds.length;
      else if (result.status === "not_found") summary.albion.notFound += userIds.length;
      else summary.albion.unavailable += userIds.length;

      const check: AlbionCheck =
        result.status === "found"
          ? { status: "found", playerId: result.playerId, guildName: result.guildName, checkedAt: new Date(result.checkedAt) }
          : { status: result.status, checkedAt: new Date(result.checkedAt) };
      for (const userId of userIds) {
        try {
          await setAlbionCheck(this.handle.db, userId, check);
        } catch (error) {
          this.logger.warn(`Não consegui gravar a conferência Albion de ${nick}: ${String(error)}`);
        }
      }
    }
  }
}
