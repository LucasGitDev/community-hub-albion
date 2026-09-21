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

// O intervalo, a conta do chamado e a frase do resultado moram em @albion-hub/shared: o painel mostra
// exatamente a mesma frase que o menu da call responde no Discord.
export { EVENT_SUMMON_COOLDOWN_MS, eventSummonSummary, type SummonOutcome } from "@albion-hub/shared";

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

/** Recusas do chamado, iguais nas duas portas (PT-BR). */
export const EVENT_SUMMON_REPLIES = {
  notRunning: "O chamado só existe com o evento em andamento: é a call dele que está esperando gente.",
  noChannel: "Esse evento não tem canal de voz agora. Nada foi feito.",
  denied: "Só o caller do evento e a staff chamam quem falta. Nada foi feito.",
  notFound: "Não achei esse evento.",
  unavailable: "O bot do Discord está desligado nesta instância: não dá para chamar ninguém no privado.",
} as const;
