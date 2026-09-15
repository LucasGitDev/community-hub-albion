/** Texto acionável (PT-BR) para erros do Discord que o operador consegue resolver. */
export function describeDiscordError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 50001) {
    return `Discord recusou acesso (${message}). Convide o bot na guild GUILD_ID com os escopos "bot" e "applications.commands".`;
  }
  if (code === 50013) {
    return `Bot sem permissão no Discord (${message}). Confira as permissões do bot (Gerenciar Apelidos/Cargos) e se o cargo do bot está acima do cargo alvo e do membro (o dono da guild nunca pode ter o apelido alterado por bots).`;
  }
  if (code === "GUILD_OWNER_NICKNAME") {
    return `${message}. Limitação do Discord: altere o apelido do dono manualmente.`;
  }
  if (code === 10007) {
    return `Membro não está na guild (${message}). Nada aplicado no Discord.`;
  }
  return `Erro do cliente Discord: ${message}`;
}
