/**
 * Chamado de quem se inscreveu e não entrou na call (TASK-087, PE12 a PE16 do doc-005), na parte que o
 * servidor **e** o painel precisam enxergar: a conta do que foi feito e a frase que a descreve.
 *
 * Ela mora aqui, e não no servidor, porque a mesma frase é o efêmero do menu da call no Discord e o
 * toast do painel. Duas cópias da mesma copy viram duas verdades no dia em que uma das duas mudar.
 *
 * O resto do chamado (o texto do privado, a menção, o gateway) é do servidor: depende de Discord.
 */

/** 5 minutos por pessoa e por evento (PE15). */
export const EVENT_SUMMON_COOLDOWN_MS = 5 * 60_000;

/** O que um chamado fez. Todos os números são de pessoas. */
export interface SummonOutcome {
  /** Avisados no privado. */
  notified: number;
  /** Privado fechado: entraram na menção do chat da call (PE14). */
  mentioned: number;
  /** Fora do intervalo de 5 minutos: já tinham sido chamados há pouco (PE15). */
  skipped: number;
  /** Confirmados fora da call no momento do clique. */
  targets: number;
}

const people = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Frase única do resultado: o efêmero do menu da call e o toast do painel dizem a mesma coisa.
 *
 * Ela sempre responde "o que aconteceu com quem eu quis chamar?", inclusive quando a resposta é "nada":
 * chamado que não diz nada faz o caller clicar de novo, e clicar de novo é o privado repetido que a
 * PE15 existe para evitar.
 */
export function eventSummonSummary(outcome: SummonOutcome): string {
  if (outcome.targets === 0) return "Todo mundo que está confirmado já está na call. Ninguém foi chamado.";
  if (outcome.notified === 0 && outcome.mentioned === 0) {
    return `Ninguém foi chamado agora: ${people(outcome.skipped, "pessoa foi avisada", "pessoas foram avisadas")} há menos de 5 minutos.`;
  }
  const parts = [`Chamei ${people(outcome.notified, "pessoa no privado", "pessoas no privado")}.`];
  if (outcome.mentioned > 0) {
    parts.push(`${people(outcome.mentioned, "está", "estão")} com o privado fechado e ${outcome.mentioned === 1 ? "foi mencionada" : "foram mencionadas"} no chat da call.`);
  }
  if (outcome.skipped > 0) parts.push(`${people(outcome.skipped, "pessoa já tinha sido chamada", "pessoas já tinham sido chamadas")} há menos de 5 minutos.`);
  return parts.join(" ");
}
