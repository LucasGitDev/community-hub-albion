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

/** Estado de voz atual (subset plano de discord.js VoiceState) usado na reconciliação do boot. */
export interface CurrentVoiceState {
  userId: string;
  guildId: string;
  channelId: string | null | undefined;
  /** undefined quando o member não está no cache: tratado como humano, igual ao listener. */
  isBot: boolean | undefined;
}

export interface MemberInVoice {
  discordUserId: string;
  guildId: string;
  channelId: string;
}

/**
 * Quem está em voz agora na guild configurada (TASK-019, Q30): ignora outra guild, bots e
 * estados sem canal. Deduplica por usuário (primeiro vence) para abrir no máximo uma sessão.
 */
export function membersInVoice(states: Iterable<CurrentVoiceState>, configuredGuildId: string): MemberInVoice[] {
  const seen = new Map<string, MemberInVoice>();
  for (const s of states) {
    if (!s.channelId || seen.has(s.userId)) continue;
    if (!shouldTrackVoiceMember({ guildId: s.guildId, isBot: s.isBot ?? false }, configuredGuildId)) continue;
    seen.set(s.userId, { discordUserId: s.userId, guildId: s.guildId, channelId: s.channelId });
  }
  return [...seen.values()];
}
