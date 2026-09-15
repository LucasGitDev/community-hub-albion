import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SessionService } from "../auth/session.service.js";
import { NickController } from "./nick.controller.js";

/** Registro/troca de nick do próprio usuário (TASK-012). */
@Module({})
export class NickModule {
  static register(env: Env): DynamicModule {
    return {
      module: NickModule,
      controllers: [NickController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard],
    };
  }
}
