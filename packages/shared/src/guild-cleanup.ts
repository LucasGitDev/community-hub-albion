/**
 * Regras puras da limpeza diária de quem saiu do servidor (TASK-049, G6).
 *
 * Sem I/O: o job pergunta aqui **antes** de escrever qualquer coisa. Este arquivo existe por causa do
 * pior bug possível desta task — a API do Discord falhar, demorar ou devolver metade da lista, o job
 * concluir que a guild inteira saiu e desativar todo mundo numa madrugada. Nenhuma varredura é boa o
 * bastante para arriscar isso: na dúvida, não mexe em ninguém e registra o motivo.
 */

/** Horário da passada diária (madrugada, hora local do servidor). */
export const GUILD_CLEANUP_HOUR = 4;

/** Piso do disjuntor: abaixo disso a proporção não vale, senão uma comunidade de 3 pessoas nunca limpa. */
export const GUILD_CLEANUP_ABSENT_FLOOR = 5;
/** Teto proporcional: mais da metade das contas sumindo de uma vez é resposta parcial até prova em contrário. */
export const GUILD_CLEANUP_ABSENT_RATIO = 0.5;

export interface GuildCleanupCensus {
  /** Quantos membros a API do Discord devolveu (já sem bots). */
  presentCount: number;
  /** Quantas contas o painel conhece hoje. */
  knownCount: number;
  /** Quantas dessas contas não apareceram na resposta do Discord e ainda não estão marcadas. */
  absentCount: number;
}

export type GuildCleanupAssessment = { ok: true } | { ok: false; reason: string };

/**
 * Disjuntor da limpeza. Recusa a passada inteira (ninguém é alterado) quando a leitura da guild não
 * merece confiança:
 *
 * - lista vazia: um servidor com contas no painel sempre tem gente; vazio é falha de leitura, não êxodo;
 * - volume absurdo: mais que `max(FLOOR, knownCount * RATIO)` ausentes de uma vez cheira a página perdida.
 *
 * O limite é deliberadamente conservador: o custo de barrar uma limpeza legítima é ela rodar de novo
 * amanhã (ou por `POST /api/maintenance/cleanup`, depois de alguém olhar). O custo de deixar passar é
 * derrubar a comunidade inteira sozinho, de madrugada.
 */
export function assessGuildCleanup(census: GuildCleanupCensus): GuildCleanupAssessment {
  if (census.knownCount === 0) return { ok: true };
  if (census.presentCount === 0) {
    return { ok: false, reason: "o Discord devolveu zero membros: resposta vazia ou parcial, nenhuma conta foi alterada" };
  }
  const limit = guildCleanupAbsentLimit(census.knownCount);
  if (census.absentCount > limit) {
    return {
      ok: false,
      reason: `${census.absentCount} de ${census.knownCount} contas sumiriam de uma vez (limite ${limit}): tratado como resposta parcial do Discord, nenhuma conta foi alterada`,
    };
  }
  return { ok: true };
}

/** Quantos ausentes uma passada aceita antes de virar suspeita. */
export function guildCleanupAbsentLimit(knownCount: number): number {
  return Math.max(GUILD_CLEANUP_ABSENT_FLOOR, Math.floor(knownCount * GUILD_CLEANUP_ABSENT_RATIO));
}

/**
 * Próxima madrugada em que a limpeza deve rodar, depois de `from`. O agendador guarda esse instante e
 * compara com o relógio a cada passada curta — sem `setTimeout` de 24h, que uma suspensão do processo
 * ou um relógio ajustado atrasariam sem ninguém notar.
 */
export function nextGuildCleanupRun(from: Date, hour: number = GUILD_CLEANUP_HOUR): Date {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** Texto da nota de auditoria da conta desativada. O job não tem usuário logado: a autoria é esta frase. */
export const guildCleanupNote = (sessionsRevoked: number, rolesRemoved: readonly string[]): string =>
  [
    "Limpeza automática: a conta não está mais no servidor do Discord.",
    `Sessões derrubadas: ${sessionsRevoked}.`,
    `Papéis removidos: ${rolesRemoved.length > 0 ? rolesRemoved.join(", ") : "nenhum"}.`,
    "Saldo, extrato e saques não foram tocados.",
  ].join(" ");
