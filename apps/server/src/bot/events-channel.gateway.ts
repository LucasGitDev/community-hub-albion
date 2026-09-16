import { Inject, Injectable } from "@nestjs/common";
import { Client } from "discord.js";
import type { EmbedView } from "../domain/embed-view.js";
import { DiscordChannelGateway, type ChannelClientLike } from "./discord-channel.gateway.js";

export const EVENTS_CHANNEL_GATEWAY = Symbol("EVENTS_CHANNEL_GATEWAY");
export const DISCORD_EVENTS_CHANNEL_ID = Symbol("DISCORD_EVENTS_CHANNEL_ID");

/**
 * Porta do canal de eventos (TASK-022): um canal só, configurado por `DISCORD_EVENTS_CHANNEL_ID`, onde
 * todo evento aberto ganha uma mensagem com os botões de role. Canal fixo (e não um por evento) porque
 * a v1 tem uma guild só (Q4) e a galera acompanha a agenda num lugar; criar canal por evento é TASK-024,
 * e é de voz.
 */
export interface EventsChannelGateway {
  /** Publica o embed do evento e devolve o id da mensagem. */
  postEvent(view: EmbedView): Promise<string>;
  editEvent(messageId: string, view: EmbedView): Promise<void>;
}

@Injectable()
export class DiscordJsEventsChannelGateway extends DiscordChannelGateway implements EventsChannelGateway {
  constructor(
    @Inject(Client) client: ChannelClientLike,
    @Inject(DISCORD_EVENTS_CHANNEL_ID) channelId: string,
  ) {
    super(client, channelId, "EVENTS_CHANNEL_NOT_TEXT");
  }

  postEvent(view: EmbedView): Promise<string> {
    return this.post(view);
  }

  editEvent(messageId: string, view: EmbedView): Promise<void> {
    return this.edit(messageId, view);
  }
}
