import type { EventDto, EventFeeInput, LootSplitDto, SplitPresenceDto } from "@albion-hub/shared";
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

export const updateSplit = (
  eventId: string,
  splitId: string,
  body: { totalSilver?: bigint; lines?: { id: string; shareBp: number }[] },
): Promise<LootSplitDto> =>
  api(`/api/events/${eventId}/splits/${splitId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...(body.totalSilver === undefined ? {} : { totalSilver: body.totalSilver.toString() }), ...(body.lines ? { lines: body.lines } : {}) }),
  });

/** `paidInGameLineIds`: quem já recebeu a prata no jogo (TASK-081). Cada um ganha crédito e saque liquidado juntos. */
export const confirmSplit = (eventId: string, splitId: string, paidInGameLineIds: readonly string[]): Promise<LootSplitDto> =>
  api(`/api/events/${eventId}/splits/${splitId}/confirm`, { method: "POST", body: JSON.stringify({ paidInGameLineIds }) });

/** Taxa do evento: percentual (basis points) ou valor fixo, sem teto (doc-005, "Taxa do split"). */
export const setEventFee = (eventId: string, fee: EventFeeInput): Promise<EventDto> =>
  api(`/api/events/${eventId}/fee`, { method: "PUT", body: JSON.stringify({ fee: { type: fee.type, value: fee.value.toString() } }) });
