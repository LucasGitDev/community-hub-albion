import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { EventLateSignupService } from "./event-late-signup.service.js";
import type { VoiceTrackingService } from "./voice-tracking.service.js";
import { VoiceListener } from "./voice.listener.js";

const GUILD = "123456789012345678";

function state(channelId: string | null, opts: { guildId?: string; bot?: boolean; member?: boolean } = {}) {
  return {
    id: "400000000000000001",
    channelId,
    guild: { id: opts.guildId ?? GUILD },
    member: opts.member === false ? null : { user: { bot: opts.bot ?? false }, displayName: "Ana" },
  } as never;
}

function setup() {
  const apply = vi.fn().mockResolvedValue(undefined);
  const noteArrival = vi.fn();
  const listener = new VoiceListener({ apply } as unknown as VoiceTrackingService, GUILD, { noteArrival } as unknown as EventLateSignupService);
  return { apply, noteArrival, listener };
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

describe("gatilho da pergunta de inscrição no meio da call (TASK-086)", () => {
  it("avisa o serviço em join e em move, com o apelido do servidor", async () => {
    const { noteArrival, listener } = setup();
    await listener.onVoiceStateUpdate([state(null), state("c1")]);
    await listener.onVoiceStateUpdate([state("c1"), state("c2")]);
    expect(noteArrival.mock.calls.map(([a]) => a)).toEqual([
      { discordUserId: "400000000000000001", channelId: "c1", displayName: "Ana" },
      { discordUserId: "400000000000000001", channelId: "c2", displayName: "Ana" },
    ]);
  });

  it("sair da call não pergunta nada", async () => {
    const { noteArrival, listener } = setup();
    await listener.onVoiceStateUpdate([state("c1"), state(null)]);
    expect(noteArrival).not.toHaveBeenCalled();
  });

  it("sem apelido no cache cai para o id, em vez de deixar o botão sem rótulo", async () => {
    const { noteArrival, listener } = setup();
    await listener.onVoiceStateUpdate([state(null, { member: false }), state("c1", { member: false })]);
    expect(noteArrival).toHaveBeenCalledWith(expect.objectContaining({ displayName: "400000000000000001" }));
  });
});
