import type { EmbedView } from "../domain/embed-view.js";
import { toMessagePayload, type EmbedChannelGateway, type MessagePayload } from "./embed-message.js";

type ChannelLike = { send?: (payload: MessagePayload) => Promise<{ id: string }>; messages?: { edit(id: string, payload: MessagePayload): Promise<unknown> } };
export type ChannelClientLike = { channels: { fetch(id: string): Promise<ChannelLike | null> } };

/**
 * Publica e edita embeds num canal de texto fixo. Base do canal da staff (TASK-015) e do canal de
 * eventos (TASK-022): o que muda entre eles é só a env do canal. Erro do Discord sobe para o chamador
 * logar com `describeDiscordError` — aqui nada é engolido.
 */
export abstract class DiscordChannelGateway implements EmbedChannelGateway {
  protected constructor(
    private readonly client: ChannelClientLike,
    private readonly channelId: string,
    /** Código do erro quando o canal não serve, para a mensagem citar a env certa. */
    private readonly notTextCode: string,
  ) {}

  async post(view: EmbedView): Promise<string> {
    const channel = await this.channel();
    const message = await channel.send(toMessagePayload(view));
    return message.id;
  }

  async edit(messageId: string, view: EmbedView): Promise<void> {
    const channel = await this.channel();
    await channel.messages.edit(messageId, toMessagePayload(view));
  }

  private async channel(): Promise<Required<ChannelLike>> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel?.send || !channel.messages) throw Object.assign(new Error("Canal do bot não é de texto"), { code: this.notTextCode });
    return channel as Required<ChannelLike>;
  }
}
