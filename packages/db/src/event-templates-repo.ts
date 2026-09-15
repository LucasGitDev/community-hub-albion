import type { EventRoleDto, EventRoleInput, EventRolePatch, EventTemplateDto, EventTemplateInput } from "@albion-hub/shared";
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { eventRoles, eventTemplateRoles, eventTemplates } from "./schema.js";

/** Código SQLSTATE do Postgres, atravessando o wrapper de erro do drizzle (`cause`). */
function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

export type EventRoleWriteResult = { ok: true; role: EventRoleDto } | { ok: false; reason: "not_found" | "duplicate" };
export type EventRoleDeleteResult = "deleted" | "not_found" | "in_use";

const roleColumns = {
  id: eventRoles.id,
  name: eventRoles.name,
  description: eventRoles.description,
  sortOrder: eventRoles.sortOrder,
  templateCount: sql<number>`(select count(*)::int from ${eventTemplateRoles} where ${eventTemplateRoles.roleId} = ${eventRoles.id})`,
};

/** Catálogo com quantos templates usam cada role (TASK-020). Ordem: sort_order, nome. */
export async function listEventRoles(db: Database): Promise<EventRoleDto[]> {
  return db.select(roleColumns).from(eventRoles).orderBy(asc(eventRoles.sortOrder), asc(eventRoles.name));
}

async function findEventRole(db: Database, id: string): Promise<EventRoleDto | null> {
  const [row] = await db.select(roleColumns).from(eventRoles).where(eq(eventRoles.id, id));
  return row ?? null;
}

/** Cria role no fim do catálogo. Nome repetido (sem diferenciar maiúsculas) → `duplicate`. */
export async function createEventRole(db: Database, input: EventRoleInput): Promise<EventRoleWriteResult> {
  try {
    const [row] = await db
      .insert(eventRoles)
      .values({ ...input, sortOrder: sql`(select coalesce(max(${eventRoles.sortOrder}), 0) + 10 from ${eventRoles})` })
      .returning({ id: eventRoles.id });
    return { ok: true, role: (await findEventRole(db, row!.id))! };
  } catch (error) {
    if (pgCode(error) === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function updateEventRole(db: Database, id: string, patch: EventRolePatch): Promise<EventRoleWriteResult> {
  try {
    const [row] = await db
      .update(eventRoles)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(eventRoles.id, id))
      .returning({ id: eventRoles.id });
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, role: (await findEventRole(db, id))! };
  } catch (error) {
    if (pgCode(error) === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/**
 * Apaga role fora de uso (AC#3). Checagem explícita dá a resposta amigável; a FK `restrict`
 * cobre a corrida com um template criado entre a checagem e o DELETE.
 */
export async function deleteEventRole(db: Database, id: string): Promise<EventRoleDeleteResult> {
  const [usage] = await db.select({ n: count() }).from(eventTemplateRoles).where(eq(eventTemplateRoles.roleId, id));
  if (usage && usage.n > 0) return "in_use";
  try {
    const deleted = await db.delete(eventRoles).where(eq(eventRoles.id, id)).returning({ id: eventRoles.id });
    return deleted.length > 0 ? "deleted" : "not_found";
  } catch (error) {
    if (pgCode(error) === FK_VIOLATION) return "in_use";
    throw error;
  }
}

export type EventTemplateWriteResult = { ok: true; template: EventTemplateDto } | { ok: false; reason: "not_found" | "duplicate" | "unknown_role" };

async function loadTemplates(db: Database, ids?: string[]): Promise<EventTemplateDto[]> {
  const base = db.select().from(eventTemplates);
  const templates = await (ids ? base.where(inArray(eventTemplates.id, ids)) : base).orderBy(asc(eventTemplates.name));
  if (templates.length === 0) return [];
  const roles = await db
    .select({ templateId: eventTemplateRoles.templateId, roleId: eventTemplateRoles.roleId, name: eventRoles.name, slots: eventTemplateRoles.slots })
    .from(eventTemplateRoles)
    .innerJoin(eventRoles, eq(eventRoles.id, eventTemplateRoles.roleId))
    .where(inArray(eventTemplateRoles.templateId, templates.map((t) => t.id)))
    .orderBy(asc(eventTemplateRoles.sortOrder));
  return templates.map((t) => {
    const own = roles.filter((r) => r.templateId === t.id).map(({ roleId, name, slots }) => ({ roleId, name, slots }));
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      minPartySize: t.minPartySize,
      maxPartySize: t.maxPartySize,
      active: t.active,
      roles: own,
      totalSlots: own.reduce((sum, r) => sum + r.slots, 0),
      updatedAt: t.updatedAt.toISOString(),
    };
  });
}

/** Templates com roles na ordem definida (TASK-020). Ordem: nome. */
export function listEventTemplates(db: Database): Promise<EventTemplateDto[]> {
  return loadTemplates(db);
}

export async function getEventTemplate(db: Database, id: string): Promise<EventTemplateDto | null> {
  return (await loadTemplates(db, [id]))[0] ?? null;
}

/**
 * Cria ou substitui (id) o template e suas roles numa transação. Entrada já validada por `eventTemplateInputSchema`.
 * Role inexistente → `unknown_role` (FK); nome repetido → `duplicate`.
 */
export async function saveEventTemplate(db: Database, input: EventTemplateInput, id?: string): Promise<EventTemplateWriteResult> {
  const { roles, ...fields } = input;
  try {
    const savedId = await db.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(eventTemplates).set({ ...fields, updatedAt: sql`now()` }).where(eq(eventTemplates.id, id)).returning({ id: eventTemplates.id })
        : await tx.insert(eventTemplates).values(fields).returning({ id: eventTemplates.id });
      if (!row) return null;
      await tx.delete(eventTemplateRoles).where(eq(eventTemplateRoles.templateId, row.id));
      await tx.insert(eventTemplateRoles).values(roles.map((r, i) => ({ templateId: row.id, roleId: r.roleId, slots: r.slots, sortOrder: i })));
      return row.id;
    });
    if (!savedId) return { ok: false, reason: "not_found" };
    return { ok: true, template: (await getEventTemplate(db, savedId))! };
  } catch (error) {
    const code = pgCode(error);
    if (code === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
    if (code === FK_VIOLATION) return { ok: false, reason: "unknown_role" };
    throw error;
  }
}

export async function deleteEventTemplate(db: Database, id: string): Promise<boolean> {
  const deleted = await db.delete(eventTemplates).where(eq(eventTemplates.id, id)).returning({ id: eventTemplates.id });
  return deleted.length > 0;
}
