import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { EventsService } from "./events.service.js";

export const EVENTS_CLOCK = Symbol("EVENTS_CLOCK");
export const SIGNUPS_CLOSE_INTERVAL_MS = Symbol("SIGNUPS_CLOSE_INTERVAL_MS");
/** 30s: granularidade boa o bastante para um horário marcado e barata (índice parcial só nos `open`). */
export const DEFAULT_SIGNUPS_CLOSE_INTERVAL_MS = 30_000;

export type Clock = () => Date;

/**
 * Fecha a inscrição dos eventos cujo `signups_close_at` venceu (AC#5). Não conhece Discord: quem quiser
 * reagir assina `EventsService.onEventTransition`. Idempotente (o próprio filtro por estado garante) e
 * sem empilhar passadas: se o banco estiver lento, a próxima é pulada.
 */
@Injectable()
export class EventSignupsCloseService implements OnApplicationShutdown {
  private readonly logger = new Logger("EventSignupsClose");
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(EVENTS_CLOCK) private readonly clock: Clock,
    @Inject(SIGNUPS_CLOSE_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  /** Idempotente: chamar de novo não cria segundo timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  /** Uma passada. Nunca lança: erro de banco vira log e a próxima passada tenta de novo. */
  async sweep(): Promise<number> {
    if (this.inFlight) return 0;
    this.inFlight = true;
    try {
      const closed = await this.events.closeDue(this.clock());
      if (closed.length > 0) this.logger.log(`Inscrições fechadas no horário: ${closed.map((e) => e.name).join(", ")}`);
      return closed.length;
    } catch (error) {
      this.logger.error(`Falha ao fechar inscrições no horário: ${String(error)}`);
      return 0;
    } finally {
      this.inFlight = false;
    }
  }
}
