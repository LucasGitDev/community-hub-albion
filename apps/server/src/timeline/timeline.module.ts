import { type DynamicModule, Logger, Module, type Provider } from "@nestjs/common";
import { Client } from "discord.js";
import type { Env } from "../config/env.js";
import { TIMELINE_PUBLISHER, type TimelineEntry, type TimelinePublisher } from "../domain/timeline.js";
import { DiscordTimelinePublisher, type TimelineClientLike } from "./discord-timeline.publisher.js";
import { NoopTimelinePublisher } from "./noop-timeline.publisher.js";

export interface TimelineModuleOptions {
  /** Sem bot não há cliente do Discord: a timeline fica desligada mesmo com o canal configurado. */
  bot: boolean;
  /** Dublê para testes de integração (ex.: `FakeTimelinePublisher`) — substitui qualquer implementação. */
  publisher?: TimelinePublisher;
}

/**
 * Cinto de segurança do contrato (T6): qualquer implementação que um dia lance (inclusive a futura
 * gravação em banco) vira log aqui, e a operação que publicou segue.
 */
export function guardTimeline(inner: TimelinePublisher, logger: Pick<Logger, "warn"> = new Logger("Timeline")): TimelinePublisher {
  return {
    publish(entry: TimelineEntry): void {
      try {
        inner.publish(entry);
      } catch (error) {
        try {
          logger.warn(`Timeline: publicação falhou e foi ignorada (${error instanceof Error ? error.message : String(error)})`);
        } catch {
          // nada: a timeline nunca derruba a operação
        }
      }
    },
  };
}

/**
 * `TIMELINE_PUBLISHER` global e sempre presente (TASK-076). Os serviços injetam sem saber se a
 * timeline está ligada: com bot e `DISCORD_TIMELINE_CHANNEL_ID`, é o Discord; senão, no-op (T6).
 */
@Module({})
export class TimelineModule {
  static register(env: Pick<Env, "DISCORD_TIMELINE_CHANNEL_ID">, options: TimelineModuleOptions): DynamicModule {
    return { module: TimelineModule, global: true, providers: [timelineProvider(env, options)], exports: [TIMELINE_PUBLISHER] };
  }
}

function timelineProvider(env: Pick<Env, "DISCORD_TIMELINE_CHANNEL_ID">, options: TimelineModuleOptions): Provider {
  const logger = new Logger("Timeline");
  if (options.publisher) return { provide: TIMELINE_PUBLISHER, useValue: guardTimeline(options.publisher, logger) };
  const channelId = env.DISCORD_TIMELINE_CHANNEL_ID;
  if (!options.bot || !channelId) {
    return {
      provide: TIMELINE_PUBLISHER,
      useFactory: () => {
        logger.log(channelId ? "Timeline desligada: bot do Discord desativado" : "Timeline desligada: DISCORD_TIMELINE_CHANNEL_ID vazio");
        return new NoopTimelinePublisher();
      },
    };
  }
  return {
    provide: TIMELINE_PUBLISHER,
    useFactory: (client: TimelineClientLike) => {
      logger.log(`Timeline ligada no canal ${channelId}`);
      return guardTimeline(new DiscordTimelinePublisher(client, channelId, logger), logger);
    },
    inject: [Client],
  };
}
