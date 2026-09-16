import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import {
  asSubject,
  firstIssue,
  parseWithdrawalListQuery,
  withdrawalApproveSchema,
  withdrawalRefusalMessage,
  withdrawalRejectSchema,
  withdrawalRequestSchema,
  withdrawalSettleSchema,
  withdrawalTransitionError,
  type WithdrawalBalanceDto,
  type WithdrawalDto,
} from "@albion-hub/shared";
import type { WithdrawalDecisionResult } from "@albion-hub/db";
import type { Response } from "express";
import type { z } from "zod";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { toBalanceDto, WithdrawalService } from "./withdrawal.service.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string): string {
  if (!UUID.test(id)) throw new BadRequestException("Id do saque inválido.");
  return id;
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(firstIssue(parsed.error));
  return parsed.data;
}

/** 404/409 PT-BR para o resultado de uma decisão da staff; `note_required` nunca chega aqui (zod pega antes). */
function unwrap(result: WithdrawalDecisionResult, to: "approved" | "rejected" | "settled"): WithdrawalDto {
  if (result.ok) return result.withdrawal;
  if (result.reason === "not_found") throw new NotFoundException("Saque não encontrado.");
  if (result.reason === "note_required") throw new BadRequestException("Escreva a nota: ela fica no histórico do saque.");
  throw new ConflictException(withdrawalTransitionError(result.from, to));
}

export interface MyWithdrawalsResponse {
  balance: WithdrawalBalanceDto;
  withdrawals: WithdrawalDto[];
}

/**
 * Saque do próprio membro (TASK-030). Fica separado de `/withdrawals` (staff) de propósito: aqui o dono
 * **nunca** vem do cliente.
 *
 * Segurança (recomendação do security-review da TASK-026): `WithdrawalService` recebe `userId` como
 * argumento e confia em quem chama, então todo handler daqui usa `auth.user.id` e mais nada. O corpo do
 * pedido (`withdrawalRequestSchema`) sequer tem campo de usuário, então não há o que ignorar: um membro
 * não consegue pedir saque nem ler saque no nome de outro, mesmo mandando `userId` no JSON.
 */
@Controller("me/withdrawals")
export class MyWithdrawalsController {
  constructor(@Inject(WithdrawalService) private readonly withdrawals: WithdrawalService) {}

  /** Saldo + meus saques numa chamada só: é o que a tela do membro (TASK-031) desenha e o polling repete. */
  @Get()
  @Authorize("read", "Withdrawal")
  async mine(@CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<MyWithdrawalsResponse> {
    res.setHeader("Cache-Control", "no-store");
    const [balance, withdrawals] = await Promise.all([this.withdrawals.balance(auth.user.id), this.withdrawals.list({ userId: auth.user.id })]);
    return { balance: toBalanceDto(balance), withdrawals };
  }

  /**
   * Pede um saque. Sem mínimo e sem taxa (Q12, revisado em 2026-09-16): o 409 só sai quando o valor passa
   * do disponível ou o saldo está negativo (Q24). O pedido nasce `pending` e já reserva o saldo (AC#2).
   */
  @Post()
  @UseGuards(SameOriginGuard)
  @Authorize("create", "Withdrawal")
  async request(@Body() body: unknown, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<MyWithdrawalsResponse> {
    const { amount } = parseBody(withdrawalRequestSchema, body);
    const result = await this.withdrawals.request(auth.user.id, amount);
    if (!result.ok) {
      if (result.reason === "unknown_user") throw new NotFoundException("Usuário não encontrado.");
      throw new ConflictException(withdrawalRefusalMessage(result));
    }
    res.status(201);
    res.setHeader("Cache-Control", "no-store");
    return { balance: toBalanceDto(result.balance), withdrawals: await this.withdrawals.list({ userId: auth.user.id }) };
  }
}

/**
 * Fila da staff (TASK-030, telas na TASK-032). Aprovar, recusar e liquidar exigem a permissão de staff
 * (CASL: `approve`/`reject`/`settle` em `Withdrawal`), que membro nenhum tem.
 *
 * A listagem usa a ação `read`, que o membro **também** tem — mas só sobre os próprios saques (regra com
 * condição `userId`). Por isso quem não é staff aqui tem o filtro forçado para o próprio id: a rota nunca
 * devolve saque de terceiro para quem não pode ver, e pedir o de outro dá 403 em vez de vazar em silêncio.
 */
@Controller("withdrawals")
export class WithdrawalsController {
  constructor(@Inject(WithdrawalService) private readonly withdrawals: WithdrawalService) {}

  /** `true` quando o usuário é staff para efeito de saque: enxerga a fila inteira. */
  private canSeeAll(auth: Auth): boolean {
    return auth.ability.can("approve", "Withdrawal");
  }

  @Get()
  @Authorize("read", "Withdrawal")
  async list(@Query() query: Record<string, unknown>, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<{ withdrawals: WithdrawalDto[] }> {
    const parsed = parseWithdrawalListQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const all = this.canSeeAll(auth);
    if (!all && parsed.filters.userId && parsed.filters.userId !== auth.user.id) throw new ForbiddenException("Você só pode ver os seus próprios saques.");
    res.setHeader("Cache-Control", "no-store");
    // Sem permissão de staff o filtro é o próprio id, não o que veio na query.
    return { withdrawals: await this.withdrawals.list({ ...parsed.filters, userId: all ? parsed.filters.userId : auth.user.id }) };
  }

  /** 404 (e não 403) quando o saque é de outro membro: a resposta não diz nem que o id existe. */
  @Get(":id")
  @Authorize("read", "Withdrawal")
  async detail(@Param("id") id: string, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<WithdrawalDto> {
    const withdrawal = await this.withdrawals.get(parseId(id));
    if (!withdrawal || !auth.ability.can("read", asSubject("Withdrawal", { userId: withdrawal.userId }))) throw new NotFoundException("Saque não encontrado.");
    res.setHeader("Cache-Control", "no-store");
    return withdrawal;
  }

  /** Aprova: lança o débito no ledger (AC#3, Q25). Nota é opcional aqui. */
  @Post(":id/approve")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("approve", "Withdrawal")
  async approve(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<WithdrawalDto> {
    const { note } = parseBody(withdrawalApproveSchema, body ?? {});
    return unwrap(await this.withdrawals.approve(parseId(id), { actorUserId: auth.user.id, note }), "approved");
  }

  /** Recusa: libera a reserva sem lançamento (AC#3). Motivo obrigatório: é o que o membro lê. */
  @Post(":id/reject")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("reject", "Withdrawal")
  async reject(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<WithdrawalDto> {
    const { note } = parseBody(withdrawalRejectSchema, body);
    return unwrap(await this.withdrawals.reject(parseId(id), { actorUserId: auth.user.id, note }), "rejected");
  }

  /** Liquida: quem liquidou sai da sessão (`settled_by`) e a nota é obrigatória (AC#4, Q11). */
  @Post(":id/settle")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("settle", "Withdrawal")
  async settle(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: Auth): Promise<WithdrawalDto> {
    const { note } = parseBody(withdrawalSettleSchema, body);
    return unwrap(await this.withdrawals.settle(parseId(id), { actorUserId: auth.user.id, note }), "settled");
  }
}
