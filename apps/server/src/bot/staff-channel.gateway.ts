import { Inject, Injectable } from "@nestjs/common";
import { ButtonStyle, Client, ComponentType } from "discord.js";
import type { NickEmbedView } from "../domain/nick-embed.js";

export const STAFF_CHANNEL_GATEWAY = Symbol("STAFF_CHANNEL_GATEWAY");
export const DISCORD_STAFF_CHANNEL_ID = Symbol("DISCORD_STAFF_CHANNEL_ID");

/** Porta das mensagens no canal da staff (TASK-015). Testes usam fake; erros do Discord sobem para o chamador logar. */
export interface StaffChannelGateway {
  /** Publica o embed e devolve o id da mensagem. */
  postNickRequest(view: NickEmbedView): Promise<string>;
  editNickRequest(messageId: string, view: NickEmbedView): Promise<void>;
}

/** Payload da API do Discord a partir da view pura. Menções nunca notificam (allowed_mentions vazio). */
export function toMessagePayload(view: NickEmbedView) {
  return {
    embeds: [{ title: view.title, color: view.color, fields: view.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })) }],
    components:
      view.buttons.length === 0
        ? []
        : [
            {
              type: ComponentType.ActionRow,
              components: view.buttons.map((b) => ({
                type: ComponentType.Button,
                custom_id: b.customId,
                label: b.label,
                style: b.style === "success" ? ButtonStyle.Success : ButtonStyle.Danger,
              })),
            },
          ],
    allowedMentions: { parse: [] },
  };
}

type Payload = ReturnType<typeof toMessagePayload>;
type ChannelLike = { send?: (payload: Payload) => Promise<{ id: string }>; messages?: { edit(id: string, payload: Payload): Promise<unknown> } };
export type ChannelClientLike = { channels: { fetch(id: string): Promise<ChannelLike | null> } };

@Injectable()
export class DiscordJsStaffChannelGateway implements StaffChannelGateway {
  constructor(
    @Inject(Client) private readonly client: ChannelClientLike,
    @Inject(DISCORD_STAFF_CHANNEL_ID) private readonly channelId: string,
  ) {}

  async postNickRequest(view: NickEmbedView): Promise<string> {
    const channel = await this.channel();
    const message = await channel.send(toMessagePayload(view));
    return message.id;
  }

  async editNickRequest(messageId: string, view: NickEmbedView): Promise<void> {
    const channel = await this.channel();
    await channel.messages.edit(messageId, toMessagePayload(view));
  }

  private async channel(): Promise<Required<ChannelLike>> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel?.send || !channel.messages) {
      throw Object.assign(new Error("Canal da staff não é de texto"), { code: "STAFF_CHANNEL_NOT_TEXT" });
    }
    return channel as Required<ChannelLike>;
  }
}
