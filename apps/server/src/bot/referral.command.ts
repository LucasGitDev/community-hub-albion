import { Inject, Injectable, Logger } from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { Context, Options, SlashCommand, StringOption } from "necord";
import { buildReferralReply, NICK_MAX_LENGTH, NICK_MIN_LENGTH, REFERRAL_COMMAND } from "@albion-hub/shared";
import { AccountService } from "../members/account.service.js";
import { ReferralService } from "../members/referral.service.js";
import { isConfiguredGuild, REGISTER_REPLIES } from "../domain/register-nick.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import type { SlashInteractionLike } from "./register-nick.command.js";

export class ReferralOptions {
  @StringOption({
    name: REFERRAL_COMMAND.option.name,
    description: REFERRAL_COMMAND.option.description,
    required: true,
    min_length: NICK_MIN_LENGTH,
    max_length: NICK_MAX_LENGTH,
  })
  indicado_por!: string;
}

/**
 * `/indicacao indicado_por:<nick>` (TASK-074, AC#2): o caminho de quem já se registrou e esqueceu de
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
      const outcome = await this.referrals.declare(account.id, options.indicado_por);
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
