import { type DynamicModule, type INestApplication, Module } from "@nestjs/common";
import type { Env } from "./config/env.js";
import { AuthModule } from "./auth/auth.module.js";
import { BotModule } from "./bot/bot.module.js";
import { DbModule } from "./db/db.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health/health.controller.js";
import { MembersModule } from "./members/members.module.js";
import type { MemberImporter } from "./members/member-importer.token.js";
import { NickModule } from "./nick/nick.module.js";
import { TemplatesModule } from "./templates/templates.module.js";
import { serveSpa } from "./web/spa.js";

/** Tudo da API fica sob /api; a raiz é da SPA (web/spa.ts). */
export const API_PREFIX = "api";

export interface AppModuleOptions {
  /** false sobe só a API (testes HTTP sem conectar ao Discord). */
  bot: boolean;
  /** Dublê do import de membros (TASK-043): só testes passam, para exercitar o endpoint sem bot. */
  memberImporter?: MemberImporter;
}

@Module({})
export class AppModule {
  static register(env: Env, options: AppModuleOptions = { bot: true }): DynamicModule {
    return {
      module: AppModule,
      imports: [DbModule.register(env.DATABASE_URL), EconomyModule, AuthModule.register(env, options.memberImporter), NickModule.register(env), MembersModule.register(env), TemplatesModule.register(env), EventsModule.register(env), ...(options.bot ? [BotModule.register(env)] : [])],
      controllers: [HealthController],
    };
  }
}

export function configureApp(app: INestApplication, options: { webDistDir?: string } = {}): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  if (options.webDistDir) serveSpa(app, options.webDistDir);
  app.enableShutdownHooks();
  return app;
}
