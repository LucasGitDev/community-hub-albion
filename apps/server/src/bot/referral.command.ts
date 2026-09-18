import { Inject, Injectable, Logger } from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { Context, Options, SlashCommand, UserOption } from "necord";
import { buildReferralReply, REFERRAL_COMMAND } from "@albion-hub/shared";
import { AccountService } from "../members/account.service.js";
import { ReferralService } from "../members/referral.service.js";
import { isConfiguredGuild, REGISTER_REPLIES } from "../domain/register-nick.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import type { SlashInteractionLike } from "./register-nick.command.js";

/** O que o seletor de membros entrega: só o que a indicação usa (testes simulam). */
export interface ReferrerPick {
  id: string;
  username: string;
  globalName: string | null;
}

export class ReferralOptions {
  /**
   * Opção do tipo **usuário** (TASK-075): digitar @ abre o seletor de membros do Discord, e o indicador
   * chega como ID — sem grafia para errar, que era o ponto fraco do nick digitado.
   */
  @UserOption({ name: REFERRAL_COMMAND.option.name, description: REFERRAL_COMMAND.option.description, required: true })
  indicado_por!: ReferrerPick;
}

/**
 * `/indicacao indicado_por:@membro` (TASK-074, AC#2; seletor de membros desde a TASK-075): o caminho de quem já se registrou e esqueceu de
 * dizer quem o trouxe. Existe porque declarar depois é caso normal, não exceção — o campo é do usuário
 * e nunca fecha, então não há prazo para usar este comando.
 *
 * O comando não decide nada: chama o ReferralService, igual ao `/registrar` e ao painel.
 */
@Injectable()
export class ReferralCommand {
  private readonly logger = new Logger("ReferralCommand");

  constructor(
    private readonly referrals: ReferralService,
    private readonly accounts: AccountService,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  @SlashCommand({ name: REFERRAL_COMMAND.name, description: REFERRAL_COMMAND.description })
  async onReferral(@Context() [interaction]: [SlashInteractionLike], @Options() options: ReferralOptions): Promise<void> {
    if (!isConfiguredGuild(interaction.guildId, this.guildId)) {
      await this.respond(interaction, REGISTER_REPLIES.wrongGuild, false);
      return;
    }
    let deferred = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      const { user } = interaction;
      // Mesma porta de sempre: a conta nasce da identidade da interação, com os papéis do login OAuth.
      const { user: account } = await this.accounts.ensureFromDiscord({
        discordId: user.id,
        discordUsername: user.username,
        displayName: user.globalName,
        avatar: user.avatar,
      });
      const picked = options.indicado_por;
      const outcome = await this.referrals.declareByDiscordId(account.id, picked.id, picked.globalName ?? picked.username);
      await interaction.editReply({ content: buildReferralReply(outcome) });
    } catch (error) {
      this.logger.error(`/${REFERRAL_COMMAND.name} de ${interaction.user.id} falhou: ${String(error)}`);
      await this.respond(interaction, REFERRAL_REPLY_FAILED, deferred);
    }
  }

  private async respond(interaction: SlashInteractionLike, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error(`Não consegui responder o /${REFERRAL_COMMAND.name}: ${String(error)}`);
    }
  }
}

export const REFERRAL_REPLY_FAILED = "Não consegui registrar a indicação agora. Tente de novo em instantes.";
