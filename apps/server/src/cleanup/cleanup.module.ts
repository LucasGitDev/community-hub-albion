import { Module, type DynamicModule, type OnApplicationBootstrap } from "@nestjs/common";
import { MAINTENANCE_CLEANUP } from "../maintenance/maintenance.tokens.js";
import { GUILD_CLEANUP_CLOCK, GuildCleanupService } from "./guild-cleanup.service.js";
import { DEFAULT_GUILD_CLEANUP_TICK_MS, GUILD_CLEANUP_TICK_MS, GuildCleanupScheduler } from "./guild-cleanup.scheduler.js";

/**
 * Limpeza diária de quem saiu do servidor (TASK-049).
 *
 * Global e exportando `MAINTENANCE_CLEANUP`: é exatamente o encaixe que a TASK-048 deixou pronto, então
 * `POST /api/maintenance/cleanup` passa a funcionar sem nenhuma mudança no namespace de manutenção.
 *
 * Só entra na aplicação com o bot ligado, porque a passada depende de perguntar ao Discord quem ainda
 * está na guild. Sem bot (testes de API, e2e) não há provider, e a rota de manutenção responde o mesmo
 * 503 honesto de antes — melhor do que uma limpeza que adivinha a lista de membros.
 */
@Module({})
export class CleanupModule implements OnApplicationBootstrap {
  constructor(private readonly scheduler: GuildCleanupScheduler) {}

  static register(): DynamicModule {
    return {
      module: CleanupModule,
      global: true,
      providers: [
        GuildCleanupService,
        GuildCleanupScheduler,
        { provide: GUILD_CLEANUP_CLOCK, useValue: () => new Date() },
        { provide: GUILD_CLEANUP_TICK_MS, useValue: DEFAULT_GUILD_CLEANUP_TICK_MS },
        { provide: MAINTENANCE_CLEANUP, useExisting: GuildCleanupService },
      ],
      exports: [MAINTENANCE_CLEANUP, GuildCleanupService],
    };
  }

  /** Liga o relógio quando a aplicação sobe (AC#1). */
  onApplicationBootstrap(): void {
    this.scheduler.start();
  }
}
