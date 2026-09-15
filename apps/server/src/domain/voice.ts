/** Estado de voz mínimo (subset de discord.js VoiceState) que a regra precisa. */
export interface VoiceUpdateInput {
  oldChannelId: string | null | undefined;
  newChannelId: string | null | undefined;
}

export type VoiceAction =
  | { kind: "join"; channelId: string }
  | { kind: "leave"; channelId: string }
  | { kind: "move"; fromChannelId: string; toChannelId: string }
  | { kind: "noop" };

/**
 * Classifica um voiceStateUpdate (TASK-018). Mesmo canal (mute/deafen/stream/vídeo) é noop.
 * Todos os canais de voz da guild contam, inclusive AFK: o filtro por canal do evento é da presença (Q6).
 */
export function classifyVoiceUpdate({ oldChannelId, newChannelId }: VoiceUpdateInput): VoiceAction {
  const from = oldChannelId ?? null;
  const to = newChannelId ?? null;
  if (from === to) return { kind: "noop" };
  if (from === null) return { kind: "join", channelId: to! };
  if (to === null) return { kind: "leave", channelId: from };
  return { kind: "move", fromChannelId: from, toChannelId: to };
}

/** Evento de voz relevante: só a guild configurada (Q4) e nunca bots. */
export function shouldTrackVoiceMember(input: { guildId: string; isBot: boolean }, configuredGuildId: string): boolean {
  return input.guildId === configuredGuildId && !input.isBot;
}
