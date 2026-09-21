import type { EventCreateInput, EventDto, EventMemberDto, EventSignupDto, EventStatus, EventTransition, SummonOutcome } from "@albion-hub/shared";
import type { EventBoard } from "@/lib/events";
import { api } from "./http";

/** API de eventos e inscrições (TASK-021/022) vista pelo painel (TASK-023). */

/** Uma chamada só por tela: eventos + ocupação de cada vaga + minha inscrição. É ela que o polling repete. */
export const fetchEventBoard = (status?: readonly EventStatus[]): Promise<EventBoard> =>
  api<EventBoard>(`/api/events${status && status.length > 0 ? `?${status.map((s) => `status=${s}`).join("&")}` : ""}`);

/** Lista completa de um evento, com o nick de cada pessoa (tela do caller). */
export const fetchEventRoster = (eventId: string): Promise<{ signups: EventSignupDto[]; members: EventMemberDto[] }> =>
  api(`/api/events/${eventId}/signups`);

export const createEvent = (body: Omit<EventCreateInput, "startsAt" | "signupsCloseAt"> & { startsAt: string | null; signupsCloseAt: string | null }): Promise<EventDto> =>
  api("/api/events", { method: "POST", body: JSON.stringify(body) });

/** `reason` só é guardado no cancelamento (TASK-025); as outras transições ignoram o corpo. */
export const transitionEvent = (eventId: string, transition: EventTransition, reason?: string): Promise<EventDto> =>
  api(`/api/events/${eventId}/transitions/${transition}`, { method: "POST", body: JSON.stringify({ reason: reason || null }) });

/**
 * Chama no privado quem confirmou e não está na call (TASK-087, PE15). Mesma ação do menu da call no
 * Discord; o servidor é quem decide quem recebe e respeita o intervalo de 5 minutos por pessoa.
 */
export const summonEventAbsentees = (eventId: string): Promise<SummonOutcome> => api(`/api/events/${eventId}/summon`, { method: "POST" });

/** Correção dos dados do evento no acerto (TASK-029, AC#2). Arquivado recusa com 409 do servidor. */
export const updateEvent = (eventId: string, body: { name: string; description: string | null }): Promise<EventDto> =>
  api(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) });

/**
 * Taxa de entrada em Buffunfa (TASK-058). Vai como string, como todo valor inteiro do projeto (Q20).
 * A API recusa com 409 depois que as inscrições fecham, mesmo que a tela deixe o campo à vista.
 */
export const setEventEntryFee = (eventId: string, entryFee: bigint): Promise<EventDto> =>
  api(`/api/events/${eventId}/entry-fee`, { method: "PATCH", body: JSON.stringify({ entryFee: entryFee.toString() }) });

export const transferEventOwner = (eventId: string, ownerUserId: string): Promise<EventDto> =>
  api(`/api/events/${eventId}/owner`, { method: "POST", body: JSON.stringify({ ownerUserId }) });

export const joinEvent = (eventId: string, slotId: string): Promise<EventSignupDto> =>
  api(`/api/events/${eventId}/signups`, { method: "POST", body: JSON.stringify({ slotId }) });

export const leaveEvent = (eventId: string): Promise<EventSignupDto> => api(`/api/events/${eventId}/signups/me`, { method: "DELETE" });

/** Caller/owner move alguém entre role e espera (Q27). */
export const moveEventSignup = (eventId: string, userId: string, target: { target: "waitlist" } | { target: "role"; slotId: string }): Promise<EventSignupDto> =>
  api(`/api/events/${eventId}/signups/${userId}`, { method: "PATCH", body: JSON.stringify(target) });
