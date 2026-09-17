import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Res, UseGuards } from "@nestjs/common";
import { asSubject, eventRoleBuffunfaSchema, firstIssue, type Action, type EventAttendanceDto, type EventDto } from "@albion-hub/shared";
import type { Response } from "express";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { EventsService } from "../events/events.service.js";
import { attendanceToDto, attendanceValueError, EventAttendanceService } from "./event-attendance.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string, label: string): string {
  if (!UUID.test(id)) throw new BadRequestException(`Id ${label} inválido.`);
  return id;
}

/**
 * Buffunfa por participação em evento (TASK-057): prévia, ajuste do valor — em lote ou por role
 * (TASK-072) — e fechamento.
 *
 * **Autorização** idêntica à do loot split, e pelo mesmo motivo: isto mostra quem esteve na call e
 * quanto cada um recebe, então a porta é `distribute` sobre o **evento** (condição de dono, Q13/Q21),
 * não `read` em `Event` — que todo membro logado tem, porque a lista de eventos é pública para quem
 * está dentro. Nenhum endpoint aqui aceita `userId` do cliente: o alvo de cada lançamento vem da
 * presença medida e da inscrição, e o ator vem da sessão.
 */
@Controller("events/:eventId/attendance")
export class EventAttendanceController {
  constructor(
    @Inject(EventAttendanceService) private readonly attendance: EventAttendanceService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 404 em vez de 403 quando o evento não existe: não vaza a existência de ids. */
  private async load(eventId: string): Promise<EventDto> {
    const event = await this.events.get(parseId(eventId, "do evento"));
    if (!event) throw new NotFoundException("Evento não encontrado.");
    return event;
  }

  private assertCan(auth: Auth, action: Action, event: EventDto): void {
    if (!auth.ability.can(action, asSubject("Event", { ownerId: event.ownerUserId })))
      throw new ForbiddenException("Só o owner do evento ou a staff pode fazer isso.");
  }

  private async dto(event: EventDto): Promise<EventAttendanceDto> {
    const preview = await this.attendance.preview(event.id);
    if (!preview) throw new NotFoundException("Evento não encontrado.");
    return attendanceToDto(preview);
  }

  /**
   * Quem recebe, quanto, e quem fica de fora com o motivo (AC#4, AC#5). Antes do fechamento é prévia;
   * depois dele é recibo do que foi lançado.
   */
  @Get()
  @Authorize("read", "LootSplit")
  async get(@Param("eventId") eventId: string, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<EventAttendanceDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    res.setHeader("Cache-Control", "no-store");
    return this.dto(event);
  }

  /**
   * **Todas** as roles do evento passam a valer o mesmo (AC#1). É o gesto que o caller repete: no
   * geral todas ganham X desde o início, e depois isso muda. Sem `slotId` na rota justamente porque
   * o alvo não é uma vaga — é o evento inteiro.
   *
   * O ajuste individual abaixo continua existindo e continua valendo depois deste (AC#2): quem
   * aplica o lote e depois sobe o tank fica com o tank em cima do valor geral.
   */
  @Patch("roles")
  @UseGuards(SameOriginGuard)
  @Authorize()
  async setAllValues(@Param("eventId") eventId: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventAttendanceDto> {
    return this.applyValue(eventId, null, body, auth);
  }

  /**
   * Sobe ou desce o valor de **uma** role (AC#2, AC#3). Aceita qualquer inteiro até o teto do
   * sistema: a faixa do template é valor de partida, não teto do evento (revisão da F6-8 na
   * TASK-072). Sem política de tipo aqui de propósito — quem ajusta é quem responde pela
   * distribuição daquele evento, e é o `assertCan` abaixo que confere isso.
   */
  @Patch("roles/:slotId")
  @UseGuards(SameOriginGuard)
  @Authorize()
  async setValue(
    @Param("eventId") eventId: string,
    @Param("slotId") slotId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: Auth,
  ): Promise<EventAttendanceDto> {
    return this.applyValue(eventId, parseId(slotId, "da role"), body, auth);
  }

  /** O caminho comum do lote e do individual: mesma porta, mesma validação, mesmas recusas. */
  private async applyValue(eventId: string, slotId: string | null, body: unknown, auth: Auth): Promise<EventAttendanceDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const parsed = eventRoleBuffunfaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
    const result = await this.attendance.setRoleValue(event, slotId, parsed.data.value);
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Role do evento não encontrada.");
      throw new ConflictException(attendanceValueError(result));
    }
    return this.dto(event);
  }

  /**
   * Fecha a Buffunfa do evento: cria os lançamentos de quem bateu os 90% (AC#6). Idempotente — a
   * segunda chamada devolve o mesmo recibo sem creditar nada de novo.
   *
   * Evento sem canal de presença carimbado leva 409 com a frase da F6-11, e nada é escrito: sem
   * medição não existe comparecimento provado.
   */
  @Post("payout")
  @UseGuards(SameOriginGuard)
  @Authorize()
  async pay(@Param("eventId") eventId: string, @CurrentAuth() auth: Auth): Promise<EventAttendanceDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const result = await this.attendance.pay(event, auth.user.id);
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Evento não encontrado.");
      throw new ConflictException("Este evento não teve canal de voz carimbado: sem presença medida, ninguém recebe Buffunfa.");
    }
    return attendanceToDto(result.preview);
  }
}
