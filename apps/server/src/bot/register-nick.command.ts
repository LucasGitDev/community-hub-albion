import { Inject, Injectable, Logger } from "@nestjs/common";
import { MessageFlags } from "discord.js";
import { Context, Options, SlashCommand, StringOption, UserOption } from "necord";
import { buildReferralReply, REFERRAL_COMMAND } from "@albion-hub/shared";
import { buildRegisterReply, isConfiguredGuild, REGISTER_COMMAND, REGISTER_REPLIES } from "../domain/register-nick.js";
import { ReferralService } from "../members/referral.service.js";
import { NickRegistrationService, toRegisterOutcome } from "../members/nick-registration.service.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import type { ReferrerPick } from "./referral.command.js";

export class RegisterNickOptions {
  @StringOption({
    name: REGISTER_COMMAND.option.name,
    description: REGISTER_COMMAND.option.description,
    required: true,
    min_length: REGISTER_COMMAND.option.minLength,
    max_length: REGISTER_COMMAND.option.maxLength,
  })
  nick!: string;

  /**
   * Quem indicou (TASK-074, AC#1): **opcional**. Registrar sem isso continua exatamente igual — quem não
   * preencher declara depois com `/indicacao`, sem prazo, porque o campo do usuário nunca fecha.
   */
  @UserOption({ name: REFERRAL_COMMAND.option.name, description: REFERRAL_COMMAND.option.description, required: false })
  indicado_por?: ReferrerPick;
}

/** Subconjunto de ChatInputCommandInteraction usado aqui (testes simulam). */
export interface SlashInteractionLike {
  guildId: string | null;
  user: { id: string; username: string; globalName: string | null; avatar: string | null };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

/**
 * `/registrar nick:<nick>` (TASK-035): membro registra ou troca o nick sem abrir o painel. Só autentica pela interação
 * na guild configurada e chama o NickRegistrationService (mesmo caminho do POST /api/me/nick, doc-002).
 */
@Injectable()
export class RegisterNickCommand {
  private readonly logger = new Logger("RegisterNickCommand");

  constructor(
    private readonly registration: NickRegistrationService,
    private readonly referrals: ReferralService,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  @SlashCommand({ name: REGISTER_COMMAND.name, description: REGISTER_COMMAND.description })
  async onRegister(@Context() [interaction]: [SlashInteractionLike], @Options() { nick, indicado_por: referrer }: RegisterNickOptions): Promise<void> {
    if (!isConfiguredGuild(interaction.guildId, this.guildId)) {
      await this.respond(interaction, REGISTER_REPLIES.wrongGuild, false);
      return;
    }
    let deferred = false;
    try {
      // Banco + hooks (embed da staff no Discord) podem passar dos 3 s da interação: adia com resposta efêmera.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      const { user } = interaction;
      const { result, userId } = await this.registration.registerFromDiscord(
        { discordId: user.id, discordUsername: user.username, displayName: user.globalName, avatar: user.avatar },
        nick,
      );
      let content = buildRegisterReply(toRegisterOutcome(result));
      // A indicação é um segundo gesto na mesma interação, e opcional: quem não preenche registra igual
      // (AC#1). Ela vem depois de propósito — o registro já está gravado, e uma recusa aqui não o desfaz.
      if (referrer !== undefined && userId) content += `\n\n${buildReferralReply(await this.referrals.declareByDiscordId(userId, referrer.id, referrer.globalName ?? referrer.username))}`;
      await interaction.editReply({ content });
    } catch (error) {
      this.logger.error(`/registrar de ${interaction.user.id} falhou: ${String(error)}`);
      await this.respond(interaction, REGISTER_REPLIES.failed, deferred);
    }
  }

  private async respond(interaction: SlashInteractionLike, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error(`Não consegui responder o /registrar: ${String(error)}`);
    }
  }
}
