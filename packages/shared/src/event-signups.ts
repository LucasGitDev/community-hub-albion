import { z } from "zod";

/**
 * Inscrição em evento por role, com lista de espera (TASK-022, Q27).
 *
 * Regras (fonte única para API, bot e painel):
 * - Uma inscrição ativa por pessoa por evento: trocar de role cancela a anterior e cria outra.
 * - Role lotada não recusa: a pessoa entra na espera **daquela role** (a espera é por role, não do evento).
 * - Quando um confirmado libera a vaga (sai, troca de role ou é mandado para a espera pelo caller),
 *   o primeiro da espera daquela role vira confirmado automaticamente.
 * - Só evento `open` aceita entrada/saída pelo membro (Q26): depois de fechado a lista está congelada e
 *   quem mexe é o caller/owner (AC#4).
 */

export const EVENT_SIGNUP_STATUSES = ["confirmed", "waitlist", "cancelled"] as const;
export type EventSignupStatus = (typeof EVENT_SIGNUP_STATUSES)[number];

/** Estados que ocupam lugar na lista (só pode haver um por pessoa por evento). */
export const ACTIVE_EVENT_SIGNUP_STATUSES: readonly EventSignupStatus[] = ["confirmed", "waitlist"];

export const isActiveEventSignup = (status: EventSignupStatus): boolean => ACTIVE_EVENT_SIGNUP_STATUSES.includes(status);

export interface EventSignupDto {
  id: string;
  eventId: string;
  userId: string;
  /** Vaga do evento (`event_role_slots.id`); o nome vai junto porque a role do catálogo pode sumir. */
  slotId: string;
  roleName: string;
  status: EventSignupStatus;
  /** Ordem na espera daquela role (1, 2, 3...). 0 para confirmado. */
  position: number;
  /** Quem moveu, quando foi o caller/owner (AC#4). Null quando a própria pessoa se inscreveu. */
  decidedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Contagem de uma role do evento para montar botão e embed. */
export interface RoleOccupancy {
  slotId: string;
  name: string;
  slots: number;
  confirmed: number;
  waitlist: number;
}

/** Vagas livres nunca é negativo (staff pode ter deixado a role acima do limite antes de um corte de vagas). */
export const freeSlots = (occupancy: Pick<RoleOccupancy, "slots" | "confirmed">): number => Math.max(0, occupancy.slots - occupancy.confirmed);

export const isRoleFull = (occupancy: Pick<RoleOccupancy, "slots" | "confirmed">): boolean => freeSlots(occupancy) === 0;

/** Rótulo do botão: "Tank (1/3)" = uma vaga livre de três. Discord corta em 80 caracteres. */
export const roleButtonLabel = (occupancy: Pick<RoleOccupancy, "name" | "slots" | "confirmed">): string =>
  `${occupancy.name} (${freeSlots(occupancy)}/${occupancy.slots})`.slice(0, 80);

/**
 * Cruza as vagas do evento com as inscrições ativas. Ignora canceladas e inscrição em vaga que não
 * existe mais (role apagada do evento): o embed mostra só o que ainda dá para clicar.
 */
export function occupancyByRole(
  roles: readonly { id: string; name: string; slots: number }[],
  signups: readonly Pick<EventSignupDto, "slotId" | "status">[],
): RoleOccupancy[] {
  return roles.map((role) => ({
    slotId: role.id,
    name: role.name,
    slots: role.slots,
    confirmed: signups.filter((s) => s.slotId === role.id && s.status === "confirmed").length,
    waitlist: signups.filter((s) => s.slotId === role.id && s.status === "waitlist").length,
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id vindo do cliente Discord ou da URL: só uuid chega ao banco. */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/**
 * custom ids dos botões (TASK-022). Carregam só o alvo (vaga ou evento) — **nunca** identidade:
 * quem clicou vem sempre de `interaction.user.id`, então um custom id forjado não vira inscrição de terceiro.
 * Um parâmetro só por padrão, para o matcher do Necord não ter que desmontar caminho composto.
 */
export const EVENT_JOIN_BUTTON = "evento/inscrever/:slotId";
export const EVENT_LEAVE_BUTTON = "evento/sair/:eventId";

export const eventJoinButtonId = (slotId: string): string => EVENT_JOIN_BUTTON.replace(":slotId", slotId);
export const eventLeaveButtonId = (eventId: string): string => EVENT_LEAVE_BUTTON.replace(":eventId", eventId);

/** Máximo de botões de role no embed: 5 linhas x 5 botões, menos o "Sair". */
export const MAX_EVENT_ROLE_BUTTONS = 24;

export const eventJoinSchema = z.object({ slotId: z.uuid("Role inválida.") });
export type EventJoinInput = z.output<typeof eventJoinSchema>;

/** Movimentação pelo caller/owner (AC#4): manda para uma role ou para a espera. */
export const eventSignupMoveSchema = z.union([
  z.object({ target: z.literal("waitlist") }),
  z.object({ target: z.literal("role"), slotId: z.uuid("Role inválida.") }),
]);
export type EventSignupMoveInput = z.output<typeof eventSignupMoveSchema>;
