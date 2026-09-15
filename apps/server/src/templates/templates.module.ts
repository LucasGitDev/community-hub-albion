import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { EventRolesController, EventTemplatesController } from "./templates.controller.js";

/** Catálogo de roles e templates de evento (TASK-020). Eventos (TASK-021) leem daqui. */
@Module({})
export class TemplatesModule {
  static register(env: Env): DynamicModule {
    return {
      module: TemplatesModule,
      controllers: [EventRolesController, EventTemplatesController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard],
    };
  }
}
