import { Inject, Injectable } from "@nestjs/common";
import { Client } from "discord.js";
import type { NickEmbedView } from "../domain/nick-embed.js";
import { DiscordChannelGateway, type ChannelClientLike } from "./discord-channel.gateway.js";

export const STAFF_CHANNEL_GATEWAY = Symbol("STAFF_CHANNEL_GATEWAY");
export const DISCORD_STAFF_CHANNEL_ID = Symbol("DISCORD_STAFF_CHANNEL_ID");

/** Porta das mensagens no canal da staff (TASK-015). Testes usam fake; erros do Discord sobem para o chamador logar. */
export interface StaffChannelGateway {
  /** Publica o embed e devolve o id da mensagem. */
  postNickRequest(view: NickEmbedView): Promise<string>;
  editNickRequest(messageId: string, view: NickEmbedView): Promise<void>;
}

export { toMessagePayload } from "./embed-message.js";
export type { ChannelClientLike } from "./discord-channel.gateway.js";

@Injectable()
export class DiscordJsStaffChannelGateway extends DiscordChannelGateway implements StaffChannelGateway {
  constructor(
    @Inject(Client) client: ChannelClientLike,
    @Inject(DISCORD_STAFF_CHANNEL_ID) channelId: string,
  ) {
    super(client, channelId, "STAFF_CHANNEL_NOT_TEXT");
  }

  postNickRequest(view: NickEmbedView): Promise<string> {
    return this.post(view);
  }

  editNickRequest(messageId: string, view: NickEmbedView): Promise<void> {
    return this.edit(messageId, view);
  }
}
