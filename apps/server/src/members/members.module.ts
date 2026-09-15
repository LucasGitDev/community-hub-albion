import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { NickDecisionService } from "./nick-decision.service.js";
import { StaffNickRequestsController } from "./staff-nick-requests.controller.js";

/** Entrada de membros pela staff (TASK-013). Exporta o serviço de decisão para bot/embed (TASK-014/015). */
@Module({})
export class MembersModule {
  static register(env: Env): DynamicModule {
    return {
      module: MembersModule,
      global: true,
      controllers: [StaffNickRequestsController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard, NickDecisionService],
      exports: [NickDecisionService],
    };
  }
}
