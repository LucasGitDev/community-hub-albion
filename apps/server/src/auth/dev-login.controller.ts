import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { createSession, getBanStatusByDiscordId, grantRole, insertLedgerEntry, markLeftGuildForDev, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
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
  /**
   * Lançamentos de prata para o e2e do extrato (TASK-031). Só existe junto com o dev-login, isto é,
   * com AUTH_DEV_LOGIN=true, que o env proíbe em produção — é a mesma porta, não uma porta nova.
   * Vai pelo `LedgerService`/repo, então continua valendo o append-only: aqui também só se insere.
   */
  silver: z
    .array(
      z.object({
        /** Prata inteira em string (Q20): positivo credita, negativo debita. */
        amount: z.string().regex(/^-?\d{1,18}$/).refine((v) => BigInt(v) !== 0n),
        /** `reversal` fica de fora: estorno só nasce de `reverseLedgerEntry`. */
        kind: z.enum(["split_payout", "split_fee", "withdrawal", "adjustment"]).default("split_payout"),
        memo: z.string().trim().max(200).optional(),
      }),
    )
    .max(50)
    .optional(),
  /**
   * Marca a conta como fora do servidor do Discord, para o e2e da lista de membros (TASK-049) ver o
   * selo sem um bot ligado. Mesma porta do `silver` e do `gameNick`: só existe com AUTH_DEV_LOGIN=true,
   * que o env proíbe em produção. É só a marca — nenhuma sessão é derrubada e nenhum papel some, porque
   * quem faz isso é a limpeza, e semear não é limpar.
   */
  leftGuild: z.boolean().optional(),
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
    const { discordId, username, roles, gameNick, silver, leftGuild } = parsed.data;
    const db = this.handle.db;
    // Banido não entra por aqui também (TASK-050): esta porta cria sessão igual à do Discord, então a
    // mesma recusa vale — senão o e2e provaria um acesso que a produção não permite.
    const ban = await getBanStatusByDiscordId(db, discordId);
    if (ban) throw new ForbiddenException(`Conta banida da comunidade. Motivo: ${ban.banReason}`);
    const user = await upsertUserByDiscordId(db, { discordId, discordUsername: username, displayName: username });
    if (gameNick) await setGameNick(db, user.id, gameNick);
    for (const role of new Set(["member" as const, ...roles])) await grantRole(db, user.id, role);
    for (const entry of silver ?? []) await insertLedgerEntry(db, { userId: user.id, amount: BigInt(entry.amount), kind: entry.kind, memo: entry.memo ?? null });
    if (leftGuild) await markLeftGuildForDev(db, user.id);
    const { token } = await createSession(db, user.id, sessionExpiresAt(new Date(), this.env.SESSION_TTL_DAYS));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env.NODE_ENV, this.env.SESSION_TTL_DAYS));
  }
}
