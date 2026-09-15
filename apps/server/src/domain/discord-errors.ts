/** Texto acionável (PT-BR) para erros do Discord que o operador consegue resolver. */
export function describeDiscordError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 50001) {
    return `Discord recusou acesso (${message}). Convide o bot na guild GUILD_ID com os escopos "bot" e "applications.commands".`;
  }
  if (code === 50013) {
    return `Bot sem permissão no Discord (${message}). Confira os cargos/permissões do bot na guild.`;
  }
  return `Erro do cliente Discord: ${message}`;
}
