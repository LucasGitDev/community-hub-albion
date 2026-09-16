import {
  ALLOWED_EVENT_TRANSITIONS,
  EVENT_TRANSITIONS,
  EVENT_TRANSITION_ACTIONS,
  freeSlots,
  type AppAbility,
  type EventDto,
  type EventMemberDto,
  type EventOccupancyDto,
  type EventSignupDto,
  type EventStatus,
  type EventTransition,
} from "@albion-hub/shared";
import { asSubject } from "@albion-hub/shared";

/**
 * Regras do painel de eventos (TASK-023). Tudo aqui é função pura: a tela só desenha o resultado,
 * e o teste cobre a regra sem precisar de navegador.
 */

/** O que a listagem devolve numa chamada só (o endpoint que o polling repete). */
export interface EventBoard {
  events: EventDto[];
  occupancy: EventOccupancyDto[];
  mySignups: EventSignupDto[];
}

/**
 * Faixas da tela do membro, na ordem em que interessam a quem chega: o que está rolando agora, o que
 * dá pra entrar agora, o que vem depois e, por último, o histórico.
 */
export type EventGroup = "running" | "open" | "upcoming" | "done";

const GROUP_OF: Record<EventStatus, EventGroup> = {
  running: "running",
  open: "open",
  draft: "upcoming",
  closed: "upcoming",
  finished: "done",
  cancelled: "done",
};

const eventGroup = (status: EventStatus): EventGroup => GROUP_OF[status];

/** Agrupa mantendo a ordem de entrada dentro de cada faixa (a API já manda do mais novo pro mais velho). */
export function groupEvents(events: readonly EventDto[]): Record<EventGroup, EventDto[]> {
  const groups = { running: [], open: [], upcoming: [], done: [] } as Record<EventGroup, EventDto[]>;
  for (const event of events) groups[eventGroup(event.status)].push(event);
  return groups;
}

/** Minha inscrição ativa num evento (só existe uma por evento, garantida pelo banco). */
export const mySignupFor = (eventId: string, mine: readonly EventSignupDto[]): EventSignupDto | null =>
  mine.find((s) => s.eventId === eventId && s.status !== "cancelled") ?? null;

/** Uma role do evento pronta pra desenhar: vagas, espera e onde eu estou. */
export interface RoleView {
  slotId: string;
  name: string;
  slots: number;
  confirmed: number;
  waitlist: number;
  free: number;
  full: boolean;
  /** `confirmed` ou `waitlist` quando a minha inscrição é nesta role. */
  mine: "confirmed" | "waitlist" | null;
  /** Minha posição na espera desta role (0 quando não estou esperando). */
  myPosition: number;
}

export function roleViews(event: EventDto, occupancy: readonly EventOccupancyDto[], mine: EventSignupDto | null): RoleView[] {
  return event.roles.map((role) => {
    const count = occupancy.find((o) => o.eventId === event.id && o.slotId === role.id);
    const confirmed = count?.confirmed ?? 0;
    const isMine = mine?.slotId === role.id && mine.status !== "cancelled";
    return {
      slotId: role.id,
      name: role.name,
      slots: role.slots,
      confirmed,
      waitlist: count?.waitlist ?? 0,
      free: freeSlots({ slots: role.slots, confirmed }),
      full: freeSlots({ slots: role.slots, confirmed }) === 0,
      mine: isMine ? (mine.status as "confirmed" | "waitlist") : null,
      myPosition: isMine && mine.status === "waitlist" ? mine.position : 0,
    };
  });
}

/** Quanto do evento já encheu: o número que faz a pessoa querer entrar antes de lotar. */
export function eventFill(roles: readonly RoleView[]): { confirmed: number; total: number; percent: number; waitlist: number } {
  const total = roles.reduce((sum, r) => sum + r.slots, 0);
  const confirmed = roles.reduce((sum, r) => sum + Math.min(r.confirmed, r.slots), 0);
  return { confirmed, total, waitlist: roles.reduce((sum, r) => sum + r.waitlist, 0), percent: total === 0 ? 0 : Math.round((confirmed / total) * 100) };
}

/** Frase da minha situação no evento, do jeito que se fala: "Tank, confirmado" / "Healer, 2º na espera". */
export function mySignupLabel(signup: EventSignupDto | null): string | null {
  if (!signup || signup.status === "cancelled") return null;
  return signup.status === "confirmed" ? `${signup.roleName}, confirmado` : `${signup.roleName}, ${signup.position}º na espera`;
}

/** Entrar e sair é só com a inscrição aberta (Q26): fora disso o botão nem aparece. */
export const canJoinEvent = (event: EventDto): boolean => event.status === "open";

/**
 * Ações de estado que cabem agora (AC#3): precisa ser uma aresta da máquina (Q26) **e** o papel de
 * quem olha precisa permitir naquele evento (owner ou staff, Q9/Q21). A API refaz a mesma checagem.
 */
export function availableTransitions(event: EventDto, ability: AppAbility): EventTransition[] {
  const subject = asSubject("Event", { ownerId: event.ownerUserId });
  return (Object.keys(EVENT_TRANSITIONS) as EventTransition[]).filter(
    (t) => ALLOWED_EVENT_TRANSITIONS[event.status].includes(EVENT_TRANSITIONS[t]) && ability.can(EVENT_TRANSITION_ACTIONS[t], subject),
  );
}

/** Mexer na lista de inscritos é `update Event`: owner do evento ou staff, e só antes do evento rodar. */
export const canManageRoster = (event: EventDto, ability: AppAbility): boolean =>
  (event.status === "open" || event.status === "closed") && ability.can("update", asSubject("Event", { ownerId: event.ownerUserId }));

/** Trocar o dono é `manage Event`: só staff (Q21). */
export const canTransferOwner = (event: EventDto, ability: AppAbility): boolean =>
  !["finished", "cancelled"].includes(event.status) && ability.can("manage", asSubject("Event", { ownerId: event.ownerUserId }));

export const nickOf = (userId: string, members: readonly EventMemberDto[]): string => members.find((m) => m.userId === userId)?.nick ?? "Membro";

/** Intervalo do polling (doc-002: v1 sem realtime). 10s é rápido o bastante pra uma chamada de evento. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * Quanto esperar até a próxima atualização. Aba escondida não agenda nada (`null`): ninguém está
 * olhando e o servidor agradece. Erro seguido aumenta o intervalo até 1 min, pra não martelar uma API
 * que já está com problema.
 */
export function nextPollDelay(options: { visible: boolean; failures?: number }): number | null {
  if (!options.visible) return null;
  const failures = options.failures ?? 0;
  return Math.min(POLL_INTERVAL_MS * 2 ** failures, 60_000);
}
