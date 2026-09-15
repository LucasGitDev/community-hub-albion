import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "../config/env.js";
import { isSameOriginRequest } from "../domain/auth.js";
import { AUTH_ENV } from "./auth.controller.js";

const header = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Defesa CSRF para rotas que alteram estado: exige mesma origem (além do cookie SameSite=Lax). */
@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(@Inject(AUTH_ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ok = isSameOriginRequest({ origin: header(req.headers.origin), secFetchSite: header(req.headers["sec-fetch-site"]) }, this.env.PUBLIC_URL);
    if (!ok) throw new ForbiddenException("Requisição de outra origem recusada.");
    return true;
  }
}
