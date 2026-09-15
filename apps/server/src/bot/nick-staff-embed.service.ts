import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { getNickRequestEmbedData, setNickRequestDiscordMessageId, type DbHandle, type NickRequestEmbedData } from "@albion-hub/db";
import { describeAlbionLookup } from "@albion-hub/shared";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { buildNickEmbed, type NickLookupView } from "../domain/nick-embed.js";
import { NickDecisionService } from "../members/nick-decision.service.js";
import { NickRequestService } from "../members/nick-request.service.js";
import { STAFF_CHANNEL_GATEWAY, type StaffChannelGateway } from "./staff-channel.gateway.js";

const UNKNOWN_MESSAGE = 10008;

/**
 * Embed do pedido de nick no canal da staff (TASK-015). Assina os hooks pós-commit:
 * pedido novo → publica e guarda o message id; nick pendente corrigido → edita; decisão (painel ou botão) → edita sem botões.
 * Falha do Discord/banco é logada e nunca lança: pedido e decisão já gravados ficam.
 */
@Injectable()
export class NickStaffEmbedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("NickStaffEmbed");
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly requests: NickRequestService,
    private readonly decisions: NickDecisionService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(STAFF_CHANNEL_GATEWAY) private readonly gateway: StaffChannelGateway,
    @Inject(ALBION_PLAYER_LOOKUP) private readonly albion: AlbionPlayerLookup,
  ) {}

  onModuleInit(): void {
    this.unsubscribe.push(
      this.requests.onRequested((e) => this.sync(e.request.id)),
      this.decisions.onDecided((e) => this.sync(e.request.id)),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** Publica ou atualiza o embed com o estado atual do pedido. Também usado para "refresh" em conflito. */
  async sync(requestId: string): Promise<void> {
    let data: NickRequestEmbedData | null;
    try {
      data = await getNickRequestEmbedData(this.handle.db, requestId);
    } catch (error) {
      this.logger.error(`Embed do pedido ${requestId}: falha ao ler o banco: ${String(error)}`);
      return;
    }
    if (!data) {
      this.logger.error(`Embed do pedido ${requestId}: pedido não encontrado`);
      return;
    }
    const view = buildNickEmbed({
      requestId,
      requesterDiscordId: data.requester.discordId,
      currentNick: data.requester.gameNick,
      nick: data.request.nick,
      status: data.request.status,
      createdAt: data.request.createdAt,
      decidedAt: data.request.decidedAt,
      deciderDiscordId: data.decider?.discordId ?? null,
      decisionNote: data.request.decisionNote,
      lookup: await this.lookupFor(data),
    });
    const messageId = data.request.discordMessageId;
    if (messageId) {
      try {
        await this.gateway.editNickRequest(messageId, view);
        return;
      } catch (error) {
        this.logger.error(`Embed do pedido ${requestId}: falha ao editar a mensagem ${messageId}. ${describeDiscordError(error)}`);
        // Mensagem apagada no canal: republica se ainda está pendente (staff precisa dos botões).
        if (!isUnknownMessage(error) || data.request.status !== "pending") return;
      }
    } else if (data.request.status !== "pending") {
      return; // nunca foi publicado (ex.: Discord fora no pedido); decidido não precisa aparecer agora.
    }
    try {
      const posted = await this.gateway.postNickRequest(view);
      await setNickRequestDiscordMessageId(this.handle.db, requestId, posted);
    } catch (error) {
      this.logger.error(`Embed do pedido ${requestId}: falha ao publicar no canal da staff. ${describeDiscordError(error)}`);
    }
  }

  /** Resultado da consulta Albion (TASK-016 AC#3). Desligada → sem campo; falha nunca impede publicar/editar (Q14). */
  private async lookupFor(data: NickRequestEmbedData): Promise<NickLookupView | null> {
    try {
      const summary = describeAlbionLookup(await this.albion.lookup(data.request.nick));
      return summary ? { summary } : null;
    } catch (error) {
      this.logger.warn(`Embed do pedido ${data.request.id}: consulta Albion falhou: ${String(error)}`);
      return null;
    }
  }
}

const isUnknownMessage = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNKNOWN_MESSAGE;
