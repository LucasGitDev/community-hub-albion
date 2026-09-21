import type { EmbedView } from "./embed-view.js";

/**
 * Chamar quem se inscreveu e não entrou na call (TASK-087, decisões PE12 a PE16 do doc-005). Funções
 * puras: quem é chamado, o que o privado diz, como fica a queda para menção e a copy das duas portas.
 * Nada aqui conhece Discord, banco ou CASL.
 *
 * **Quem é chamado (PE13):** inscrito **confirmado** que não está na call agora. Lista de espera não
 * recebe — ela não tem vaga garantida, e chamar seria prometer o que o evento não tem. Quem já está na
 * call também não: ele já está onde deveria estar.
 *
 * **Privado, não menção (PE16):** o chamado é mensagem no privado. A menção no chat da call existe só
 * como **queda** de quem está com o privado fechado (PE14) — o Discord recusa DM de quem não é amigo, e
 * falha silenciosa faria o caller achar que chamou.
 *
 * **Intervalo (PE15):** 5 minutos por pessoa e por evento. O controle é do banco
 * (`claimEventSummons`), não daqui: privado repetido é o caminho mais curto para a pessoa bloquear o
 * bot, e um contador em memória esqueceria tudo no primeiro restart.
 */

/** 5 minutos por pessoa e por evento (PE15). */
export const EVENT_SUMMON_COOLDOWN_MS = 5 * 60_000;

/** Inscrito do evento, reduzido ao que a seleção do chamado precisa. */
export interface SummonCandidate {
  userId: string;
  discordId: string | null;
  status: "confirmed" | "waitlist";
}

/** Alvo do chamado: sempre tem conta Discord, senão não haveria para onde mandar o privado. */
export interface SummonTarget {
  userId: string;
  discordId: string;
}

/**
 * Quem o chamado atinge (PE13): confirmado, com conta Discord e **fora da call agora**. Sem duplicatas
 * e na ordem da lista de inscritos, para o log e a timeline baterem com o que aconteceu.
 */
export function summonTargets(signups: readonly SummonCandidate[], presentDiscordIds: readonly string[]): SummonTarget[] {
  const present = new Set(presentDiscordIds);
  const seen = new Set<string>();
  const targets: SummonTarget[] = [];
  for (const signup of signups) {
    const { userId, discordId } = signup;
    if (signup.status !== "confirmed" || !discordId || present.has(discordId) || seen.has(userId)) continue;
    seen.add(userId);
    targets.push({ userId, discordId });
  }
  return targets;
}

/** Link direto do canal de voz: um clique entra, em vez de "procure na lista de canais". */
export function eventCallLink(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Azul do evento em andamento, o mesmo do embed de inscrição e do menu da call: é a mesma call. */
const SUMMON_COLOR = 0x3498db;

/**
 * O privado (AC#1). Diz **qual evento** e **como entrar**, e para por aí: quem recebe está no meio de
 * outra coisa, e um texto longo no privado de um bot é o que faz a pessoa silenciar o bot.
 */
export function eventSummonDmView(event: { name: string }, callLink: string | null): EmbedView {
  return {
    title: `${event.name} já começou`,
    description:
      "Você está **confirmado** e ainda não está na call do evento." +
      (callLink ? `\n\n[Entrar na call](${callLink})` : "\n\nEntre no canal de voz do evento, na categoria de eventos do servidor."),
    color: SUMMON_COLOR,
    fields: [],
    buttons: [],
  };
}

/**
 * A queda (PE14): **uma mensagem só** no chat da call, com a lista de quem não pôde ser avisado no
 * privado. Uma mensagem por pessoa viraria enxurrada no chat justamente quando a call está enchendo.
 */
export function eventSummonMentionText(event: { name: string }, discordIds: readonly string[]): string {
  const mentions = discordIds.map((id) => `<@${id}>`).join(" ");
  return `${mentions} — **${event.name}** começou e vocês estão confirmados. Não consegui chamar no privado (DM fechada para quem não é amigo), então fica o toque por aqui: entrem na call.`;
}

/** Resultado de um chamado, do jeito que as duas portas e a timeline leem. */
export interface SummonOutcome {
  /** Avisados no privado. */
  notified: number;
  /** Privado fechado: entraram na menção do chat da call. */
  mentioned: number;
  /** Fora do intervalo de 5 minutos: já tinham sido chamados há pouco (PE15). */
  skipped: number;
  /** Confirmados fora da call no momento do clique. */
  targets: number;
}

const people = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Frase única do resultado, usada no efêmero do menu da call e no toast do painel. */
export function eventSummonSummary(outcome: SummonOutcome): string {
  if (outcome.targets === 0) return "Todo mundo que está confirmado já está na call. Ninguém foi chamado.";
  if (outcome.notified === 0 && outcome.mentioned === 0) {
    return `Ninguém foi chamado agora: ${people(outcome.skipped, "pessoa foi avisada", "pessoas foram avisadas")} há menos de 5 minutos.`;
  }
  const parts = [`Chamei ${people(outcome.notified, "pessoa no privado", "pessoas no privado")}.`];
  if (outcome.mentioned > 0) parts.push(`${people(outcome.mentioned, "está", "estão")} com o privado fechado e ${outcome.mentioned === 1 ? "foi mencionada" : "foram mencionadas"} no chat da call.`);
  if (outcome.skipped > 0) parts.push(`${people(outcome.skipped, "pessoa já tinha sido chamada", "pessoas já tinham sido chamadas")} há menos de 5 minutos.`);
  return parts.join(" ");
}

/** Recusas do chamado, iguais nas duas portas (PT-BR). */
export const EVENT_SUMMON_REPLIES = {
  notRunning: "O chamado só existe com o evento em andamento: é a call dele que está esperando gente.",
  noChannel: "Esse evento não tem canal de voz agora. Nada foi feito.",
  denied: "Só o caller do evento e a staff chamam quem falta. Nada foi feito.",
  notFound: "Não achei esse evento.",
  unavailable: "O bot do Discord está desligado nesta instância: não dá para chamar ninguém no privado.",
} as const;
