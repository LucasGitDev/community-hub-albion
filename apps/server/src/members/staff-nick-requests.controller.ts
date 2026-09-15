import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Res, UseGuards } from "@nestjs/common";
import { listPendingNickRequests, type DbHandle } from "@albion-hub/db";
import { validateRejectionNote, type AlbionLookupResult } from "@albion-hub/shared";
import type { Response } from "express";
import { Authorize, CurrentAuth } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { DB_HANDLE } from "../db/db.module.js";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { NickDecisionService, type NickDecisionResult } from "./nick-decision.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StaffNickRequestDto {
  id: string;
  nick: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; displayName: string | null; discordUsername: string; gameNick: string | null };
  /** Conferência do nick pedido na API Albion (TASK-016). Só ajuda: `disabled` sem ALBION_REGION, `unavailable` se a API falhar. */
  albion: AlbionLookupResult;
}

export interface NickDecisionDto {
  id: string;
  status: "approved" | "rejected";
  decidedAt: string;
  decidedBy: string;
}

function parseId(id: string): string {
  if (!UUID.test(id)) throw new BadRequestException("Solicitação inválida.");
  return id;
}

function toDecision(result: NickDecisionResult): NickDecisionDto {
  if (!result.ok) {
    if (result.reason === "not_found") throw new NotFoundException("Solicitação não encontrada.");
    throw new ConflictException("Essa solicitação já foi decidida. Atualize a fila.");
  }
  const r = result.request;
  return { id: r.id, status: r.status as NickDecisionDto["status"], decidedAt: r.decidedAt!.toISOString(), decidedBy: r.decidedBy! };
}

/** Fila de nick da staff (TASK-013, Q14/Q31). Regra de decisão vive no NickDecisionService. */
@Controller("staff/nick-requests")
export class StaffNickRequestsController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(NickDecisionService) private readonly decisions: NickDecisionService,
    @Inject(ALBION_PLAYER_LOOKUP) private readonly albion: AlbionPlayerLookup,
  ) {}

  @Get()
  @Authorize("approve", "MemberRequest")
  async list(@Res({ passthrough: true }) res: Response): Promise<{ requests: StaffNickRequestDto[] }> {
    res.setHeader("Cache-Control", "no-store");
    const rows = await listPendingNickRequests(this.handle.db);
    // Consulta na leitura (paralela, em cache, timeout curto): não toca registro nem aprovação (Q14).
    const albion = await Promise.all(rows.map(({ request }) => this.albion.lookup(request.nick)));
    return {
      requests: rows.map(({ request, user }, i) => ({
        id: request.id,
        nick: request.nick,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        user: { id: user.id, displayName: user.displayName, discordUsername: user.discordUsername, gameNick: user.gameNick },
        albion: albion[i]!,
      })),
    };
  }

  @Post(":id/approve")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("approve", "MemberRequest")
  async approve(@Param("id") id: string, @CurrentAuth() auth: AuthContext): Promise<NickDecisionDto> {
    return toDecision(await this.decisions.approve(parseId(id), auth.user.id));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("approve", "MemberRequest")
  async reject(@Param("id") id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext): Promise<NickDecisionDto> {
    const requestId = parseId(id);
    const note = validateRejectionNote((body as { note?: unknown } | null)?.note);
    if (!note.ok) throw new BadRequestException(note.error);
    return toDecision(await this.decisions.reject(requestId, auth.user.id, note.note));
  }
}
