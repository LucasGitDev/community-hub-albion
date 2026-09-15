import { describe, expect, it } from "vitest";
import { classifyVoiceUpdate, membersInVoice, shouldTrackVoiceMember } from "./voice.js";

describe("classifyVoiceUpdate", () => {
  it("join: sem canal → canal", () => {
    expect(classifyVoiceUpdate({ oldChannelId: null, newChannelId: "c1" })).toEqual({ kind: "join", channelId: "c1" });
    expect(classifyVoiceUpdate({ oldChannelId: undefined, newChannelId: "c1" })).toEqual({ kind: "join", channelId: "c1" });
  });

  it("leave: canal → sem canal", () => {
    expect(classifyVoiceUpdate({ oldChannelId: "c1", newChannelId: null })).toEqual({ kind: "leave", channelId: "c1" });
    expect(classifyVoiceUpdate({ oldChannelId: "c1", newChannelId: undefined })).toEqual({ kind: "leave", channelId: "c1" });
  });

  it("move: canal A → canal B", () => {
    expect(classifyVoiceUpdate({ oldChannelId: "c1", newChannelId: "c2" })).toEqual({ kind: "move", fromChannelId: "c1", toChannelId: "c2" });
  });

  it("noop: mesmo canal (mute/deafen/stream) ou fora de voz", () => {
    expect(classifyVoiceUpdate({ oldChannelId: "c1", newChannelId: "c1" })).toEqual({ kind: "noop" });
    expect(classifyVoiceUpdate({ oldChannelId: null, newChannelId: null })).toEqual({ kind: "noop" });
    expect(classifyVoiceUpdate({ oldChannelId: undefined, newChannelId: null })).toEqual({ kind: "noop" });
  });
});

describe("shouldTrackVoiceMember", () => {
  it("aceita humano da guild configurada", () => {
    expect(shouldTrackVoiceMember({ guildId: "g", isBot: false }, "g")).toBe(true);
  });
  it("ignora outra guild (Q4) e bots", () => {
    expect(shouldTrackVoiceMember({ guildId: "x", isBot: false }, "g")).toBe(false);
    expect(shouldTrackVoiceMember({ guildId: "g", isBot: true }, "g")).toBe(false);
  });
});

describe("membersInVoice (TASK-019)", () => {
  const G = "g1";
  it("lista humanos em canal da guild configurada", () => {
    expect(
      membersInVoice(
        [
          { userId: "u1", guildId: G, channelId: "c1", isBot: false },
          { userId: "u2", guildId: G, channelId: "c2", isBot: undefined },
        ],
        G,
      ),
    ).toEqual([
      { discordUserId: "u1", guildId: G, channelId: "c1" },
      { discordUserId: "u2", guildId: G, channelId: "c2" },
    ]);
  });

  it("ignora bots, outra guild, sem canal e duplicatas", () => {
    expect(
      membersInVoice(
        [
          { userId: "bot", guildId: G, channelId: "c1", isBot: true },
          { userId: "x", guildId: "other", channelId: "c1", isBot: false },
          { userId: "out", guildId: G, channelId: null, isBot: false },
          { userId: "undef", guildId: G, channelId: undefined, isBot: false },
          { userId: "u1", guildId: G, channelId: "c1", isBot: false },
          { userId: "u1", guildId: G, channelId: "c9", isBot: false },
        ],
        G,
      ),
    ).toEqual([{ discordUserId: "u1", guildId: G, channelId: "c1" }]);
  });
});
