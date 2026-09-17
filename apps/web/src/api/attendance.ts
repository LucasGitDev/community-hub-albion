import type { EventAttendanceDto } from "@albion-hub/shared";
import { api } from "./http";

/**
 * Buffunfa por participação em evento (TASK-057) contra a API do fechamento. Valor sempre como
 * string no corpo, igual à prata (Q20): quem lê o JSON nunca vê um número que perdeu precisão.
 */

/** Prévia antes do fechamento, recibo depois dele. */
export const fetchEventAttendance = (eventId: string): Promise<EventAttendanceDto> => api(`/api/events/${eventId}/attendance`);

/** Sobe ou desce o valor de uma role; devolve a prévia recalculada. */
export const setRoleBuffunfa = (eventId: string, slotId: string, value: bigint): Promise<EventAttendanceDto> =>
  api(`/api/events/${eventId}/attendance/roles/${slotId}`, { method: "PATCH", body: JSON.stringify({ value: value.toString() }) });

/** Mesmo valor para **todas** as roles do evento (TASK-072); devolve a prévia recalculada. */
export const setAllRolesBuffunfa = (eventId: string, value: bigint): Promise<EventAttendanceDto> =>
  api(`/api/events/${eventId}/attendance/roles`, { method: "PATCH", body: JSON.stringify({ value: value.toString() }) });

/** Fechamento: cria os lançamentos de quem bateu os 90%. Idempotente do lado do servidor. */
export const payEventAttendance = (eventId: string): Promise<EventAttendanceDto> =>
  api(`/api/events/${eventId}/attendance/payout`, { method: "POST", body: JSON.stringify({}) });
