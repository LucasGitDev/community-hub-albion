import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { createSession, grantRole, schema, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { eq } from "drizzle-orm";
import { ROLES, validateNick } from "@albion-hub/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { DB_HANDLE } from "../db/db.module.js";
import { isSameOriginRequest, SESSION_COOKIE, sessionCookieOptions, sessionExpiresAt } from "../domain/auth.js";
import { AUTH_ENV } from "./auth.controller.js";

const devLoginSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/),
  username: z.string().trim().min(1).max(32),
  roles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  /** Nick já aprovado (e2e de troca de nick, TASK-012); aprovação real é da staff (TASK-013). */
  gameNick: z.string().refine((v) => validateNick(v).ok).optional(),
});

/**
 * Login sem Discord para desenvolvimento e e2e. Só é registrado com AUTH_DEV_LOGIN=true,
 * que o env proíbe em produção. Mesma sessão/cookie do login real.
 */
@Controller("auth")
export class DevLoginController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AUTH_ENV) private readonly env: Env,
  ) {}

  @Post("dev-login")
  @HttpCode(204)
  async login(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    const headers = { origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined, secFetchSite: typeof req.headers["sec-fetch-site"] === "string" ? req.headers["sec-fetch-site"] : undefined };
    if (!isSameOriginRequest(headers, this.env.PUBLIC_URL)) throw new ForbiddenException("Requisição de outra origem recusada.");
    const parsed = devLoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados de login de desenvolvimento inválidos.");
    const { discordId, username, roles, gameNick } = parsed.data;
    const db = this.handle.db;
    const user = await upsertUserByDiscordId(db, { discordId, discordUsername: username, displayName: username });
    if (gameNick) await db.update(schema.users).set({ gameNick }).where(eq(schema.users.id, user.id));
    for (const role of new Set(["member" as const, ...roles])) await grantRole(db, user.id, role);
    const { token } = await createSession(db, user.id, sessionExpiresAt(new Date(), this.env.SESSION_TTL_DAYS));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env.NODE_ENV, this.env.SESSION_TTL_DAYS));
  }
}
