import type { EventCreateInput, EventDto, EventMemberDto, EventSignupDto, EventStatus, EventTransition } from "@albion-hub/shared";
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

export const transitionEvent = (eventId: string, transition: EventTransition): Promise<EventDto> =>
  api(`/api/events/${eventId}/transitions/${transition}`, { method: "POST" });

export const transferEventOwner = (eventId: string, ownerUserId: string): Promise<EventDto> =>
  api(`/api/events/${eventId}/owner`, { method: "POST", body: JSON.stringify({ ownerUserId }) });

export const joinEvent = (eventId: string, slotId: string): Promise<EventSignupDto> =>
  api(`/api/events/${eventId}/signups`, { method: "POST", body: JSON.stringify({ slotId }) });

export const leaveEvent = (eventId: string): Promise<EventSignupDto> => api(`/api/events/${eventId}/signups/me`, { method: "DELETE" });

/** Caller/owner move alguém entre role e espera (Q27). */
export const moveEventSignup = (eventId: string, userId: string, target: { target: "waitlist" } | { target: "role"; slotId: string }): Promise<EventSignupDto> =>
  api(`/api/events/${eventId}/signups/${userId}`, { method: "PATCH", body: JSON.stringify(target) });
