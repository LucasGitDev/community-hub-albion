import { type DynamicModule, type INestApplication, Module } from "@nestjs/common";
import type { Env } from "./config/env.js";
import { BotModule } from "./bot/bot.module.js";
import { HealthController } from "./health/health.controller.js";

/** Tudo da API fica sob /api; a raiz fica livre para a SPA (TASK-004). */
export const API_PREFIX = "api";

export interface AppModuleOptions {
  /** false sobe só a API (testes HTTP sem conectar ao Discord). */
  bot: boolean;
}

@Module({})
export class AppModule {
  static register(env: Env, options: AppModuleOptions = { bot: true }): DynamicModule {
    return {
      module: AppModule,
      imports: options.bot ? [BotModule.register(env)] : [],
      controllers: [HealthController],
    };
  }
}

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
