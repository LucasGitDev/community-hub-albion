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
  if (code === 10003 || code === "STAFF_CHANNEL_NOT_TEXT") {
    return `Canal da staff não encontrado ou não aceita mensagens (${message}). Confira DISCORD_STAFF_CHANNEL_ID e se o bot vê o canal (Ver canal, Enviar mensagens, Inserir links).`;
  }
  if (code === "EVENTS_CHANNEL_NOT_TEXT") {
    return `Canal de eventos não encontrado ou não aceita mensagens (${message}). Confira DISCORD_EVENTS_CHANNEL_ID e se o bot vê o canal (Ver canal, Enviar mensagens, Inserir links).`;
  }
  if (code === "EVENT_CATEGORY_INVALID") {
    return `Categoria dos eventos não encontrada (${message}). Confira DISCORD_EVENT_CATEGORY_ID e se o bot vê a categoria (Gerenciar Canais para criar e apagar o canal do evento).`;
  }
  if (code === "WAITING_VOICE_CHANNEL_INVALID") {
    return `Canal "Aguardando Evento" não encontrado ou não é de voz (${message}). Confira DISCORD_WAITING_VOICE_CHANNEL_ID e se o bot vê o canal (Ver canal, Conectar, Mover Membros).`;
  }
  if (code === 10008) {
    return `Mensagem do embed não existe mais (${message}).`;
  }
  return `Erro do cliente Discord: ${message}`;
}
