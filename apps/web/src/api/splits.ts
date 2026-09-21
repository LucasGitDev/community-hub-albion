import type { EventDto, EventFeeInput, EventPresenceUpdateInput, LootSplitDto, SplitPresenceDto } from "@albion-hub/shared";
import { api } from "./http";

/**
 * Acerto do evento finalizado (TASK-029) contra a API da TASK-027/028. Prata sempre como string no
 * corpo: acima de 2^53 o `number` do JSON já teria perdido prata (Q20).
 */

/** Quem esteve na call e por quanto tempo, antes de existir rascunho: é com isto que a tela abre. */
export const fetchEventPresence = (eventId: string): Promise<{ present: SplitPresenceDto[] }> => api(`/api/events/${eventId}/presence`);

export const fetchEventSplits = (eventId: string): Promise<{ splits: LootSplitDto[] }> => api(`/api/events/${eventId}/splits`);

/** Sem `fee` no corpo de propósito: o rascunho congela a taxa que está no evento naquele instante. */
export const createSplit = (eventId: string, totalSilver: bigint): Promise<LootSplitDto> =>
  api(`/api/events/${eventId}/splits`, { method: "POST", body: JSON.stringify({ totalSilver: totalSilver.toString() }) });

/** Só o total: a participação é derivada da presença do evento (PE1/PE2), que tem rota própria. */
export const updateSplit = (eventId: string, splitId: string, totalSilver: bigint): Promise<LootSplitDto> =>
  api(`/api/events/${eventId}/splits/${splitId}`, { method: "PATCH", body: JSON.stringify({ totalSilver: totalSilver.toString() }) });

/**
 * Presença do evento (PE1, PE4): de 0 a 100% por pessoa, independente, sem precisar somar 100%.
 * A lista é parcial — manda só quem mudou — e a resposta traz a presença do evento inteiro.
 */
export const setEventPresence = (eventId: string, entries: EventPresenceUpdateInput["entries"]): Promise<{ present: SplitPresenceDto[] }> =>
  api(`/api/events/${eventId}/presence`, { method: "PUT", body: JSON.stringify({ entries }) });

/** `paidInGameLineIds`: quem já recebeu a prata no jogo (TASK-081). Cada um ganha crédito e saque liquidado juntos. */
export const confirmSplit = (eventId: string, splitId: string, paidInGameLineIds: readonly string[]): Promise<LootSplitDto> =>
  api(`/api/events/${eventId}/splits/${splitId}/confirm`, { method: "POST", body: JSON.stringify({ paidInGameLineIds }) });

/** Taxa do evento: percentual (basis points) ou valor fixo, sem teto (doc-005, "Taxa do split"). */
export const setEventFee = (eventId: string, fee: EventFeeInput): Promise<EventDto> =>
  api(`/api/events/${eventId}/fee`, { method: "PUT", body: JSON.stringify({ fee: { type: fee.type, value: fee.value.toString() } }) });
