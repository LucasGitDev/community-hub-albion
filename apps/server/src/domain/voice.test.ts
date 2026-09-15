import { describe, expect, it } from "vitest";
import { classifyVoiceUpdate, shouldTrackVoiceMember } from "./voice.js";

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
