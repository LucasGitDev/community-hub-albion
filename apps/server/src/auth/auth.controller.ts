import { Controller, Get, HttpCode, Inject, Logger, Post, Req, Res, ForbiddenException } from "@nestjs/common";
import { createSession, grantRole, revokeSession, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { Request, Response } from "express";
import type { Env } from "../config/env.js";
import { DB_HANDLE } from "../db/db.module.js";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  callbackErrorCode,
  clearCookieOptions,
  generateOAuthState,
  isSameOriginRequest,
  LOGIN_SUCCESS_PATH,
  loginErrorPath,
  parseCookies,
  rolesForLogin,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionExpiresAt,
  STATE_COOKIE,
  stateCookieOptions,
  verifyOAuthState,
} from "../domain/auth.js";
import { Authorize, CurrentAuth } from "./authorize.js";
import { DISCORD_OAUTH_CLIENT, type DiscordOAuthClient } from "./discord-oauth.client.js";
import type { AuthContext } from "./session.service.js";

export const AUTH_ENV = Symbol("AUTH_ENV");

export interface MeResponse {
  user: { id: string; discordId: string; username: string; displayName: string | null; avatar: string | null };
  roles: string[];
}

const single = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger("Auth");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_OAUTH_CLIENT) private readonly discord: DiscordOAuthClient,
    @Inject(AUTH_ENV) private readonly env: Env,
  ) {}

  /** Inicia o login: grava `state` em cookie httpOnly e manda para o Discord. */
  @Get("discord")
  start(@Res() res: Response): void {
    const state = generateOAuthState();
    res.cookie(STATE_COOKIE, state, stateCookieOptions(this.env.NODE_ENV));
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, buildAuthorizeUrl({ clientId: this.env.DISCORD_CLIENT_ID, redirectUri: buildRedirectUri(this.env.PUBLIC_URL), state }));
  }

  @Get("discord/callback")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    res.clearCookie(STATE_COOKIE, clearCookieOptions(stateCookieOptions(this.env.NODE_ENV)));
    res.setHeader("Cache-Control", "no-store");
    const fail = (code: Parameters<typeof loginErrorPath>[0]) => res.redirect(302, loginErrorPath(code));

    const query = req.query;
    // State primeiro: sem state válido nada da query (nem `error`) é considerado.
    if (!verifyOAuthState(cookies[STATE_COOKIE], query.state)) return fail("oauth");
    if (query.error !== undefined) return fail(callbackErrorCode(query.error));
    const code = single(query.code);
    if (!code) return fail("oauth");

    let profile;
    try {
      const accessToken = await this.discord.exchangeCode(code, buildRedirectUri(this.env.PUBLIC_URL));
      const [user, member] = await Promise.all([this.discord.getUser(accessToken), this.discord.isGuildMember(accessToken, this.env.GUILD_ID)]);
      if (!member) {
        this.logger.warn(`login recusado: discord ${user.id} não é membro da guild`);
        return fail("nao-membro");
      }
      profile = user;
    } catch (error) {
      this.logger.warn(`falha no OAuth do Discord: ${error instanceof Error ? error.message : "erro desconhecido"}`);
      return fail("oauth");
    }

    const db = this.handle.db;
    const user = await upsertUserByDiscordId(db, {
      discordId: profile.id,
      discordUsername: profile.username,
      displayName: profile.globalName,
      avatar: profile.avatar,
    });
    for (const role of rolesForLogin(profile.id, this.env.BOOTSTRAP_ADMIN_DISCORD_IDS)) await grantRole(db, user.id, role);
    // Sessão anterior do navegador (se houver) é descartada: sempre token novo no login.
    const previous = cookies[SESSION_COOKIE];
    if (previous) await revokeSession(db, previous);
    const { token } = await createSession(db, user.id, sessionExpiresAt(new Date(), this.env.SESSION_TTL_DAYS));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env.NODE_ENV, this.env.SESSION_TTL_DAYS));
    res.redirect(302, LOGIN_SUCCESS_PATH);
  }

  @Get("me")
  @Authorize()
  me(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): MeResponse {
    res.setHeader("Cache-Control", "no-store");
    const { user, roles } = auth;
    return {
      user: { id: user.id, discordId: user.discordId, username: user.discordUsername, displayName: user.displayName, avatar: user.avatar },
      roles,
    };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const headers = { origin: single(req.headers.origin), secFetchSite: single(req.headers["sec-fetch-site"]) };
    if (!isSameOriginRequest(headers, this.env.PUBLIC_URL)) throw new ForbiddenException("Requisição de outra origem recusada.");
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await revokeSession(this.handle.db, token);
    res.clearCookie(SESSION_COOKIE, clearCookieOptions(sessionCookieOptions(this.env.NODE_ENV, this.env.SESSION_TTL_DAYS)));
  }
}
