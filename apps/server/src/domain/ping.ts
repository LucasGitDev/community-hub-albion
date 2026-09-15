/** Resposta PT-BR do /ping. `wsPingMs` < 0 quando o heartbeat ainda não mediu latência. */
export function buildPingReply(wsPingMs: number): string {
  if (!Number.isFinite(wsPingMs) || wsPingMs < 0) return "🏓 Pong! Latência ainda sendo medida, tente de novo em instantes.";
  return `🏓 Pong! Latência do bot: ${Math.round(wsPingMs)} ms.`;
}
