import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Res, UseGuards } from "@nestjs/common";
import {
  asSubject,
  eventFeeUpdateSchema,
  firstIssue,
  lootSplitCreateSchema,
  lootSplitReversalSchema,
  lootSplitUpdateSchema,
  type Action,
  type EventDto,
  type LootSplitDto,
  type SplitPresenceDto,
} from "@albion-hub/shared";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { EventsService } from "../events/events.service.js";
import { LootSplitService, splitStatusError, splitWriteError, type SplitWriteRefusal } from "./loot-split.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string, label: string): string {
  if (!UUID.test(id)) throw new BadRequestException(`Id ${label} inválido.`);
  return id;
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
  return parsed.data;
}

/**
 * Loot split de um evento (TASK-027 e TASK-028): rascunho, edição, confirmação com lançamento no
 * ledger, e estorno.
 *
 * **Autorização** (recomendação do security-review da TASK-026): o split mostra quanto **cada** membro
 * ganhou, então nenhum endpoint daqui aceita um `userId` do cliente nem devolve dados por pedido do
 * chamador. A porta é dupla:
 * 1. `@Authorize("read", "LootSplit")` filtra por papel — `member` puro não tem `read` em `LootSplit`
 *    e leva 403 antes de tocar no banco;
 * 2. `assertCan(auth, "distribute", event)` confere a condição de dono sobre o **evento** (`ownerId`),
 *    então um caller não lê nem mexe no split de um evento que não é dele; a staff (`manage`) passa
 *    em qualquer um. Ler usa `distribute`, e **não** `read` em `Event`: `read` em `Event` é de todo
 *    membro (a lista de eventos é pública para quem está logado), e o split mostra quanto **cada**
 *    pessoa ganhou — quem enxerga isso é quem responde pela distribuição daquele evento.
 *
 * O `userId` de cada linha vem do banco (presença + inscrição), nunca do pedido.
 */
@Controller("events/:eventId")
export class LootSplitController {
  constructor(
    @Inject(LootSplitService) private readonly splits: LootSplitService,
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

  /**
   * Rascunho do split (AC#1, AC#2, AC#3). Evento cancelado recusa (AC#4).
   *
   * Sem política de tipo aqui de propósito: quem gera o split é quem **distribui aquele evento**
   * (`distribute` em `Event` com a condição de dono, Q13/Q21), não quem tem um papel qualquer. O
   * `assertCan` abaixo é a checagem real — `@Authorize()` só exige sessão.
   */
  @Post("splits")
  @UseGuards(SameOriginGuard)
  @Authorize()
  async create(@Param("eventId") eventId: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<LootSplitDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const result = await this.splits.createDraft(event.id, parseBody(lootSplitCreateSchema, body), auth.user.id);
    if (result.ok) return result.split;
    if (result.reason === "not_found") throw new NotFoundException("Evento não encontrado.");
    throw new ConflictException(splitStatusError(result.status));
  }

  /**
   * Quem esteve na call e por quanto tempo, **sem** rascunho nenhum (TASK-029).
   *
   * A tela de acerto abre com esta lista: a presença existe desde o finish, e esconder isso até o
   * caller digitar o total deixaria a tela em branco justo no momento em que ele precisa conferir
   * quem estava lá. Mesma fonte do rascunho, então o que ele vê aqui é o que vai ser gravado.
   *
   * Autorização igual à da leitura do split, e pelo mesmo motivo: presença de evento é quem esteve
   * com quem, então passa por `distribute` no evento — nunca por `read` em `Event`, que todo membro
   * logado tem.
   */
  @Get("presence")
  @Authorize("read", "LootSplit")
  async presence(
    @Param("eventId") eventId: string,
    @CurrentAuth() auth: Auth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ present: SplitPresenceDto[] }> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    res.setHeader("Cache-Control", "no-store");
    return { present: await this.splits.presence(event.id) };
  }

  /** N splits por evento (AC#3, Q23), na ordem em que as levas de loot chegaram. */
  @Get("splits")
  @Authorize("read", "LootSplit")
  async list(@Param("eventId") eventId: string, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<{ splits: LootSplitDto[] }> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    res.setHeader("Cache-Control", "no-store");
    return { splits: await this.splits.list(event.id) };
  }

  @Get("splits/:splitId")
  @Authorize("read", "LootSplit")
  async detail(
    @Param("eventId") eventId: string,
    @Param("splitId") splitId: string,
    @CurrentAuth() auth: Auth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LootSplitDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const split = await this.splits.get(parseId(splitId, "do split"));
    // Split de outro evento devolve 404 aqui: sem isto, quem manda num evento leria o split de qualquer outro.
    if (!split || split.eventId !== event.id) throw new NotFoundException("Loot split não encontrado.");
    res.setHeader("Cache-Control", "no-store");
    return split;
  }

  /**
   * Confere que o split existe e é **deste** evento antes de qualquer escrita. Sem isso, quem manda
   * num evento poderia editar ou confirmar o split de qualquer outro — a autorização é sobre o evento
   * da rota, então o split precisa ser do evento da rota.
   */
  private async loadSplit(event: EventDto, splitId: string): Promise<LootSplitDto> {
    const split = await this.splits.get(parseId(splitId, "do split"));
    if (!split || split.eventId !== event.id) throw new NotFoundException("Loot split não encontrado.");
    return split;
  }

  /** 404 some com o split; qualquer outra recusa é 409 com a frase do motivo. */
  private refuse(result: SplitWriteRefusal): never {
    if (result.reason === "not_found") throw new NotFoundException("Loot split não encontrado.");
    throw new ConflictException(splitWriteError(result));
  }

  /**
   * Edita o rascunho: total da leva e/ou percentuais (AC#1). A soma 100% é exigida só na confirmação
   * (Q22), então a tela pode salvar estados intermediários sem brigar com o usuário.
   */
  @Patch("splits/:splitId")
  @UseGuards(SameOriginGuard)
  @Authorize()
  async update(@Param("eventId") eventId: string, @Param("splitId") splitId: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<LootSplitDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const split = await this.loadSplit(event, splitId);
    const result = await this.splits.update(event, split.id, parseBody(lootSplitUpdateSchema, body));
    if (!result.ok) this.refuse(result);
    return result.split;
  }

  /**
   * Confirma o split e lança a prata no ledger (AC#2, AC#3, AC#4).
   *
   * Idempotente: confirmar duas vezes devolve 200 com o mesmo split, sem creditar nada de novo. Por
   * isso o verbo responde 200 e não 201 — a segunda chamada não cria coisa nenhuma.
   */
  @Post("splits/:splitId/confirm")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize()
  async confirm(@Param("eventId") eventId: string, @Param("splitId") splitId: string, @CurrentAuth() auth: Auth): Promise<LootSplitDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "distribute", event);
    const split = await this.loadSplit(event, splitId);
    const result = await this.splits.confirm(event, split.id, auth.user.id);
    if (!result.ok) this.refuse(result);
    return result.split;
  }

  /**
   * Estorna os lançamentos de um split confirmado: a única correção possível (Q24).
   *
   * Só staff (`manage` em `LootSplit`), e não o dono do evento: desfazer prata que já está na carteira
   * de outras pessoas é intervenção, não condução do evento. O motivo é obrigatório porque é a única
   * explicação que sobra no extrato de quem teve o crédito desfeito.
   */
  @Post("splits/:splitId/reversals")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("manage", "LootSplit")
  async reverse(
    @Param("eventId") eventId: string,
    @Param("splitId") splitId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: Auth,
  ): Promise<{ reversed: number; split: LootSplitDto }> {
    const event = await this.load(eventId);
    const split = await this.loadSplit(event, splitId);
    const { reason } = parseBody(lootSplitReversalSchema, body);
    const result = await this.splits.reverse(event, split.id, reason, auth.user.id);
    if (!result.ok) this.refuse(result);
    return { reversed: result.reversed, split: (await this.splits.get(split.id))! };
  }

  /**
   * Taxa do evento (decisão do usuário no doc-005): percentual ou valor fixo, sem teto, herdada do
   * template na criação. Editável enquanto o evento não for arquivado (Q26). Aplicar a taxa é da TASK-028.
   */
  @Put("fee")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("update", "Event")
  async setFee(@Param("eventId") eventId: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<EventDto> {
    const event = await this.load(eventId);
    this.assertCan(auth, "update", event);
    const { fee } = parseBody(eventFeeUpdateSchema, body);
    const updated = await this.splits.setFee(event, fee);
    if (!updated) throw new NotFoundException("Evento não encontrado.");
    return updated;
  }
}
