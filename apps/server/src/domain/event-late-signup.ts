import type { EmbedView } from "./embed-view.js";
import { eventStatusLabel, formatAmount, type EventStatus } from "@albion-hub/shared";

/**
 * Pergunta do bot para quem entrou na call **sem estar inscrito** (TASK-086, decisões PE7 e PE8 do
 * doc-005). Funções puras: ids de botão, embeds e copy. Sem discord.js, sem banco e sem estado.
 *
 * A pergunta vive no **chat de texto do próprio canal de voz** (PE7), como o menu de gestão da
 * TASK-085, e é visível para todo mundo que enxerga a call — então a permissão é checada **no
 * clique**, nunca aqui.
 *
 * **Uma pergunta por lote, não por pessoa.** Cinco entrando de uma vez viram uma mensagem só: o
 * serviço junta as entradas numa janela curta e monta a pergunta com até `QUESTION_MAX_PEOPLE`
 * pessoas, porque o Discord aceita cinco botões por linha e a linha precisa caber ainda o *Ignorar*.
 * Quem sobra vai para a mensagem seguinte.
 */

export const EVENT_LATE_ADD_BUTTON = "evento/entrou/inscrever/:ticket/:alvo";
export const EVENT_LATE_ROLE_BUTTON = "evento/entrou/role/:ticket/:alvo/:slotId";
export const EVENT_LATE_IGNORE_BUTTON = "evento/entrou/ignorar/:ticket";

export const eventLateAddButtonId = (ticket: string, discordUserId: string): string =>
  EVENT_LATE_ADD_BUTTON.replace(":ticket", ticket).replace(":alvo", discordUserId);
export const eventLateRoleButtonId = (ticket: string, discordUserId: string, slotId: string): string =>
  EVENT_LATE_ROLE_BUTTON.replace(":ticket", ticket).replace(":alvo", discordUserId).replace(":slotId", slotId);
export const eventLateIgnoreButtonId = (ticket: string): string => EVENT_LATE_IGNORE_BUTTON.replace(":ticket", ticket);

/** Quantas pessoas cabem numa pergunta: quatro botões *Inscrever* mais o *Ignorar* fecham a linha. */
export const QUESTION_MAX_PEOPLE = 4;

/** Amarelo de "precisa de uma decisão": não é erro, e não é o azul do evento em andamento. */
const QUESTION_COLOR = 0xf1c40f;

/** Alguém que entrou na call sem inscrição, do jeito que a pergunta precisa. */
export interface LatePerson {
  discordUserId: string;
  /** Nome que aparece no botão (apelido do servidor); cai para o snowflake quando não há nenhum. */
  displayName: string;
}

/** Corta o rótulo no limite do Discord (80) com folga para o verbo do botão. */
const label = (verb: string, name: string): string => {
  const text = `${verb} ${name}`;
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
};

/**
 * A pergunta em si (AC#1). Sem "inscrever todos": aceitar é sempre um gesto por pessoa, e cada aceite
 * ainda escolhe a role — inscrever em lote escolheria a role por quem não clicou.
 */
export function lateSignupQuestionView(event: { name: string }, ticket: string, people: readonly LatePerson[]): EmbedView {
  return {
    title: `Entrou na call sem inscrição — ${event.name}`,
    description:
      `${people.length === 1 ? "Essa pessoa está" : "Essas pessoas estão"} na call e não ${people.length === 1 ? "está" : "estão"} na lista do evento.\n` +
      "**Inscrever** pede a role e conta a presença **a partir de agora**, não de quando a pessoa entrou.\n" +
      "**Ignorar** encerra a pergunta. Sem resposta, nada acontece: ninguém é inscrito no silêncio.\n" +
      "Só o caller do evento e a staff respondem.",
    color: QUESTION_COLOR,
    fields: people.map((p) => ({ name: p.displayName, value: `<@${p.discordUserId}>`, inline: true })),
    buttons: [
      ...people.map((p) => ({ customId: eventLateAddButtonId(ticket, p.discordUserId), label: label("Inscrever", p.displayName), style: "success" as const })),
      { customId: eventLateIgnoreButtonId(ticket), label: people.length === 1 ? "Ignorar" : "Ignorar todos", style: "secondary" as const },
    ],
  };
}

/** Vaga livre oferecida no aceite. */
export interface LateRoleChoice {
  id: string;
  name: string;
  free: number;
}

/** Escolha da role, efêmera para quem clicou em *Inscrever* (AC#2). Só entram roles com vaga. */
export function lateSignupRoleView(ticket: string, person: LatePerson, roles: readonly LateRoleChoice[]): EmbedView {
  return {
    title: `Em qual role entra ${person.displayName}?`,
    description: "A presença conta a partir do aceite. Só aparecem as roles com vaga agora.",
    color: QUESTION_COLOR,
    fields: [],
    buttons: roles.map((r) => ({
      customId: eventLateRoleButtonId(ticket, person.discordUserId, r.id),
      label: label(r.name, `(${r.free} ${r.free === 1 ? "vaga" : "vagas"})`),
      style: "primary" as const,
    })),
  };
}

/** Respostas efêmeras da pergunta (PT-BR). */
export const EVENT_LATE_REPLIES = {
  expired: "Essa pergunta não vale mais (o bot reiniciou ou ela já foi respondida). Nada foi feito.",
  denied: "Só o caller do evento e a staff respondem esta pergunta. Nada foi feito.",
  notRegistered: "Sua conta Discord ainda não está no painel. Use /registrar para entrar na comunidade.",
  notFound: "Não achei esse evento. A pergunta pode ser de um evento que já saiu do ar.",
  notRunning: (status: EventStatus) =>
    status === "finished" ? "Esse evento já foi finalizado: a pergunta não faz mais nada." : `Esse evento não está em andamento (está ${eventStatusLabel(status)}).`,
  noRoles: (name: string) => `Não sobrou vaga em nenhuma role do evento, então não dá para inscrever ${name} agora. Libere uma vaga e peça para a pessoa entrar pelo embed.`,
  roleFull: (role: string) => `A vaga de **${role}** encheu enquanto você decidia. Escolha outra role.`,
  alreadySignedUp: (name: string) => `${name} já está na lista do evento. Nada foi feito.`,
  unknownRole: "Essa role não é mais do evento. Peça a pergunta de novo.",
  /**
   * Sem o saldo do alvo: quem clica é o caller, e `create Event` é do papel `caller` — dizer o número
   * daria a qualquer caller um jeito de descobrir o saldo de quem entrou na call dele. A taxa, que é
   * pública, basta para o caller entender a recusa.
   */
  insufficientFunds: (name: string, fee: bigint) => `${name} não tem Buffunfa para a taxa de entrada (${formatAmount(fee, "buffunfa")}). Ninguém foi inscrito.`,
  added: (name: string, role: string) => `**${name}** entrou no evento como **${role}**. A presença dele começa agora.`,
  charged: (name: string, fee: bigint) => `Taxa de entrada cobrada de ${name}: ${formatAmount(fee, "buffunfa")}.`,
  ignored: (count: number) => (count === 1 ? "Pergunta encerrada: ninguém foi inscrito." : `Pergunta encerrada para as ${count} pessoas: ninguém foi inscrito.`),
  failed: "Não consegui fazer isso agora. Tente de novo em instantes ou inscreva pelo painel.",
} as const;
