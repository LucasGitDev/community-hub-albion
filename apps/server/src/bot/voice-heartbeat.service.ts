import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { touchHeartbeat, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { type Clock, VOICE_CLOCK } from "./voice-tracking.service.js";

export const VOICE_HEARTBEAT_INTERVAL_MS = Symbol("VOICE_HEARTBEAT_INTERVAL_MS");
/** Q30: heartbeat de 1 minuto. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

/** Atualiza last_heartbeat_at das sessões abertas a cada intervalo (TASK-019). Nunca lança no timer. */
@Injectable()
export class VoiceHeartbeatService implements OnApplicationShutdown {
  private readonly logger = new Logger("VoiceHeartbeat");
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(VOICE_CLOCK) private readonly clock: Clock,
    @Inject(VOICE_HEARTBEAT_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  /** Idempotente: chamar de novo não cria segundo timer. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  /** Um batimento. Pula se o anterior ainda não terminou (banco lento não empilha updates). */
  async beat(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await touchHeartbeat(this.handle.db, this.clock());
    } catch (error) {
      this.logger.error(`Falha no heartbeat de voz: ${String(error)}`);
    } finally {
      this.inFlight = false;
    }
  }
}
