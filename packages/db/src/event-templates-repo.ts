import type { EventRoleDto, EventRoleInput, EventRolePatch, EventTemplateDto, EventTemplateInput, EventTemplateYaml } from "@albion-hub/shared";
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

/** Qual índice único estourou: import distingue nome de template repetido de corrida na criação de role. */
function pgConstraint(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint_name?: unknown; constraint?: unknown }).constraint_name ?? (e as { constraint?: unknown }).constraint;
    if (typeof name === "string") return name;
  }
  return undefined;
}
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
    .select({
      templateId: eventTemplateRoles.templateId,
      roleId: eventTemplateRoles.roleId,
      name: eventRoles.name,
      description: eventRoles.description,
      slots: eventTemplateRoles.slots,
      buffunfaMin: eventTemplateRoles.buffunfaMin,
      buffunfaMax: eventTemplateRoles.buffunfaMax,
    })
    .from(eventTemplateRoles)
    .innerJoin(eventRoles, eq(eventRoles.id, eventTemplateRoles.roleId))
    .where(inArray(eventTemplateRoles.templateId, templates.map((t) => t.id)))
    .orderBy(asc(eventTemplateRoles.sortOrder));
  return templates.map((t) => {
    const own = roles.filter((r) => r.templateId === t.id).map(({ roleId, name, description, slots, buffunfaMin, buffunfaMax }) => ({
      roleId,
      name,
      description,
      slots,
      buffunfaMin: buffunfaMin.toString(),
      buffunfaMax: buffunfaMax.toString(),
    }));
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      minPartySize: t.minPartySize,
      maxPartySize: t.maxPartySize,
      active: t.active,
      defaultEntryFee: t.defaultEntryFee.toString(),
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
export async function saveEventTemplate(
  db: Database,
  /** `defaultEntryFee` é opcional aqui: omitir é o mesmo que zero, porque **template nasce zerado** (TASK-058). */
  input: Omit<EventTemplateInput, "defaultEntryFee"> & { defaultEntryFee?: bigint },
  id?: string,
): Promise<EventTemplateWriteResult> {
  const { roles, defaultEntryFee = 0n, ...rest } = input;
  const fields = { ...rest, defaultEntryFee };
  try {
    const savedId = await db.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(eventTemplates).set({ ...fields, updatedAt: sql`now()` }).where(eq(eventTemplates.id, id)).returning({ id: eventTemplates.id })
        : await tx.insert(eventTemplates).values(fields).returning({ id: eventTemplates.id });
      if (!row) return null;
      await tx.delete(eventTemplateRoles).where(eq(eventTemplateRoles.templateId, row.id));
      await tx.insert(eventTemplateRoles).values(roles.map((r, i) => ({ templateId: row.id, roleId: r.roleId, slots: r.slots, sortOrder: i, buffunfaMin: r.buffunfaMin, buffunfaMax: r.buffunfaMax })));
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

export type EventTemplateImportDbResult = { ok: true; template: EventTemplateDto; createdRoles: string[]; ignoredDescriptions: string[] } | { ok: false; reason: "duplicate" | "role_race" };

/**
 * Importa um template vindo de YAML (TASK-038, AC#2/AC#4) numa transação só: ou entra template,
 * vagas e roles novas, ou não entra nada.
 *
 * Roles são casadas pelo nome sem diferenciar maiúsculas (mesma regra do índice único do catálogo) e
 * as que faltam são **criadas** — o arquivo existe pra levar template de um servidor pro outro, e um
 * servidor novo não tem o catálogo do antigo. Os nomes criados voltam pra tela avisar a staff.
 * Nome de template repetido → `duplicate` (a API devolve 409): renomear é decisão da staff, não do sistema.
 *
 * Descrição de role (TASK-065): no arquivo YAML ela é escrita por template, mas no banco o catálogo
 * `event_roles` guarda **uma** descrição global por role — não há coluna por par (template, role), e
 * a decisão de criar uma está congelada na TASK-064. Enquanto isso o import é **defensivo**:
 * - role que ainda não existe nasce com a descrição do arquivo (é o único texto disponível);
 * - role que existe **sem** descrição é preenchida com a do arquivo (não há dado a perder);
 * - role que existe **com** descrição diferente é deixada como está, e o nome volta em
 *   `ignoredDescriptions` para a tela dizer o que foi ignorado. Sobrescrever calado tiraria a
 *   descrição de "Tank" de todos os outros templates por causa de um import de ZvZ.
 */
export async function importEventTemplate(db: Database, input: EventTemplateYaml): Promise<EventTemplateImportDbResult> {
  try {
    const saved = await db.transaction(async (tx) => {
      const [template] = await tx
        .insert(eventTemplates)
        .values({ name: input.name, description: input.description, minPartySize: input.minParty, maxPartySize: input.maxParty, active: input.active })
        .returning({ id: eventTemplates.id });

      const wanted = input.roles.map((r) => ({ ...r, key: r.name.toLowerCase() }));
      const existing = await tx
        .select({ id: eventRoles.id, key: sql<string>`lower(${eventRoles.name})`, description: eventRoles.description })
        .from(eventRoles)
        .where(inArray(sql`lower(${eventRoles.name})`, wanted.map((r) => r.key)));
      const byKey = new Map(existing.map((r) => [r.key, r.id]));
      const descriptionByKey = new Map(existing.map((r) => [r.key, r.description?.trim() ?? ""]));

      const missing = wanted.filter((r) => !byKey.has(r.key));
      if (missing.length > 0) {
        const created = await tx
          .insert(eventRoles)
          .values(missing.map((r, i) => ({ name: r.name, description: r.description, sortOrder: sql<number>`(select coalesce(max(${eventRoles.sortOrder}), 0) from ${eventRoles}) + ${10 * (i + 1)}` })))
          .returning({ id: eventRoles.id, name: eventRoles.name });
        for (const role of created) byKey.set(role.name.toLowerCase(), role.id);
      }

      // Só as roles que já estavam no catálogo entram nesta conta: as criadas acima já nasceram com o texto do arquivo.
      const ignoredDescriptions: string[] = [];
      for (const role of wanted) {
        const fileDescription = role.description?.trim() ?? "";
        if (!fileDescription || !descriptionByKey.has(role.key)) continue;
        const catalogDescription = descriptionByKey.get(role.key)!;
        if (catalogDescription === fileDescription) continue;
        if (catalogDescription) {
          ignoredDescriptions.push(role.name);
          continue;
        }
        // Catálogo vazio: preencher não apaga nada de ninguém.
        await tx.update(eventRoles).set({ description: fileDescription }).where(eq(eventRoles.id, byKey.get(role.key)!));
        descriptionByKey.set(role.key, fileDescription);
      }

      await tx.insert(eventTemplateRoles).values(wanted.map((r, i) => ({ templateId: template!.id, roleId: byKey.get(r.key)!, slots: r.slots, sortOrder: i, buffunfaMin: r.buffunfaMin, buffunfaMax: r.buffunfaMax })));
      return { id: template!.id, createdRoles: missing.map((r) => r.name), ignoredDescriptions };
    });
    return { ok: true, template: (await getEventTemplate(db, saved.id))!, createdRoles: saved.createdRoles, ignoredDescriptions: saved.ignoredDescriptions };
  } catch (error) {
    if (pgCode(error) === UNIQUE_VIOLATION) return { ok: false, reason: pgConstraint(error) === "event_roles_name_lower_idx" ? "role_race" : "duplicate" };
    throw error;
  }
}

export async function deleteEventTemplate(db: Database, id: string): Promise<boolean> {
  const deleted = await db.delete(eventTemplates).where(eq(eventTemplates.id, id)).returning({ id: eventTemplates.id });
  return deleted.length > 0;
}
