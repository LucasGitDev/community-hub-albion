import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { GUILD_CLEANUP_HOUR, nextGuildCleanupRun } from "@albion-hub/shared";
import { GUILD_CLEANUP_CLOCK, GuildCleanupService, type Clock } from "./guild-cleanup.service.js";

export const GUILD_CLEANUP_TICK_MS = Symbol("GUILD_CLEANUP_TICK_MS");
/** Passo curto do relógio. A limpeza é diária; o tique só pergunta "já passou das 4h?". */
export const DEFAULT_GUILD_CLEANUP_TICK_MS = 5 * 60_000;

/**
 * Agendamento da limpeza diária (TASK-049, AC#1), no mesmo processo do bot e da API — sem cron externo
 * nem dependência nova, igual ao heartbeat de voz (TASK-019) e ao fechamento de inscrições.
 *
 * Um `setInterval` curto comparando o relógio com o próximo horário, e não um `setTimeout` de 24h: o
 * processo pode ser reiniciado, suspenso ou ter o relógio ajustado, e um timer longo perderia a
 * madrugada em silêncio. Perder uma passada não é grave (a de amanhã faz o mesmo), mas *achar* que
 * rodou seria.
 */
@Injectable()
export class GuildCleanupScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger("GuildCleanupScheduler");
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextRunAt: Date | null = null;

  constructor(
    @Inject(GuildCleanupService) private readonly cleanup: GuildCleanupService,
    @Inject(GUILD_CLEANUP_CLOCK) private readonly clock: Clock,
    @Inject(GUILD_CLEANUP_TICK_MS) private readonly tickMs: number,
  ) {}

  /** Idempotente: chamar de novo não cria segundo timer nem antecipa a passada. */
  start(): void {
    if (this.timer) return;
    this.nextRunAt ??= nextGuildCleanupRun(this.clock());
    this.logger.log(`Limpeza diária agendada para ${this.nextRunAt.toISOString()} (${GUILD_CLEANUP_HOUR}h, hora do servidor).`);
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  /** Um tique. A subida do processo **não** dispara limpeza: só o horário dispara. */
  async tick(): Promise<void> {
    const now = this.clock();
    if (!this.nextRunAt || now.getTime() < this.nextRunAt.getTime()) return;
    // O próximo horário é marcado antes de rodar: uma passada lenta não vira duas seguidas.
    this.nextRunAt = nextGuildCleanupRun(now);
    await this.cleanup.run();
  }

  /** Só para teste e diagnóstico: quando a próxima passada está marcada. */
  get scheduledFor(): Date | null {
    return this.nextRunAt;
  }
}
