import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { VoiceTrackingService } from "./voice-tracking.service.js";
import { VoiceListener } from "./voice.listener.js";

const GUILD = "123456789012345678";

function state(channelId: string | null, opts: { guildId?: string; bot?: boolean; member?: boolean } = {}) {
  return {
    id: "400000000000000001",
    channelId,
    guild: { id: opts.guildId ?? GUILD },
    member: opts.member === false ? null : { user: { bot: opts.bot ?? false } },
  } as never;
}

function setup() {
  const apply = vi.fn().mockResolvedValue(undefined);
  const listener = new VoiceListener({ apply } as unknown as VoiceTrackingService, GUILD);
  return { apply, listener };
}

describe("VoiceListener (TASK-018, VoiceState falso)", () => {
  it("encaminha join, leave e move para o serviço", async () => {
    const { apply, listener } = setup();
    await listener.onVoiceStateUpdate([state(null), state("c1")]);
    await listener.onVoiceStateUpdate([state("c1"), state("c2")]);
    await listener.onVoiceStateUpdate([state("c2"), state(null)]);
    expect(apply.mock.calls.map(([u]) => (u as { action: unknown }).action)).toEqual([
      { kind: "join", channelId: "c1" },
      { kind: "move", fromChannelId: "c1", toChannelId: "c2" },
      { kind: "leave", channelId: "c2" },
    ]);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ discordUserId: "400000000000000001", guildId: GUILD }));
  });

  it("ignora outra guild (Q4)", async () => {
    const { apply, listener } = setup();
    await listener.onVoiceStateUpdate([state(null, { guildId: "999" }), state("c1", { guildId: "999" })]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("ignora bots, inclusive quando só o estado antigo tem member", async () => {
    const { apply, listener } = setup();
    await listener.onVoiceStateUpdate([state(null, { bot: true }), state("c1", { bot: true })]);
    await listener.onVoiceStateUpdate([state("c1", { bot: true }), state(null, { member: false })]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("sem member em nenhum estado trata como humano", async () => {
    const { apply, listener } = setup();
    await listener.onVoiceStateUpdate([state(null, { member: false }), state("c1", { member: false })]);
    expect(apply).toHaveBeenCalledOnce();
  });
});
