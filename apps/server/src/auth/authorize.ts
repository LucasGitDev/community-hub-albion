import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { defineAbilityFor, type Action, type AppAbility, type SubjectType } from "@albion-hub/shared";
import type { Request } from "express";
import { type AuthContext, SessionService } from "./session.service.js";

const POLICY = Symbol("POLICY");

interface Policy {
  action: Action;
  subject: SubjectType;
}

export type AuthorizedRequest = Request & { auth: AuthContext & { ability: AppAbility } };

/** 401 sem sessão válida; 403 quando os papéis não permitem `action` em `subject` (TASK-009). */
@Injectable()
export class AuthorizeGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthorizedRequest>();
    const auth = await this.sessions.fromRequest(req);
    if (!auth) throw new UnauthorizedException("Sessão inválida ou expirada. Entre de novo.");
    const ability = defineAbilityFor({ id: auth.user.id, roles: auth.roles });
    req.auth = { ...auth, ability };
    const policy = this.reflector.get<Policy | undefined>(POLICY, context.getHandler());
    // Checagem por tipo; regras com condição (dono) o handler confere com `ability` + asSubject.
    if (policy && !ability.can(policy.action, policy.subject)) throw new ForbiddenException("Você não tem permissão para esta ação.");
    return true;
  }
}

/** Exige sessão e, opcionalmente, permissão `action` sobre `subject`. */
export const Authorize = (action?: Action, subject?: SubjectType) =>
  applyDecorators(...(action && subject ? [SetMetadata(POLICY, { action, subject })] : []), UseGuards(AuthorizeGuard));

/** Contexto autenticado (user, roles, ability) preenchido pelo AuthorizeGuard. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthorizedRequest>().auth);
