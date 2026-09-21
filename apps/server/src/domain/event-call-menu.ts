import type { EmbedView } from "./embed-view.js";
import type { EventStatus } from "@albion-hub/shared";

/**
 * Menu de gestão da call (TASK-085, decisões PE9 a PE11 do doc-005). Funções puras, sem discord.js e
 * sem banco: os ids dos botões, o embed do menu, a copy das recusas e a seleção de quem continua
 * podendo entrar com a call fechada.
 *
 * O menu fica no **chat de texto do próprio canal de voz** do evento, publicado quando o canal nasce
 * (PE9). Ele é visível para todo mundo que enxerga a call — o Discord não esconde componente por
 * cargo —, então a permissão é checada **no clique** (PE11), nunca aqui.
 *
 * Iniciar evento e encerrar inscrições não entram no menu: quando a call existe, os dois já
 * aconteceram.
 */

export const EVENT_CALL_FINISH_BUTTON = "evento/call/finalizar/:eventId";
export const EVENT_CALL_LOCK_BUTTON = "evento/call/fechar/:eventId";
export const EVENT_CALL_UNLOCK_BUTTON = "evento/call/abrir/:eventId";

const withEvent = (template: string, eventId: string) => template.replace(":eventId", eventId);

export const eventCallFinishButtonId = (eventId: string): string => withEvent(EVENT_CALL_FINISH_BUTTON, eventId);
export const eventCallLockButtonId = (eventId: string): string => withEvent(EVENT_CALL_LOCK_BUTTON, eventId);
export const eventCallUnlockButtonId = (eventId: string): string => withEvent(EVENT_CALL_UNLOCK_BUTTON, eventId);

/** Azul do evento em andamento, igual ao `running` do embed de inscrição: é a mesma call. */
const MENU_COLOR = 0x3498db;

/** Embed do menu. Sem lista de gente: quem está na call o Discord já mostra do lado. */
export function eventCallMenuView(event: { id: string; name: string }): EmbedView {
  return {
    title: `Gestão da call — ${event.name}`,
    description:
      "Só o caller do evento e a staff executam estas ações; quem clicar sem permissão recebe uma recusa e nada acontece.\n" +
      "**Fechar a call** tira a permissão de entrar de quem não está inscrito e **não remove ninguém que já está dentro**.",
    color: MENU_COLOR,
    fields: [],
    buttons: [
      { customId: eventCallLockButtonId(event.id), label: "Fechar a call", style: "secondary" },
      { customId: eventCallUnlockButtonId(event.id), label: "Abrir a call", style: "secondary" },
      { customId: eventCallFinishButtonId(event.id), label: "Finalizar o evento", style: "danger" },
    ],
  };
}

/** Inscrito do evento, reduzido ao que o menu precisa. */
export interface CallSignup {
  discordId: string | null;
  status: "confirmed" | "waitlist";
}

/**
 * Quem continua podendo entrar com a call fechada (PE10): **todo inscrito ativo**, confirmado ou na
 * espera. A espera entra porque a call fechada não é a lista do evento — é a porta: quem está na
 * espera pode virar confirmado no meio e não pode ficar trancado do lado de fora.
 */
export function callAllowedDiscordIds(signups: readonly CallSignup[]): string[] {
  return [...new Set(signups.map((s) => s.discordId).filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Respostas efêmeras do menu (PT-BR). */
export const EVENT_CALL_REPLIES = {
  invalid: "Esse botão não aponta para nenhum evento. Peça para o caller publicar o menu de novo.",
  notRegistered: "Sua conta Discord ainda não está no painel. Use /registrar para entrar na comunidade.",
  denied: "Só o caller do evento e a staff usam este menu. Nada foi feito.",
  notFound: "Não achei esse evento. O menu pode ser de um evento que já saiu do ar.",
  notRunning: (status: EventStatus) =>
    status === "finished"
      ? "Esse evento já foi finalizado: o menu da call não faz mais nada."
      : status === "cancelled"
        ? "Esse evento foi cancelado: o menu da call não faz mais nada."
        : `Esse evento não está em andamento (está ${status}).`,
  noChannel: "Esse evento não tem mais canal de voz. Nada foi feito.",
  locked: "Call fechada: quem não está inscrito não consegue mais entrar. Quem já estava dentro continua aí.",
  unlocked: "Call aberta: qualquer um pode entrar de novo.",
  lockFailed: "Não consegui mudar a permissão do canal (o bot pode não ter permissão, ou o canal foi apagado na mão). O evento segue normal.",
  finished: (name: string) => `Evento **${name}** finalizado. Estou devolvendo a galera para Aguardando Evento e apagando o canal.`,
  failed: "Não consegui fazer isso agora. Tente de novo em instantes ou use o painel.",
} as const;
