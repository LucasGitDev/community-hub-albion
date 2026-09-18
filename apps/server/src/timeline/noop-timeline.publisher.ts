import type { TimelineEntry, TimelinePublisher } from "../domain/timeline.js";

/** Timeline desligada (sem DISCORD_TIMELINE_CHANNEL_ID ou sem bot, T6): aceita tudo e não faz nada. */
export class NoopTimelinePublisher implements TimelinePublisher {
  publish(_entry: TimelineEntry): void {}
}
