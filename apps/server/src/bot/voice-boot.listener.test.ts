import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { VoiceBootListener } from "./voice-boot.listener.js";
import type { VoiceHeartbeatService } from "./voice-heartbeat.service.js";
import type { VoiceTrackingService } from "./voice-tracking.service.js";

const GUILD = "123456789012345678";

function client(guild?: { id: string; states: { id: string; channelId: string | null; bot?: boolean; member?: boolean }[] }) {
  const cache = new Map<string, unknown>();
  if (guild) {
    cache.set(guild.id, {
      id: guild.id,
      voiceStates: {
        cache: new Map(guild.states.map((s) => [s.id, { id: s.id, channelId: s.channelId, member: s.member === false ? null : { user: { bot: s.bot ?? false } } }])),
      },
    });
  }
  return [{ guilds: { cache } }] as never;
}

function setup() {
  const order: string[] = [];
  const reconcile = vi.fn(async () => {
    order.push("reconcile");
    return { closed: 2, opened: 1 };
  });
  const start = vi.fn(() => order.push("start"));
  const listener = new VoiceBootListener({ reconcile } as unknown as VoiceTrackingService, { start } as unknown as VoiceHeartbeatService, GUILD);
  return { listener, reconcile, start, order };
}

describe("VoiceBootListener (TASK-019)", () => {
  it("reconcilia com quem está em voz e só depois liga o heartbeat", async () => {
    const { listener, reconcile, order } = setup();
    await listener.onReady(
      client({ id: GUILD, states: [{ id: "u1", channelId: "c1" }, { id: "b", channelId: "c1", bot: true }, { id: "u2", channelId: null }, { id: "u3", channelId: "c2", member: false }] }),
    );
    expect(reconcile).toHaveBeenCalledWith([
      { discordUserId: "u1", guildId: GUILD, channelId: "c1" },
      { discordUserId: "u3", guildId: GUILD, channelId: "c2" },
    ]);
    expect(order).toEqual(["reconcile", "start"]);
  });

  it("guild fora do cache: fecha abertas, reabre nenhuma e liga heartbeat", async () => {
    const { listener, reconcile, start } = setup();
    vi.spyOn((listener as unknown as { logger: { warn: (m: string) => void } }).logger, "warn").mockImplementation(() => {});
    await listener.onReady(client());
    expect(reconcile).toHaveBeenCalledWith([]);
    expect(start).toHaveBeenCalledOnce();
  });
});
