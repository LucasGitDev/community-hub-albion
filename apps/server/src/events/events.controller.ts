import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import {
  asSubject,
  eventCancelSchema,
  eventCreateSchema,
  eventTransferOwnerSchema,
  firstIssue,
  isEventTransition,
  parseEventListQuery,
  transitionError,
  EVENT_TRANSITIONS,
  EVENT_TRANSITION_ACTIONS,
  type Action,
  type EventDto,
  type EventOccupancyDto,
  type EventOwnerChangeDto,
  type EventSignupDto,
} from "@albion-hub/shared";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { assertEventEditable } from "./archived.guard.js";
import { EventSignupsService } from "./event-signups.service.js";
import { EventsService } from "./events.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string): string {
  if (!UUID.test(id)) throw new BadRequestException("Id do evento inválido.");
  return id;
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
  return parsed.data;
}

/**
 * Eventos e máquina de estados (TASK-021, Q9/Q21/Q26).
 * Criar: caller e staff. Transições: owner do evento ou staff (regra CASL com condição `ownerId`).
 * Transferir owner: só staff (`manage`). Ler: qualquer membro.
 */
@Controller("events")
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(EventSignupsService) private readonly signups: EventSignupsService,
  ) {}

  /** 404 em vez de 403 quando o evento não existe: não vaza a existência de ids. */
  private async load(id: string): Promise<EventDto> {
    const event = await this.events.get(parseId(id));
    if (!event) throw new NotFoundException("Evento não encontrado.");
    return event;
  }

  private assertCan(auth: Auth, action: Action, event: EventDto): void {
    if (!auth.ability.can(action, asSubject("Event", { ownerId: event.ownerUserId })))
      throw new ForbiddenException("Só o owner do evento ou a staff pode fazer isso.");
  }

  /**
   * Tudo que o painel desenha numa tela numa chamada só (TASK-023, AC#4): os eventos, quantas vagas de
   * cada role já foram ocupadas e a inscrição de quem está olhando. É este endpoint que o polling repete,
   * então ele evita de propósito uma chamada por evento.
   */
  @Get()
  @Authorize("read", "Event")
  async list(
    @Query() query: Record<string, unknown>,
    @CurrentAuth() auth: Auth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ events: EventDto[]; occupancy: EventOccupancyDto[]; mySignups: EventSignupDto[] }> {
    const parsed = parseEventListQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    res.setHeader("Cache-Control", "no-store");
    const events = await this.events.list(parsed.filters);
    const ids = events.map((e) => e.id);
    const [occupancy, mySignups] = await Promise.all([this.signups.occupancy(ids), this.signups.mine(auth.user.id, ids)]);
    return { events, occupancy, mySignups };
  }

  @Get(":id")
  @Authorize("read", "Event")
  async detail(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<EventDto> {
    res.setHeader("Cache-Control", "no-store");
    return this.load(id);
  }

  @Get(":id/owner-history")
  @Authorize("read", "Event")
  async ownerHistory(@Param("id") id: string): Promise<{ history: EventOwnerChangeDto[] }> {
    const event = await this.load(id);
    return { history: await this.events.ownerHistory(event.id) };
  }

  /** Só caller e staff criam (Q9); quem cria vira owner (Q21, AC#1/AC#2). */
  @Post()
  @UseGuards(SameOriginGuard)
  @Authorize("create", "Event")
  async create(@Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventDto> {
    const result = await this.events.create(parseBody(eventCreateSchema, body), auth.user.id);
    if (result.ok) return result.event;
    if (result.reason === "unknown_template") throw new BadRequestException("Esse template não existe mais. Atualize a página e escolha de novo.");
    throw new ConflictException("Esse template está inativo. Reative ou escolha outro para criar o evento.");
  }

  /**
   * `open`, `close`, `start`, `finish`, `cancel`, `archive`. Transição fora da máquina → 409 PT-BR
   * (AC#3), então evento finalizado não volta a ser cancelado e evento arquivado não vai a lugar nenhum. Só `cancel` lê o corpo, para guardar o motivo (TASK-025);
   * nas outras o corpo é ignorado de propósito, em vez de virar 400 por um campo que não existe ali.
   */
  @Post(":id/transitions/:transition")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize()
  async transition(@Param("id") id: string, @Param("transition") transition: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventDto> {
    if (!isEventTransition(transition)) throw new BadRequestException("Ação de evento desconhecida.");
    const event = await this.load(id);
    this.assertCan(auth, EVENT_TRANSITION_ACTIONS[transition], event);
    const reason = transition === "cancel" ? parseBody(eventCancelSchema, body ?? {}).reason : null;
    const result = await this.events.transition(event.id, transition, auth.user.id, reason);
    if (result.ok) return result.event;
    if (result.reason === "not_found") throw new NotFoundException("Evento não encontrado.");
    // Precondição de negócio recusou (hoje: split em rascunho barrando o arquivamento, AC#4).
    if (result.reason === "blocked") throw new ConflictException(result.message);
    throw new ConflictException(transitionError(result.from, EVENT_TRANSITIONS[transition]));
  }

  /**
   * Transferência de owner: só staff (`manage`), com histórico (Q21, AC#4). Vale até o evento ser
   * arquivado — a taxa e as sobras vão para o owner, e o acerto só acaba no `archived` (TASK-044).
   */
  @Post(":id/owner")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("manage", "Event")
  async transferOwner(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventDto> {
    const { ownerUserId } = parseBody(eventTransferOwnerSchema, body);
    const event = await this.load(id);
    assertEventEditable(event);
    const result = await this.events.transferOwner(event.id, ownerUserId, auth.user.id);
    if (result.ok) return result.event;
    if (result.reason === "not_found") throw new NotFoundException("Evento não encontrado.");
    if (result.reason === "unknown_user") throw new BadRequestException("Esse usuário não existe.");
    if (result.reason === "same_owner") throw new ConflictException("Essa pessoa já é o owner do evento.");
    throw new ConflictException("O evento foi cancelado ou arquivado: não dá para trocar o owner.");
  }
}
