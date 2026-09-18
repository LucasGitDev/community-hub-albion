import { type DynamicModule, type INestApplication, Module } from "@nestjs/common";
import type { Env } from "./config/env.js";
import { AuthModule } from "./auth/auth.module.js";
import { BotModule } from "./bot/bot.module.js";
import { CleanupModule } from "./cleanup/cleanup.module.js";
import { DbModule } from "./db/db.module.js";
import { EconomyModule } from "./economy/economy.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health/health.controller.js";
import { MaintenanceModule } from "./maintenance/maintenance.module.js";
import { MembersModule } from "./members/members.module.js";
import type { MemberImporter } from "./members/member-importer.token.js";
import { NickModule } from "./nick/nick.module.js";
import { ShopModule } from "./shop/shop.module.js";
import { TemplatesModule } from "./templates/templates.module.js";
import type { TimelinePublisher } from "./domain/timeline.js";
import { TimelineModule } from "./timeline/timeline.module.js";
import { serveSpa } from "./web/spa.js";

/** Tudo da API fica sob /api; a raiz é da SPA (web/spa.ts). */
export const API_PREFIX = "api";

export interface AppModuleOptions {
  /** false sobe só a API (testes HTTP sem conectar ao Discord). */
  bot: boolean;
  /** Dublê do import de membros (TASK-043): só testes passam, para exercitar o endpoint sem bot. */
  memberImporter?: MemberImporter;
  /** Dublê da timeline (TASK-076): testes de integração passam um `FakeTimelinePublisher` para afirmar o que foi publicado. */
  timeline?: TimelinePublisher;
}

@Module({})
export class AppModule {
  static register(env: Env, options: AppModuleOptions = { bot: true }): DynamicModule {
    return {
      module: AppModule,
      imports: [DbModule.register(env.DATABASE_URL), TimelineModule.register(env, { bot: options.bot, publisher: options.timeline }), EconomyModule.register(env), AuthModule.register(env, options.memberImporter), NickModule.register(env), MembersModule.register(env), TemplatesModule.register(env), EventsModule.register(env), ShopModule.register(env), ...(options.bot ? [BotModule.register(env), CleanupModule.register()] : []), ...maintenance(env)],
      controllers: [HealthController],
    };
  }
}

/** Namespace de manutenção só entra na aplicação com MAINTENANCE_TOKEN configurado (TASK-048, AC#5). */
function maintenance(env: Env): DynamicModule[] {
  const module = MaintenanceModule.register(env);
  return module ? [module] : [];
}

export function configureApp(app: INestApplication, options: { webDistDir?: string } = {}): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  if (options.webDistDir) serveSpa(app, options.webDistDir);
  app.enableShutdownHooks();
  return app;
}
