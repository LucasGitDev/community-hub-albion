import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { ShopController } from "./shop.controller.js";
import { ShopService } from "./shop.service.js";

/**
 * Loja (TASK-059): catálogo e compra. A entrega do pedido é a TASK-060 e entra aqui depois, usando o
 * mesmo serviço — por isso `ShopService` já é exportado.
 *
 * Os providers de auth se repetem como no `EconomyModule`: `AuthorizeGuard` é usado por `UseGuards` nos
 * controllers deste módulo e precisa ser resolvível no contexto dele.
 */
@Module({})
export class ShopModule {
  static register(env: Env): DynamicModule {
    return {
      module: ShopModule,
      controllers: [ShopController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard, ShopService],
      exports: [ShopService],
    };
  }
}
