import { Logger } from "@nestjs/common";
import { describeDiscordError } from "../domain/discord-errors.js";
import { renderTimelineEmbed, type TimelineEmbed, type TimelineEntry, type TimelinePublisher } from "../domain/timeline.js";
import { TimelineQueue, type TimelineQueueOptions } from "../domain/timeline-queue.js";

type TimelinePayload = ReturnType<typeof toTimelinePayload>;
type TimelineChannelLike = { send?: (payload: TimelinePayload) => Promise<unknown> };
export type TimelineClientLike = { channels: { fetch(id: string): Promise<TimelineChannelLike | null> } };
type WarnLogger = Pick<Logger, "warn">;

/** Payload da API do Discord para um lote. Menções nunca notificam: o canal é de auditoria, não de aviso. */
function toTimelinePayload(embeds: readonly TimelineEmbed[]) {
  return {
    embeds: embeds.map((e) => ({
      title: e.title,
      ...(e.description ? { description: e.description } : {}),
      color: e.color,
      fields: e.fields,
      footer: { text: e.footer },
      timestamp: e.timestamp,
    })),
    allowedMentions: { parse: [] as never[] },
  };
}

/**
 * Timeline no canal #timeline do Discord (TASK-076). `publish` só monta o embed e enfileira: nunca
 * lança, nunca espera a rede (T6). A fila entrega em lotes e respeita o limite do canal (T10, T11).
 */
export class DiscordTimelinePublisher implements TimelinePublisher {
  private readonly queue: TimelineQueue;

  constructor(
    private readonly client: TimelineClientLike,
    private readonly channelId: string,
    private readonly logger: WarnLogger = new Logger("Timeline"),
    queueOptions: Partial<Omit<TimelineQueueOptions, "send" | "warn">> = {},
  ) {
    this.queue = new TimelineQueue({ ...queueOptions, send: (embeds) => this.send(embeds), warn: (message) => this.warn(message) });
  }

  publish(entry: TimelineEntry): void {
    try {
      this.queue.push(renderTimelineEmbed(entry));
    } catch (error) {
      this.warn(`Timeline: registro ${String(entry?.action)} não pôde ser montado (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /** Espera a fila esvaziar. Só testes usam: em produção a entrega é sempre em segundo plano. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  private async send(embeds: TimelineEmbed[]): Promise<void> {
    let channel: TimelineChannelLike | null;
    try {
      channel = await this.client.channels.fetch(this.channelId);
    } catch (error) {
      throw new Error(`${describeDiscordError(error)} Confira DISCORD_TIMELINE_CHANNEL_ID e se o bot vê o canal.`, { cause: error });
    }
    if (!channel?.send) throw new Error("Canal da timeline não aceita mensagens. Confira DISCORD_TIMELINE_CHANNEL_ID (precisa ser canal de texto).");
    await channel.send(toTimelinePayload(embeds));
  }

  private warn(message: string): void {
    try {
      this.logger.warn(message);
    } catch {
      // Logger quebrado não pode derrubar a fila nem quem publicou.
    }
  }
}
