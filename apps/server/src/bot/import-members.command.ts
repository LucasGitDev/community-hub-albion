import { Inject, Injectable, Logger } from "@nestjs/common";
import { findUserIdByDiscordId, listRoles, type DbHandle } from "@albion-hub/db";
import { defineAbilityFor } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { Context, SlashCommand } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import { buildImportSummaryReply, IMPORT_MEMBERS_COMMAND, IMPORT_MEMBERS_REPLIES } from "../domain/member-import.js";
import { isConfiguredGuild } from "../domain/register-nick.js";
import { DiscordMemberImportService } from "../members/discord-member-import.service.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";

/** Subconjunto de ChatInputCommandInteraction usado aqui (os testes simulam). */
export interface ImportMembersInteraction {
  guildId: string | null;
  user: { id: string };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

/** Discord responde 403 quando o Server Members Intent está desligado. */
const isForbidden = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && (error as { status: unknown }).status === 403;

/**
 * `/importar-membros` (TASK-042, AC#1): traz para o painel quem já tem cargo Membro e apelido no servidor.
 *
 * Segurança: **quem** chamou vem de `interaction.user.id` → usuário do painel → papéis → CASL. Só quem pode
 * `manage all` (admin, Q13) importa; qualquer outro recebe recusa efêmera e o serviço nem é chamado.
 * O comando não aplica regra nenhuma: delega ao DiscordMemberImportService, o mesmo caminho de um futuro
 * gatilho pelo painel.
 */
@Injectable()
export class ImportMembersCommand {
  private readonly logger = new Logger("ImportMembersCommand");

  constructor(
    private readonly importer: DiscordMemberImportService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  @SlashCommand({ name: IMPORT_MEMBERS_COMMAND.name, description: IMPORT_MEMBERS_COMMAND.description })
  async onImport(@Context() [interaction]: [ImportMembersInteraction]): Promise<void> {
    if (!isConfiguredGuild(interaction.guildId, this.guildId)) {
      await this.respond(interaction, IMPORT_MEMBERS_REPLIES.wrongGuild, false);
      return;
    }
    let deferred = false;
    try {
      if (!(await this.isAdmin(interaction.user.id))) {
        await this.respond(interaction, IMPORT_MEMBERS_REPLIES.notAdmin, false);
        return;
      }
      // Listar a guild + gravar + consultar o Albion passa fácil dos 3 s da interação.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      const summary = await this.importer.import();
      await interaction.editReply({ content: buildImportSummaryReply(summary) });
    } catch (error) {
      this.logger.error(`/${IMPORT_MEMBERS_COMMAND.name} de ${interaction.user.id} falhou: ${String(error)}`);
      await this.respond(interaction, isForbidden(error) ? IMPORT_MEMBERS_REPLIES.forbidden : IMPORT_MEMBERS_REPLIES.failed, deferred);
    }
  }

  private async isAdmin(discordId: string): Promise<boolean> {
    const userId = await findUserIdByDiscordId(this.handle.db, discordId);
    if (!userId) return false;
    return defineAbilityFor({ id: userId, roles: await listRoles(this.handle.db, userId) }).can("manage", "all");
  }

  private async respond(interaction: ImportMembersInteraction, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error(`Não consegui responder o /${IMPORT_MEMBERS_COMMAND.name}: ${String(error)}`);
    }
  }
}
