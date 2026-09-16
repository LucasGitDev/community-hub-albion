import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import { asSubject, eventJoinSchema, eventSignupMoveSchema, eventStatusLabel, firstIssue, isUuid, type EventMemberDto, type EventSignupDto } from "@albion-hub/shared";
import type { Response } from "express";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { EventSignupsService } from "./event-signups.service.js";
import { EventsService } from "./events.service.js";

type Auth = AuthorizedRequest["auth"];

/** Mensagens PT-BR das recusas; as mesmas regras aparecem no botão do Discord com outra roupa. */
const SIGNUP_ERRORS = {
  unknownRole: "Essa role não é desse evento. Atualize a página e escolha de novo.",
  alreadyInRole: "Você já está nessa role.",
  notSignedUp: "Essa pessoa não está inscrita neste evento.",
  alreadyThere: "A inscrição já está exatamente onde você pediu.",
  roleFull: "Essa role está lotada. Tire alguém dela antes de colocar mais gente.",
  notOpen: (status: string) => `As inscrições não estão abertas: o evento está ${status}.`,
  frozen: (status: string) => `O evento está ${status}: a lista não muda mais.`,
} as const;

/**
 * Inscrição em evento pela API (TASK-022, Q27). Mesmo serviço dos botões do Discord (doc-002).
 * Membro entra e sai da própria inscrição (`join Event`); mover terceiro é `update Event`, ou seja
 * owner do evento (caller) ou staff — nunca o próprio inscrito se promovendo.
 */
@Controller("events")
export class EventSignupsController {
  constructor(
    @Inject(EventSignupsService) private readonly signups: EventSignupsService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 404 antes de qualquer checagem de dono: não vaza a existência de ids. */
  private async load(id: string) {
    if (!isUuid(id)) throw new BadRequestException("Id do evento inválido.");
    const event = await this.events.get(id);
    if (!event) throw new NotFoundException("Evento não encontrado.");
    return event;
  }

  /** Lista + nome de exibição de cada pessoa citada (inscritos e owner), para o painel não mostrar uuid (TASK-023). */
  @Get(":id/signups")
  @Authorize("read", "Event")
  async list(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<{ signups: EventSignupDto[]; members: EventMemberDto[] }> {
    const event = await this.load(id);
    res.setHeader("Cache-Control", "no-store");
    const signups = await this.signups.list(event.id);
    const members = await this.signups.members([event.ownerUserId, ...signups.map((s) => s.userId)]);
    return { signups, members };
  }

  /** Entra na role (ou troca). Quem entra é sempre a sessão, nunca um id vindo do corpo (AC#3). */
  @Post(":id/signups")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("join", "Event")
  async join(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventSignupDto> {
    const parsed = eventJoinSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
    const event = await this.load(id);
    const result = await this.signups.join(event.id, auth.user.id, parsed.data.slotId);
    if (result.ok) return result.signup;
    if (result.reason === "not_open") throw new ConflictException(SIGNUP_ERRORS.notOpen(eventStatusLabel(result.status)));
    if (result.reason === "unknown_role") throw new BadRequestException(SIGNUP_ERRORS.unknownRole);
    if (result.reason === "already_in_role") throw new ConflictException(SIGNUP_ERRORS.alreadyInRole);
    throw new NotFoundException("Evento não encontrado.");
  }

  @Delete(":id/signups/me")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("join", "Event")
  async leave(@Param("id") id: string, @CurrentAuth() auth: Auth): Promise<EventSignupDto> {
    const event = await this.load(id);
    const result = await this.signups.leave(event.id, auth.user.id);
    if (result.ok) return result.signup;
    if (result.reason === "not_open") throw new ConflictException(SIGNUP_ERRORS.notOpen(eventStatusLabel(result.status)));
    if (result.reason === "not_signed_up") throw new ConflictException("Você não está inscrito neste evento.");
    throw new NotFoundException("Evento não encontrado.");
  }

  /** Caller/owner (ou staff) move um inscrito entre role e espera (AC#4). */
  @Patch(":id/signups/:userId")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize()
  async move(@Param("id") id: string, @Param("userId") userId: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventSignupDto> {
    if (!isUuid(userId)) throw new BadRequestException("Id do membro inválido.");
    const parsed = eventSignupMoveSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
    const event = await this.load(id);
    if (!auth.ability.can("update", asSubject("Event", { ownerId: event.ownerUserId })))
      throw new ForbiddenException("Só o owner do evento ou a staff pode mexer na lista de inscritos.");
    const target = parsed.data.target === "waitlist" ? ({ kind: "waitlist" } as const) : ({ kind: "role", slotId: parsed.data.slotId } as const);
    const result = await this.signups.move(event.id, userId, target, auth.user.id);
    if (result.ok) return result.signup;
    if (result.reason === "closed_event") throw new ConflictException(SIGNUP_ERRORS.frozen(eventStatusLabel(result.status)));
    if (result.reason === "unknown_role") throw new BadRequestException(SIGNUP_ERRORS.unknownRole);
    if (result.reason === "not_signed_up") throw new ConflictException(SIGNUP_ERRORS.notSignedUp);
    if (result.reason === "already_there") throw new ConflictException(SIGNUP_ERRORS.alreadyThere);
    if (result.reason === "role_full") throw new ConflictException(SIGNUP_ERRORS.roleFull);
    throw new NotFoundException("Evento não encontrado.");
  }
}
