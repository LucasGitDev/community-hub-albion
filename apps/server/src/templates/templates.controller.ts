import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import {
  createEventRole,
  deleteEventRole,
  deleteEventTemplate,
  getEventTemplate,
  listEventRoles,
  listEventTemplates,
  saveEventTemplate,
  updateEventRole,
  type DbHandle,
  type EventRoleWriteResult,
  type EventTemplateWriteResult,
} from "@albion-hub/db";
import {
  eventRoleInputSchema,
  eventRolePatchSchema,
  eventTemplateInputSchema,
  eventTemplatePatchSchema,
  firstIssue,
  type EventRoleDto,
  type EventTemplateDto,
} from "@albion-hub/shared";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { DB_HANDLE } from "../db/db.module.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string, label: string): string {
  if (!UUID.test(id)) throw new BadRequestException(`${label} inválido.`);
  return id;
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
  return parsed.data;
}

function roleOrThrow(result: EventRoleWriteResult): EventRoleDto {
  if (result.ok) return result.role;
  if (result.reason === "not_found") throw new NotFoundException("Role não encontrada.");
  throw new ConflictException("Já existe uma role com esse nome.");
}

function templateOrThrow(result: EventTemplateWriteResult): EventTemplateDto {
  if (result.ok) return result.template;
  if (result.reason === "not_found") throw new NotFoundException("Template não encontrado.");
  if (result.reason === "unknown_role") throw new BadRequestException("Uma das roles não existe mais. Atualize a página e escolha de novo.");
  throw new ConflictException("Já existe um template com esse nome.");
}

/** Catálogo global de roles (TASK-020, Q8). Leitura: caller e staff; escrita: staff. */
@Controller("event-roles")
export class EventRolesController {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  @Get()
  @Authorize("read", "EventTemplate")
  async list(@Res({ passthrough: true }) res: Response): Promise<{ roles: EventRoleDto[] }> {
    res.setHeader("Cache-Control", "no-store");
    return { roles: await listEventRoles(this.handle.db) };
  }

  @Post()
  @UseGuards(SameOriginGuard)
  @Authorize("create", "EventTemplate")
  async create(@Body() body: unknown): Promise<EventRoleDto> {
    return roleOrThrow(await createEventRole(this.handle.db, parseBody(eventRoleInputSchema, body)));
  }

  @Patch(":id")
  @UseGuards(SameOriginGuard)
  @Authorize("update", "EventTemplate")
  async update(@Param("id") id: string, @Body() body: unknown): Promise<EventRoleDto> {
    const roleId = parseId(id, "Id da role");
    return roleOrThrow(await updateEventRole(this.handle.db, roleId, parseBody(eventRolePatchSchema, body)));
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  @Authorize("delete", "EventTemplate")
  async remove(@Param("id") id: string): Promise<void> {
    const result = await deleteEventRole(this.handle.db, parseId(id, "Id da role"));
    if (result === "not_found") throw new NotFoundException("Role não encontrada.");
    if (result === "in_use") throw new ConflictException("Essa role está em uso por um template. Tire ela dos templates antes de apagar.");
  }
}

/** Templates de evento com roles e vagas (TASK-020, Q8). Leitura: caller e staff; escrita: staff. */
@Controller("event-templates")
export class EventTemplatesController {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  @Get()
  @Authorize("read", "EventTemplate")
  async list(@Res({ passthrough: true }) res: Response): Promise<{ templates: EventTemplateDto[] }> {
    res.setHeader("Cache-Control", "no-store");
    return { templates: await listEventTemplates(this.handle.db) };
  }

  @Post()
  @UseGuards(SameOriginGuard)
  @Authorize("create", "EventTemplate")
  async create(@Body() body: unknown): Promise<EventTemplateDto> {
    return templateOrThrow(await saveEventTemplate(this.handle.db, parseBody(eventTemplateInputSchema, body)));
  }

  /** Parcial: junta com o template atual e valida o resultado inteiro (regras de party e vagas). */
  @Patch(":id")
  @UseGuards(SameOriginGuard)
  @Authorize("update", "EventTemplate")
  async update(@Param("id") id: string, @Body() body: unknown): Promise<EventTemplateDto> {
    const templateId = parseId(id, "Id do template");
    const patch = parseBody(eventTemplatePatchSchema, body);
    const current = await getEventTemplate(this.handle.db, templateId);
    if (!current) throw new NotFoundException("Template não encontrado.");
    const base = { name: current.name, description: current.description, minPartySize: current.minPartySize, maxPartySize: current.maxPartySize, active: current.active, roles: current.roles.map(({ roleId, slots }) => ({ roleId, slots })) };
    const merged = parseBody(eventTemplateInputSchema, { ...base, ...patch });
    return templateOrThrow(await saveEventTemplate(this.handle.db, merged, templateId));
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  @Authorize("delete", "EventTemplate")
  async remove(@Param("id") id: string): Promise<void> {
    if (!(await deleteEventTemplate(this.handle.db, parseId(id, "Id do template")))) throw new NotFoundException("Template não encontrado.");
  }
}
