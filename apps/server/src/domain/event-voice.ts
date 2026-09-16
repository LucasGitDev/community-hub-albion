import { EVENT_CANCEL_REASON_MAX, eventStatusLabel, type EventStatus } from "@albion-hub/shared";

/**
 * Canal de voz do evento (TASK-024, Q28/Q29). Funções puras, sem discord.js e sem banco: o nome do
 * canal, quem o start pode arrastar e como o comando do bot resolve de qual evento a pessoa está
 * falando. A regra de estado continua na máquina compartilhada; aqui só mora o que é texto e seleção.
 */

/** Canal de voz do Discord aceita no máximo 100 caracteres no nome. */
export const VOICE_CHANNEL_NAME_MAX = 100;

/**
 * Nome do canal a partir do nome do evento. Tira o que o Discord recusa ou normaliza sozinho (quebras
 * de linha, caracteres de controle) e corta no limite, sempre sobrando algo clicável: evento só com
 * caracteres estranhos vira um nome genérico em vez de um canal sem nome.
 */
export function eventVoiceChannelName(eventName: string): string {
  const cleaned = [...eventName]
    // Controles e separadores viram espaço; o resto passa (o Discord aceita acento e emoji).
    .map((char) => (char < " " || char === "" ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "Evento";
  return cleaned.length <= VOICE_CHANNEL_NAME_MAX ? cleaned : `${cleaned.slice(0, VOICE_CHANNEL_NAME_MAX - 1).trimEnd()}…`;
}

/** Inscrito do evento, reduzido ao que a seleção precisa. */
export interface VoiceSignup {
  discordId: string;
  status: "confirmed" | "waitlist";
}

/**
 * Quem o start arrasta (Q29): inscrito **confirmado** e que está, agora, no canal "Aguardando Evento".
 * Lista de espera não entra, e quem está em qualquer outro canal de voz (ou fora da voz) fica onde
 * está — o bot nunca puxa ninguém de outro canal. Sem duplicatas e na ordem em que estão no canal,
 * para o log do start bater com o que aconteceu.
 */
export function membersToMove(signups: readonly VoiceSignup[], presentDiscordIds: readonly string[]): string[] {
  const confirmed = new Set(signups.filter((s) => s.status === "confirmed").map((s) => s.discordId));
  return [...new Set(presentDiscordIds)].filter((id) => confirmed.has(id));
}

/** Evento candidato do comando `/evento`, reduzido ao que o resolvedor precisa. */
export interface EventChoice {
  id: string;
  name: string;
}

export type ResolveEventResult =
  | { kind: "found"; event: EventChoice }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: EventChoice[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fold = (value: string) => value.trim().toLowerCase();

/**
 * De qual evento o comando está falando. `candidates` já vem filtrado pelo estado da ação e pela
 * permissão de quem chamou, então aqui é só desempate por texto:
 * - sem busca: só resolve se houver exatamente um candidato;
 * - id exato ganha de tudo;
 * - senão nome igual; senão nome que contém o texto.
 * Empate devolve `ambiguous` com os candidatos, para a resposta efêmera listar os ids.
 */
export function resolveEventForCommand(candidates: readonly EventChoice[], query: string | null | undefined): ResolveEventResult {
  const search = query ? fold(query) : "";
  if (search.length === 0) {
    if (candidates.length === 1) return { kind: "found", event: candidates[0]! };
    return candidates.length === 0 ? { kind: "none" } : { kind: "ambiguous", candidates: [...candidates] };
  }
  if (UUID.test(search)) {
    const byId = candidates.find((c) => fold(c.id) === search);
    return byId ? { kind: "found", event: byId } : { kind: "none" };
  }
  const exact = candidates.filter((c) => fold(c.name) === search);
  const matches = exact.length > 0 ? exact : candidates.filter((c) => fold(c.name).includes(search));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "found", event: matches[0]! };
  return { kind: "ambiguous", candidates: matches };
}

/**
 * Slash command `/evento iniciar|encerrar|cancelar` (TASK-024 AC#4, TASK-025). Mesmo serviço do painel,
 * outra porta: o comando nunca aplica regra própria, só resolve de qual evento a pessoa está falando.
 */
export const EVENT_COMMAND = {
  name: "evento",
  description: "Controla um evento da comunidade",
  start: { name: "iniciar", description: "Cria o canal de voz e arrasta os confirmados que estão em Aguardando Evento" },
  finish: { name: "encerrar", description: "Devolve todo mundo para Aguardando Evento e apaga o canal do evento" },
  cancel: { name: "cancelar", description: "Cancela o evento, avisa os inscritos e desfaz o canal de voz se já tiver começado" },
  option: { name: "evento", description: "Nome ou id do evento; deixe em branco se só houver um", maxLength: 120 },
  reason: { name: "motivo", description: "O que os inscritos vão ler no aviso de cancelamento", maxLength: EVENT_CANCEL_REASON_MAX },
} as const;

const list = (candidates: readonly EventChoice[]) => candidates.map((c) => `• **${c.name}** — \`${c.id}\``).join("\n");

/** Respostas efêmeras do comando (PT-BR). Só falam de eventos que quem chamou já podia ver. */
export const EVENT_COMMAND_REPLIES = {
  wrongGuild: "Esse comando só funciona no servidor da guilda.",
  notRegistered: "Sua conta Discord ainda não está no painel. Use /registrar para pedir seu nick e entrar na comunidade.",
  noneToStart: "Não achei nenhum evento seu para iniciar. Ele precisa estar com as inscrições abertas ou fechadas, e você precisa ser o owner (ou staff).",
  noneToFinish: "Não achei nenhum evento seu em andamento para encerrar.",
  noneToCancel: "Não achei nenhum evento seu para cancelar. Evento já finalizado ou já cancelado não volta atrás.",
  ambiguous: (candidates: readonly EventChoice[]) => `Tem mais de um evento nesse estado. Repita o comando com o nome exato ou o id:\n${list(candidates)}`,
  invalidState: (from: EventStatus, message: string) => `${message} (o evento está ${eventStatusLabel(from)}).`,
  started: (name: string) => `Evento **${name}** iniciado. Estou criando o canal de voz e puxando os confirmados que estão em Aguardando Evento.`,
  finished: (name: string) => `Evento **${name}** encerrado. Estou devolvendo a galera para Aguardando Evento e apagando o canal.`,
  cancelled: (name: string, reason: string | null) =>
    `Evento **${name}** cancelado e todas as inscrições canceladas. ${reason ? `Motivo publicado: "${reason}".` : "Sem motivo publicado."}`,
  reasonTooLong: `O motivo tem no máximo ${EVENT_CANCEL_REASON_MAX} caracteres.`,
  failed: "Não consegui fazer isso agora. Tente de novo em instantes ou use o painel.",
} as const;
