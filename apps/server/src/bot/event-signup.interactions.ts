import { Inject, Injectable, Logger } from "@nestjs/common";
import { findEventRoleSlot, findUserIdByDiscordId, getBanStatusByDiscordId, listRoles, type DbHandle } from "@albion-hub/db";
import { bannedSignupReply, defineAbilityFor, EVENT_JOIN_BUTTON, EVENT_LEAVE_BUTTON, isUuid } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { Button, ComponentParam, Context } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import { EVENT_BUTTON_REPLIES } from "../domain/event-embed.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { AccountService } from "../members/account.service.js";
import { EventEmbedService } from "./event-embed.service.js";

type ReplyOptions = { content: string; flags: MessageFlags.Ephemeral };

/** Subconjunto de ButtonInteraction usado aqui (os testes simulam). */
export interface EventButtonInteraction {
  user: { id: string; username: string; globalName?: string | null; avatar?: string | null };
  reply(options: ReplyOptions): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

const ephemeral = (content: string): ReplyOptions => ({ content, flags: MessageFlags.Ephemeral });

/**
 * Botões de inscrição do embed de evento (TASK-022, Q27).
 *
 * Segurança: o custom id carrega só o alvo (vaga ou evento). **Quem** entra vem sempre de
 * `interaction.user.id` → usuário do painel → CASL `join Event`, nunca de dado embutido no botão,
 * então um custom id forjado só consegue inscrever quem clicou. Mover terceiro não existe por botão:
 * é rota da API com `update Event` (owner/staff), AC#4.
 */
@Injectable()
export class EventSignupInteractions {
  private readonly logger = new Logger("EventSignupInteractions");

  constructor(
    private readonly signups: EventSignupsService,
    private readonly embeds: EventEmbedService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly accounts: AccountService,
  ) {}

  @Button(EVENT_JOIN_BUTTON)
  async onJoin(@Context() [interaction]: [EventButtonInteraction], @ComponentParam("slotId") slotId: string): Promise<void> {
    await this.guarded(interaction, slotId, async (userId) => {
      const slot = await this.slot(slotId);
      if (!slot) return { message: EVENT_BUTTON_REPLIES.unknownRole };
      const { eventId } = slot;
      const result = await this.signups.join(eventId, userId, slotId);
      if (!result.ok) {
        if (result.reason === "not_open") return { message: EVENT_BUTTON_REPLIES.notOpen(result.status), refresh: eventId };
        if (result.reason === "already_in_role") return { message: EVENT_BUTTON_REPLIES.alreadyInRole(slot.name) };
        if (result.reason === "unknown_role") return { message: EVENT_BUTTON_REPLIES.unknownRole, refresh: eventId };
        if (result.reason === "banned") return { message: bannedSignupReply(result.banReason) };
        // Taxa de entrada maior que o saldo em Buffunfa (TASK-058, AC#2): recusa com o número que falta.
        if (result.reason === "insufficient_funds") return { message: EVENT_BUTTON_REPLIES.insufficientFunds(result.fee, result.balance) };
        return { message: EVENT_BUTTON_REPLIES.notFound };
      }
      const { signup } = result;
      const entered = signup.status === "confirmed" ? EVENT_BUTTON_REPLIES.confirmed(signup.roleName) : EVENT_BUTTON_REPLIES.waitlisted(signup.roleName, signup.position);
      return { message: result.charged ? `${entered}\n${EVENT_BUTTON_REPLIES.charged(result.charged)}` : entered };
    });
  }

  @Button(EVENT_LEAVE_BUTTON)
  async onLeave(@Context() [interaction]: [EventButtonInteraction], @ComponentParam("eventId") eventId: string): Promise<void> {
    await this.guarded(interaction, eventId, async (userId) => {
      const result = await this.signups.leave(eventId, userId);
      if (result.ok) return { message: result.refunded ? `${EVENT_BUTTON_REPLIES.left}\n${EVENT_BUTTON_REPLIES.refunded(result.refunded)}` : EVENT_BUTTON_REPLIES.left };
      if (result.reason === "not_open") return { message: EVENT_BUTTON_REPLIES.notOpen(result.status), refresh: eventId };
      if (result.reason === "not_signed_up") return { message: EVENT_BUTTON_REPLIES.notSignedUp };
      return { message: EVENT_BUTTON_REPLIES.notFound };
    });
  }

  /**
   * Discord id → usuário do painel → papéis → CASL (mesma regra da API: `join Event`).
   * Sem conta, cria na hora com a mesma lógica do /registrar (TASK-037): inscrever-se não exige nick
   * aprovado; o nick só passa a valer quando entra a prata (F5). Banido não passa daqui (TASK-050).
   */
  async authorize(user: EventButtonInteraction["user"]): Promise<{ ok: true; userId: string; accountCreated: boolean } | { ok: false; message: string }> {
    // Banimento primeiro, pelo snowflake (TASK-050): quem está banido não pode virar uma conta nova só
    // por clicar no botão, então esta checagem vem antes de `ensureFromDiscord`, não depois.
    const ban = await getBanStatusByDiscordId(this.handle.db, user.id);
    if (ban) return { ok: false, message: bannedSignupReply(ban.banReason) };
    const existingId = await findUserIdByDiscordId(this.handle.db, user.id);
    let userId = existingId;
    let accountCreated = false;
    if (!userId) {
      const ensured = await this.accounts.ensureFromDiscord({
        discordId: user.id,
        discordUsername: user.username,
        displayName: user.globalName ?? null,
        avatar: user.avatar ?? null,
      });
      userId = ensured.user.id;
      accountCreated = ensured.created;
    }
    const roles = await listRoles(this.handle.db, userId);
    if (!defineAbilityFor({ id: userId, roles }).can("join", "Event")) return { ok: false, message: EVENT_BUTTON_REPLIES.notMember };
    return { ok: true, userId, accountCreated };
  }

  /** Valida o id do botão e a permissão antes de qualquer escrita, e responde sempre de forma efêmera. */
  private async guarded(
    interaction: EventButtonInteraction,
    id: string,
    act: (userId: string) => Promise<{ message: string; refresh?: string }>,
  ): Promise<void> {
    let deferred = false;
    try {
      if (!isUuid(id)) return void (await interaction.reply(ephemeral(EVENT_BUTTON_REPLIES.invalid)));
      const auth = await this.authorize(interaction.user);
      if (!auth.ok) return void (await interaction.reply(ephemeral(auth.message)));
      // A inscrição espera o banco e a edição do embed: adia a resposta para não estourar os 3 s do Discord.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
      const { message, refresh } = await act(auth.userId);
      const text = auth.accountCreated ? `${EVENT_BUTTON_REPLIES.accountCreated}\n${message}` : message;
      // Recusa por estado defasado: a mensagem do canal está velha, então atualiza junto com a resposta.
      if (refresh) await this.embeds.sync(refresh);
      await interaction.editReply({ content: text });
    } catch (error) {
      this.logger.error(`Botão de inscrição ${id} falhou: ${String(error)}`);
      await this.safeRespond(interaction, EVENT_BUTTON_REPLIES.failed, deferred);
    }
  }

  private slot(slotId: string) {
    return findEventRoleSlot(this.handle.db, slotId);
  }

  private async safeRespond(interaction: EventButtonInteraction, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply(ephemeral(content));
    } catch (error) {
      this.logger.error(`Não consegui responder a interação: ${String(error)}`);
    }
  }
}
