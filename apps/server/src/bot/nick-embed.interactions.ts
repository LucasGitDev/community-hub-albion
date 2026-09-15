import { Inject, Injectable, Logger } from "@nestjs/common";
import { findUserIdByDiscordId, getNickRequestEmbedData, listRoles, type DbHandle } from "@albion-hub/db";
import { defineAbilityFor, validateRejectionNote } from "@albion-hub/shared";
import { ComponentType, MessageFlags, TextInputStyle } from "discord.js";
import { Button, ComponentParam, Context, Modal, ModalParam } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import {
  buildRejectModal,
  isNickRequestId,
  NICK_APPROVE_BUTTON,
  NICK_BUTTON_REPLIES,
  NICK_REJECT_BUTTON,
  NICK_REJECT_MODAL,
  NICK_REJECT_NOTE_FIELD,
} from "../domain/nick-embed.js";
import { NickDecisionService, type NickDecisionResult } from "../members/nick-decision.service.js";
import { NickStaffEmbedService } from "./nick-staff-embed.service.js";

type ReplyOptions = { content: string; flags: MessageFlags.Ephemeral };
/** Subconjunto de ButtonInteraction/ModalSubmitInteraction usado aqui (testes simulam). */
export interface InteractionLike {
  user: { id: string };
  reply(options: ReplyOptions): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}
export interface ButtonInteractionLike extends InteractionLike {
  showModal(modal: ReturnType<typeof toModalPayload>): Promise<unknown>;
}
export interface ModalInteractionLike extends InteractionLike {
  fields: { getTextInputValue(customId: string): string };
}

const ephemeral = (content: string): ReplyOptions => ({ content, flags: MessageFlags.Ephemeral });

function toModalPayload(modal: ReturnType<typeof buildRejectModal>) {
  return {
    custom_id: modal.customId,
    title: modal.title,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: modal.field.customId,
            label: modal.field.label,
            style: TextInputStyle.Paragraph,
            min_length: modal.field.minLength,
            max_length: modal.field.maxLength,
            required: true,
          },
        ],
      },
    ],
  };
}

/**
 * Botões do embed de pedido de nick (TASK-015). Só autentica quem clicou e chama o NickDecisionService (doc-002):
 * resultado igual ao do painel. Autorização: Discord id → usuário do painel → papéis → CASL approve MemberRequest.
 */
@Injectable()
export class NickEmbedInteractions {
  private readonly logger = new Logger("NickEmbedInteractions");

  constructor(
    private readonly decisions: NickDecisionService,
    private readonly embeds: NickStaffEmbedService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  @Button(NICK_APPROVE_BUTTON)
  async onApprove(@Context() [interaction]: [ButtonInteractionLike], @ComponentParam("id") requestId: string): Promise<void> {
    await this.guarded(interaction, requestId, async (deciderId, defer) => {
      await defer();
      return this.decisions.approve(requestId, deciderId);
    });
  }

  @Button(NICK_REJECT_BUTTON)
  async onReject(@Context() [interaction]: [ButtonInteractionLike], @ComponentParam("id") requestId: string): Promise<void> {
    try {
      if (!isNickRequestId(requestId)) return void (await interaction.reply(ephemeral(NICK_BUTTON_REPLIES.invalid)));
      const denied = await this.authorize(interaction.user.id);
      if (!denied.ok) return void (await interaction.reply(ephemeral(denied.message)));
      const data = await getNickRequestEmbedData(this.handle.db, requestId);
      if (!data) return void (await interaction.reply(ephemeral(NICK_BUTTON_REPLIES.notFound)));
      if (data.request.status !== "pending") {
        await this.embeds.sync(requestId);
        return void (await interaction.reply(ephemeral(NICK_BUTTON_REPLIES.alreadyDecided)));
      }
      // Modal precisa ser a primeira resposta da interação (sem defer).
      await interaction.showModal(toModalPayload(buildRejectModal(requestId, data.request.nick)));
    } catch (error) {
      this.logger.error(`Botão recusar do pedido ${requestId} falhou: ${String(error)}`);
      await this.safeRespond(interaction, NICK_BUTTON_REPLIES.failed, false);
    }
  }

  @Modal(NICK_REJECT_MODAL)
  async onRejectSubmit(@Context() [interaction]: [ModalInteractionLike], @ModalParam("id") requestId: string): Promise<void> {
    await this.guarded(interaction, requestId, async (deciderId, defer) => {
      const note = validateRejectionNote(interaction.fields.getTextInputValue(NICK_REJECT_NOTE_FIELD));
      if (!note.ok) return { message: note.error };
      await defer();
      return this.decisions.reject(requestId, deciderId, note.note);
    });
  }

  /** Discord id → usuário do painel → papéis → CASL (mesma regra do painel: approve MemberRequest). */
  async authorize(discordId: string): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
    const userId = await findUserIdByDiscordId(this.handle.db, discordId);
    if (!userId) return { ok: false, message: NICK_BUTTON_REPLIES.notRegistered };
    const roles = await listRoles(this.handle.db, userId);
    if (!defineAbilityFor({ id: userId, roles }).can("approve", "MemberRequest")) return { ok: false, message: NICK_BUTTON_REPLIES.notStaff };
    return { ok: true, userId };
  }

  /** Valida id e permissão (recusa efêmera antes de qualquer escrita) e responde com o resultado da decisão. */
  private async guarded(
    interaction: InteractionLike,
    requestId: string,
    decide: (deciderId: string, defer: () => Promise<void>) => Promise<NickDecisionResult | { message: string }>,
  ): Promise<void> {
    let deferred = false;
    try {
      if (!isNickRequestId(requestId)) return void (await interaction.reply(ephemeral(NICK_BUTTON_REPLIES.invalid)));
      const auth = await this.authorize(interaction.user.id);
      if (!auth.ok) return void (await interaction.reply(ephemeral(auth.message)));
      // Decisão espera hooks (apelido/cargo, embed): adia a resposta para não estourar os 3 s do Discord.
      const defer = async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        deferred = true;
      };
      const result = await decide(auth.userId, defer);
      if ("message" in result) return void (await this.safeRespond(interaction, result.message, deferred));
      if (result.ok) {
        const text = result.request.status === "approved" ? NICK_BUTTON_REPLIES.approved(result.request.nick) : NICK_BUTTON_REPLIES.rejected(result.request.nick);
        return void (await interaction.editReply({ content: text }));
      }
      if (result.reason === "not_found") return void (await interaction.editReply({ content: NICK_BUTTON_REPLIES.notFound }));
      await this.embeds.sync(requestId);
      await interaction.editReply({ content: NICK_BUTTON_REPLIES.alreadyDecided });
    } catch (error) {
      this.logger.error(`Interação do pedido ${requestId} falhou: ${String(error)}`);
      await this.safeRespond(interaction, NICK_BUTTON_REPLIES.failed, deferred);
    }
  }

  private async safeRespond(interaction: InteractionLike, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply(ephemeral(content));
    } catch (error) {
      this.logger.error(`Não consegui responder a interação: ${String(error)}`);
    }
  }
}
