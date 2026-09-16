import { z } from "zod";
import { EVENT_TEMPLATE_DESCRIPTION_MAX, EVENT_TEMPLATE_NAME_MAX, firstIssue } from "./event-templates.js";
import type { Action } from "./permissions.js";

/**
 * Evento e sua máquina de estados (TASK-021, Q26). Máquina pura: mesma fonte para API, bot e painel.
 *
 * Fluxo: `draft → open → closed → running → finished`, com `cancelled` alcançável de qualquer
 * estado antes de `finished`. Duas arestas merecem nota:
 * - `open → running` existe porque Q26 diz que o start fecha a inscrição: quem clica em iniciar
 *   com o evento aberto não precisa fechar antes (o repo grava `closed_at` junto).
 * - não há volta (`closed → open`, `running → open`...): reabrir inscrição não está em nenhuma Q
 *   da v1 e reabrir depois do start bagunçaria a janela de presença (Q6). Fica para quando houver pedido.
 */
export const EVENT_STATUSES = ["draft", "open", "closed", "running", "finished", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Estados terminais: nada sai deles. */
export const TERMINAL_EVENT_STATUSES: readonly EventStatus[] = ["finished", "cancelled"];

/** Única fonte de verdade das arestas. Tudo que não está aqui é inválido. */
export const ALLOWED_EVENT_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  draft: ["open", "cancelled"],
  open: ["closed", "running", "cancelled"],
  closed: ["running", "cancelled"],
  running: ["finished", "cancelled"],
  finished: [],
  cancelled: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED_EVENT_TRANSITIONS[from].includes(to);
}

/** Estados a partir dos quais o evento ainda pode ser cancelado (Q26: qualquer um antes de finished). */
export function canCancel(from: EventStatus): boolean {
  return canTransition(from, "cancelled");
}

/** Ações expostas na API/bot; cada uma leva a um estado. */
export const EVENT_TRANSITIONS = {
  open: "open",
  close: "closed",
  start: "running",
  finish: "finished",
  cancel: "cancelled",
} as const satisfies Record<string, EventStatus>;

export type EventTransition = keyof typeof EVENT_TRANSITIONS;

/**
 * Permissão exigida por cada transição (Q13): abrir e fechar inscrição é edição do evento; start,
 * finish e cancel têm ação própria. A API decide com isso e o painel esconde o botão com o mesmo mapa,
 * então um botão visível é sempre um botão que a API aceita.
 */
export const EVENT_TRANSITION_ACTIONS: Readonly<Record<EventTransition, Action>> = {
  open: "update",
  close: "update",
  start: "start",
  finish: "finish",
  cancel: "cancel",
};
export const EVENT_TRANSITION_NAMES = Object.keys(EVENT_TRANSITIONS) as EventTransition[];

export function isEventTransition(value: string): value is EventTransition {
  return Object.hasOwn(EVENT_TRANSITIONS, value);
}

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "rascunho",
  open: "com inscrições abertas",
  closed: "com inscrições fechadas",
  running: "em andamento",
  finished: "finalizado",
  cancelled: "cancelado",
};

export const eventStatusLabel = (status: EventStatus) => STATUS_LABELS[status];

/** Mensagem PT-BR do 409: diz o estado atual e o que dá para fazer agora. */
export function transitionError(from: EventStatus, to: EventStatus): string {
  const next = ALLOWED_EVENT_TRANSITIONS[from];
  const base = `O evento está ${STATUS_LABELS[from]} e não pode ir para ${STATUS_LABELS[to]}.`;
  if (next.length === 0) return `${base} Esse é um estado final.`;
  return `${base} Daqui só dá para ir para: ${next.map((s) => STATUS_LABELS[s]).join(", ")}.`;
}

const uuid = (label: string) => z.uuid(`${label} inválido.`);

/** ISO 8601 vindo do JSON; vazio/ausente vira null. */
const optionalInstant = (label: string) =>
  z
    .iso.datetime({ offset: true, message: `${label} precisa ser uma data e hora válidas.` })
    .nullish()
    .transform((v) => (v ? new Date(v) : null));

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `Digite ${label}.` })
    .trim()
    .min(1, `Digite ${label}.`)
    .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} tem no máximo ${max} caracteres.`);

const optionalDescription = z
  .string()
  .trim()
  .max(EVENT_TEMPLATE_DESCRIPTION_MAX, `A descrição tem no máximo ${EVENT_TEMPLATE_DESCRIPTION_MAX} caracteres.`)
  .nullish()
  .transform((v) => (v ? v : null));

export const eventCreateSchema = z
  .object({
    templateId: uuid("Template"),
    name: requiredText("o nome do evento", EVENT_TEMPLATE_NAME_MAX),
    description: optionalDescription,
    /** Horário previsto de início; null = sem horário marcado (start manual). */
    startsAt: optionalInstant("O horário de início"),
    /** Fechamento automático da inscrição (AC#5); null = só fecha na mão ou no start. */
    signupsCloseAt: optionalInstant("O fechamento das inscrições"),
  })
  .superRefine((e, ctx) => {
    if (e.startsAt && e.signupsCloseAt && e.signupsCloseAt > e.startsAt)
      ctx.addIssue({ code: "custom", path: ["signupsCloseAt"], message: "As inscrições precisam fechar até o início do evento." });
  });
export type EventCreateInput = z.output<typeof eventCreateSchema>;

export const eventTransferOwnerSchema = z.object({ ownerUserId: uuid("Novo owner") });
export type EventTransferOwnerInput = z.output<typeof eventTransferOwnerSchema>;

export const eventListQuerySchema = z.object({
  status: z.array(z.enum(EVENT_STATUSES)).nonempty().optional(),
  ownerUserId: uuid("Owner").optional(),
  templateId: uuid("Template").optional(),
});
export type EventListQuery = z.output<typeof eventListQuerySchema>;

/** Query string (`?status=open&status=closed`) → filtros; valor desconhecido vira 400. */
export function parseEventListQuery(query: Record<string, unknown>): { ok: true; filters: EventListQuery } | { ok: false; error: string } {
  const raw = query.status;
  const status = raw === undefined ? undefined : Array.isArray(raw) ? raw : [raw];
  const parsed = eventListQuerySchema.safeParse({ ...query, status });
  return parsed.success ? { ok: true, filters: parsed.data } : { ok: false, error: firstIssue(parsed.error) };
}

/** Vaga de role copiada do template no momento da criação (não muda se o template for editado depois). */
export interface EventRoleSlotDto {
  /** Id da vaga no evento (`event_role_slots.id`): é ele que o botão de inscrição carrega (TASK-022). */
  id: string;
  roleId: string | null;
  name: string;
  slots: number;
}

export interface EventDto {
  id: string;
  templateId: string;
  templateName: string | null;
  name: string;
  description: string | null;
  status: EventStatus;
  ownerUserId: string;
  /** Nick de quem manda no evento, pronto pro painel não ter que buscar usuário por id (TASK-023). */
  ownerNick: string | null;
  createdByUserId: string | null;
  voiceChannelId: string | null;
  /** Mensagem do embed de inscrição no Discord (TASK-022); null enquanto o evento não foi publicado. */
  discordMessageId: string | null;
  startsAt: string | null;
  signupsCloseAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  roles: EventRoleSlotDto[];
  totalSlots: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventOwnerChangeDto {
  fromUserId: string | null;
  toUserId: string;
  changedByUserId: string | null;
  changedAt: string;
}
