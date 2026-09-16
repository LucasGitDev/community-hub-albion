import {
  canTransition,
  type EventDto,
  type EventListQuery,
  type EventOwnerChangeDto,
  type EventRoleSlotDto,
  type EventStatus,
} from "@albion-hub/shared";
import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "./client.js";
import { memberNick } from "./member-nick.js";
import { eventOwnerHistory, eventRoleSlots, eventSignups, eventTemplateRoles, eventTemplates, eventRoles as eventRolesCatalog, events, users } from "./schema.js";

/** `users` entra duas vezes na mesma consulta (owner do evento e, no futuro, quem transferiu): precisa de apelido. */
const owner = alias(users, "event_owner");

/** Coluna de carimbo que cada estado preenche ao ser alcançado (TASK-021, Q26). */
const STAMP: Record<EventStatus, "openedAt" | "closedAt" | "startedAt" | "finishedAt" | "cancelledAt" | "archivedAt" | null> = {
  draft: null,
  open: "openedAt",
  closed: "closedAt",
  running: "startedAt",
  finished: "finishedAt",
  cancelled: "cancelledAt",
  archived: "archivedAt",
};

export interface CreateEventInput {
  templateId: string;
  name: string;
  description: string | null;
  startsAt: Date | null;
  signupsCloseAt: Date | null;
  /** Quem vira owner (Q21) — normalmente o caller que criou. */
  ownerUserId: string;
  createdBy: string;
}

export type CreateEventResult = { ok: true; event: EventDto } | { ok: false; reason: "unknown_template" | "inactive_template" };
export type EventTransitionResult =
  | { ok: true; event: EventDto; from: EventStatus }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid"; from: EventStatus }
  /** Uma precondição de negócio recusou a transição; `message` é a frase PT-BR que o usuário lê. */
  | { ok: false; reason: "blocked"; from: EventStatus; message: string };
export type TransferEventOwnerResult = { ok: true; event: EventDto; from: string } | { ok: false; reason: "not_found" | "unknown_user" | "same_owner" | "terminal" };

/** Transação do drizzle, para quem precisa ler o banco dentro da mesma trava do evento. */
export type EventTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Regra de negócio consultada **dentro** da transação, depois do `for update` e depois da máquina de
 * estados: devolve a frase PT-BR que recusa a transição, ou `null` para deixar passar.
 *
 * Existe para o arquivamento (TASK-044, AC#4): arquivar exige que não haja loot split em rascunho.
 * Rodar aqui, com o evento travado, é o que impede a corrida "conferi que não havia split e, entre a
 * conferência e o update, alguém criou um". Os splits só nascem na F5 (TASK-027/028), então o default
 * do servidor é "não há split pendente" e a F5 pluga a consulta real sem tocar neste arquivo.
 */
export type EventTransitionPrecondition = (tx: EventTx, ctx: { eventId: string; from: EventStatus; to: EventStatus }) => Promise<string | null>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function loadEvents(db: Database, ids?: string[], filters: EventListQuery = {}): Promise<EventDto[]> {
  const where = [
    ...(ids ? [inArray(events.id, ids)] : []),
    ...(filters.status ? [inArray(events.status, filters.status)] : []),
    ...(filters.ownerUserId ? [eq(events.ownerUserId, filters.ownerUserId)] : []),
    ...(filters.templateId ? [eq(events.templateId, filters.templateId)] : []),
  ];
  const rows = await db
    .select({ event: events, templateName: eventTemplates.name, ownerNick: memberNick(owner) })
    .from(events)
    .leftJoin(eventTemplates, eq(eventTemplates.id, events.templateId))
    .leftJoin(owner, eq(owner.id, events.ownerUserId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(events.createdAt));
  if (rows.length === 0) return [];
  const slots = await db
    .select()
    .from(eventRoleSlots)
    .where(inArray(eventRoleSlots.eventId, rows.map((r) => r.event.id)))
    .orderBy(asc(eventRoleSlots.sortOrder));
  return rows.map(({ event: e, templateName, ownerNick }) => {
    const own: EventRoleSlotDto[] = slots.filter((s) => s.eventId === e.id).map(({ id, roleId, name, slots: n }) => ({ id, roleId, name, slots: n }));
    return {
      id: e.id,
      templateId: e.templateId,
      templateName,
      name: e.name,
      description: e.description,
      status: e.status,
      ownerUserId: e.ownerUserId,
      ownerNick,
      createdByUserId: e.createdBy,
      voiceChannelId: e.voiceChannelId,
      discordMessageId: e.discordMessageId,
      startsAt: iso(e.startsAt),
      signupsCloseAt: iso(e.signupsCloseAt),
      openedAt: iso(e.openedAt),
      closedAt: iso(e.closedAt),
      startedAt: iso(e.startedAt),
      finishedAt: iso(e.finishedAt),
      cancelledAt: iso(e.cancelledAt),
      archivedAt: iso(e.archivedAt),
      cancelReason: e.cancelReason,
      roles: own,
      totalSlots: own.reduce((sum, r) => sum + r.slots, 0),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  });
}

export async function getEvent(db: Database, id: string): Promise<EventDto | null> {
  return (await loadEvents(db, [id]))[0] ?? null;
}

/** Eventos mais recentes primeiro, com filtros opcionais de estado, owner e template. */
export function listEvents(db: Database, filters: EventListQuery = {}): Promise<EventDto[]> {
  return loadEvents(db, undefined, filters);
}

/**
 * Cria o evento em `draft` copiando roles e vagas do template (snapshot, AC#1) e grava a primeira
 * linha do histórico de owner. Template inativo é recusado: não dá para abrir evento de conteúdo aposentado.
 */
export async function createEvent(db: Database, input: CreateEventInput): Promise<CreateEventResult> {
  const { templateId, ownerUserId, createdBy, ...fields } = input;
  const created = await db.transaction(async (tx) => {
    const [template] = await tx.select({ active: eventTemplates.active }).from(eventTemplates).where(eq(eventTemplates.id, templateId));
    if (!template) return { ok: false as const, reason: "unknown_template" as const };
    if (!template.active) return { ok: false as const, reason: "inactive_template" as const };
    const templateRoles = await tx
      .select({ roleId: eventTemplateRoles.roleId, name: eventRolesCatalog.name, slots: eventTemplateRoles.slots })
      .from(eventTemplateRoles)
      .innerJoin(eventRolesCatalog, eq(eventRolesCatalog.id, eventTemplateRoles.roleId))
      .where(eq(eventTemplateRoles.templateId, templateId))
      .orderBy(asc(eventTemplateRoles.sortOrder));
    const [row] = await tx.insert(events).values({ ...fields, templateId, ownerUserId, createdBy }).returning({ id: events.id });
    const eventId = row!.id;
    if (templateRoles.length > 0)
      await tx.insert(eventRoleSlots).values(templateRoles.map((r, i) => ({ eventId, roleId: r.roleId, name: r.name, slots: r.slots, sortOrder: i })));
    await tx.insert(eventOwnerHistory).values({ eventId, fromUserId: null, toUserId: ownerUserId, changedBy: createdBy });
    return { ok: true as const, eventId };
  });
  if (!created.ok) return created;
  return { ok: true, event: (await getEvent(db, created.eventId))! };
}

export interface ApplyEventTransitionOptions {
  at?: Date;
  /** Só faz sentido em `cancelled` (TASK-025): o texto que o inscrito lê no embed e no painel. */
  reason?: string | null;
  /** Precondição de negócio avaliada dentro da transação, com o evento já travado (TASK-044, AC#4). */
  precondition?: EventTransitionPrecondition;
}

/**
 * Aplica uma transição validada pela máquina compartilhada, dentro de uma transação com `for update`:
 * dois cliques simultâneos em "iniciar" não geram dois starts — o segundo lê o estado já novo e cai em `invalid`.
 *
 * Cancelar (TASK-025, AC#1) cancela **na mesma transação** toda inscrição ativa (confirmada e em espera):
 * o evento nunca fica cancelado com gente ainda marcada como confirmada, nem por um instante. Fora dessa
 * transação, um erro no meio deixaria metade da lista viva num evento que não existe mais.
 */
export async function applyEventTransition(db: Database, id: string, to: EventStatus, options: ApplyEventTransitionOptions = {}): Promise<EventTransitionResult> {
  const at = options.at ?? new Date();
  const reason = to === "cancelled" ? (options.reason?.trim() || null) : null;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ status: events.status, closedAt: events.closedAt }).from(events).where(eq(events.id, id)).for("update");
    if (!current) return { ok: false as const, reason: "not_found" as const };
    const from = current.status;
    if (!canTransition(from, to)) return { ok: false as const, reason: "invalid" as const, from };
    const blocked = options.precondition ? await options.precondition(tx, { eventId: id, from, to }) : null;
    if (blocked) return { ok: false as const, reason: "blocked" as const, from, message: blocked };
    const stamp = STAMP[to];
    await tx
      .update(events)
      .set({
        status: to,
        updatedAt: at,
        ...(stamp ? { [stamp]: at } : {}),
        // Q26: o start fecha a inscrição, mesmo vindo direto de `open`.
        ...(to === "running" && !current.closedAt ? { closedAt: at } : {}),
        ...(to === "cancelled" ? { cancelReason: reason } : {}),
      })
      .where(eq(events.id, id));
    if (to === "cancelled")
      await tx
        .update(eventSignups)
        .set({ status: "cancelled", position: 0, updatedAt: at })
        .where(and(eq(eventSignups.eventId, id), inArray(eventSignups.status, ["confirmed", "waitlist"])));
    return { ok: true as const, from };
  });
  if (!result.ok) return result;
  return { ok: true, event: (await getEvent(db, id))!, from: result.from };
}

/**
 * Fecha a inscrição dos eventos `open` cujo `signups_close_at` já passou (AC#5). Idempotente: o próprio
 * filtro por estado faz a segunda passada não achar nada. Devolve os eventos fechados para quem quiser notificar.
 */
export async function closeDueEvents(db: Database, now: Date): Promise<EventDto[]> {
  const closed = await db
    .update(events)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(and(eq(events.status, "open"), isNotNull(events.signupsCloseAt), lte(events.signupsCloseAt, now)))
    .returning({ id: events.id });
  if (closed.length === 0) return [];
  return loadEvents(db, closed.map((e) => e.id));
}

/** Troca o owner (Q21, AC#4) gravando o histórico na mesma transação. Cancelado ou arquivado não troca de dono. */
export async function transferEventOwner(db: Database, eventId: string, toUserId: string, changedBy: string): Promise<TransferEventOwnerResult> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ ownerUserId: events.ownerUserId, status: events.status }).from(events).where(eq(events.id, eventId)).for("update");
    if (!current) return { ok: false as const, reason: "not_found" as const };
    // `finished` ficou de fora (TASK-044): a taxa e as sobras vão para o owner, e o acerto acontece
    // depois do jogo — trocar o dono errado precisa continuar possível até o evento ser arquivado.
    if (current.status === "cancelled" || current.status === "archived") return { ok: false as const, reason: "terminal" as const };
    if (current.ownerUserId === toUserId) return { ok: false as const, reason: "same_owner" as const };
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, toUserId));
    if (!target) return { ok: false as const, reason: "unknown_user" as const };
    const now = new Date();
    await tx.update(events).set({ ownerUserId: toUserId, updatedAt: now }).where(eq(events.id, eventId));
    await tx.insert(eventOwnerHistory).values({ eventId, fromUserId: current.ownerUserId, toUserId, changedBy, changedAt: now });
    return { ok: true as const, from: current.ownerUserId };
  });
  if (!result.ok) return result;
  return { ok: true, event: (await getEvent(db, eventId))!, from: result.from };
}

/** Histórico de owners em ordem cronológica; a primeira linha é a criação (from null). */
export async function listEventOwnerHistory(db: Database, eventId: string): Promise<EventOwnerChangeDto[]> {
  const rows = await db.select().from(eventOwnerHistory).where(eq(eventOwnerHistory.eventId, eventId)).orderBy(asc(eventOwnerHistory.changedAt));
  return rows.map((r) => ({ fromUserId: r.fromUserId, toUserId: r.toUserId, changedByUserId: r.changedBy, changedAt: r.changedAt.toISOString() }));
}

/**
 * Guarda (ou limpa) o canal de voz do evento (TASK-024, Q28). Escrita fora da transição de estado de
 * propósito: o canal é efeito colateral no Discord, então falhar aqui nunca desfaz o start já gravado.
 */
export async function setEventVoiceChannelId(db: Database, eventId: string, channelId: string | null): Promise<void> {
  await db.update(events).set({ voiceChannelId: channelId }).where(eq(events.id, eventId));
}

/** Guarda a mensagem do embed de inscrição no canal de eventos (TASK-022). */
export async function setEventDiscordMessageId(db: Database, eventId: string, messageId: string | null): Promise<void> {
  await db.update(events).set({ discordMessageId: messageId }).where(eq(events.id, eventId));
}
