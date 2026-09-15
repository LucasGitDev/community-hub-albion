import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Post, Req, Res } from "@nestjs/common";
import { getNickStatus, requestNick, type DbHandle, type NickRequest } from "@albion-hub/db";
import { sameNick, validateNick, type NickRequestStatus } from "@albion-hub/shared";
import type { Request, Response } from "express";
import type { Env } from "../config/env.js";
import { DB_HANDLE } from "../db/db.module.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { isSameOriginRequest } from "../domain/auth.js";

interface NickRequestDto {
  id: string;
  nick: string;
  status: NickRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MyNickResponse {
  gameNick: string | null;
  pending: NickRequestDto | null;
}

const toDto = (r: NickRequest): NickRequestDto => ({
  id: r.id,
  nick: r.nick,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const header = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Nick do próprio usuário (TASK-012). Fila e decisão da staff ficam na TASK-013. */
@Controller("me/nick")
export class NickController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AUTH_ENV) private readonly env: Env,
  ) {}

  @Get()
  @Authorize("read", "MemberRequest")
  async status(@CurrentAuth() auth: AuthorizedRequest["auth"], @Res({ passthrough: true }) res: Response): Promise<MyNickResponse> {
    res.setHeader("Cache-Control", "no-store");
    const { gameNick, pending } = await getNickStatus(this.handle.db, auth.user.id);
    return { gameNick, pending: pending ? toDto(pending) : null };
  }

  /**
   * Cria a solicitação pendente; se já houver uma, troca o nick dela (201 criada / 200 atualizada).
   * Nunca mexe no nick vigente nem nos papéis: continuam até a staff aprovar (Q31).
   */
  @Post()
  @Authorize("create", "MemberRequest")
  async request(
    @Req() req: Request,
    @CurrentAuth() auth: AuthorizedRequest["auth"],
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MyNickResponse> {
    if (!isSameOriginRequest({ origin: header(req.headers.origin), secFetchSite: header(req.headers["sec-fetch-site"]) }, this.env.PUBLIC_URL))
      throw new ForbiddenException("Requisição de outra origem recusada.");
    const parsed = validateNick((body as { nick?: unknown } | null)?.nick);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    const db = this.handle.db;
    const current = await getNickStatus(db, auth.user.id);
    if (sameNick(current.gameNick, parsed.nick)) throw new ConflictException("Esse já é o seu nick atual.");
    const { request, created } = await requestNick(db, auth.user.id, parsed.nick);
    res.status(created ? 201 : 200);
    res.setHeader("Cache-Control", "no-store");
    return { gameNick: current.gameNick, pending: toDto(request) };
  }
}
