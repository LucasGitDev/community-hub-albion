import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { MaintenanceController } from "./maintenance.controller.js";
import { MaintenanceTokenGuard } from "./maintenance-token.guard.js";
import { MAINTENANCE_ENV } from "./maintenance.tokens.js";

/**
 * Namespace de manutenção (TASK-048). `register` devolve `null` quando `MAINTENANCE_TOKEN` não está no
 * env: o `AppModule` então não importa nada e **nenhuma rota de /api/maintenance existe** (AC#5).
 *
 * Desligar aqui, e não dentro do guard, é de propósito: enquanto o segredo não estiver configurado não há
 * controller instanciado, nem handler no roteador, nem superfície para sondar. Não existe default para o
 * token e não existe fallback — a única forma de ligar estas rotas é alguém escolher um segredo.
 */
@Module({})
export class MaintenanceModule {
  static register(env: Env): DynamicModule | null {
    if (!env.MAINTENANCE_TOKEN) return null;
    return {
      module: MaintenanceModule,
      controllers: [MaintenanceController],
      providers: [{ provide: MAINTENANCE_ENV, useValue: env }, MaintenanceTokenGuard],
    };
  }
}
