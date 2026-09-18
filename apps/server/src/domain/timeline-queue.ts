import { DISCORD_EMBED_LIMITS, embedSize, type TimelineEmbed } from "./timeline.js";

/**
 * Fila em memória da timeline (TASK-076, T11/T12): sem Redis e sem BullMQ. Agrupa até 10 embeds por
 * mensagem (T10), respeita a janela do Discord (cerca de 5 mensagens a cada 5 s por canal) e entrega
 * na ordem em que os registros chegaram. Reiniciar com a fila cheia perde essas linhas — aceito (T11).
 *
 * Nada aqui propaga erro para quem publicou: `push` é síncrono e barato, a entrega roda em segundo
 * plano, e falha do envio vira log (T6).
 */
export interface TimelineQueueOptions {
  /** Envia uma mensagem com os embeds do lote. Pode rejeitar: a fila loga e segue. */
  send(embeds: TimelineEmbed[]): Promise<void>;
  /** Aviso operacional (falha de envio, registros descartados). */
  warn(message: string): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxEmbedsPerMessage?: number;
  maxCharsPerMessage?: number;
  maxMessagesPerWindow?: number;
  windowMs?: number;
  /** Teto de memória: acima disso o registro novo é descartado (a ordem dos que ficaram se mantém). */
  maxQueued?: number;
}

const TIMELINE_QUEUE_DEFAULTS = {
  maxEmbedsPerMessage: 10,
  maxCharsPerMessage: DISCORD_EMBED_LIMITS.total,
  maxMessagesPerWindow: 5,
  windowMs: 5_000,
  maxQueued: 1_000,
} as const;

export class TimelineQueue {
  private readonly pending: TimelineEmbed[] = [];
  private readonly sentAt: number[] = [];
  private running: Promise<void> | null = null;
  private dropped = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limits: Required<Omit<TimelineQueueOptions, "send" | "warn" | "now" | "sleep">>;

  constructor(private readonly options: TimelineQueueOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limits = {
      maxEmbedsPerMessage: options.maxEmbedsPerMessage ?? TIMELINE_QUEUE_DEFAULTS.maxEmbedsPerMessage,
      maxCharsPerMessage: options.maxCharsPerMessage ?? TIMELINE_QUEUE_DEFAULTS.maxCharsPerMessage,
      maxMessagesPerWindow: options.maxMessagesPerWindow ?? TIMELINE_QUEUE_DEFAULTS.maxMessagesPerWindow,
      windowMs: options.windowMs ?? TIMELINE_QUEUE_DEFAULTS.windowMs,
      maxQueued: options.maxQueued ?? TIMELINE_QUEUE_DEFAULTS.maxQueued,
    };
  }

  get size(): number {
    return this.pending.length;
  }

  /** Enfileira e volta na hora. A entrega começa no próximo ciclo, o que junta uma rajada num lote só. */
  push(embed: TimelineEmbed): void {
    if (this.pending.length >= this.limits.maxQueued) {
      this.dropped++;
      return;
    }
    this.pending.push(embed);
    this.kick();
  }

  private kick(): void {
    if (this.running) return;
    this.running = this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.running = null;
        // Chegou registro entre o fim do laço e este ponto: não pode ficar parado na fila.
        if (this.pending.length > 0) this.kick();
      });
  }

  /** Espera a fila esvaziar (testes e desligamento). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await this.sleep(0);
    while (this.pending.length > 0) {
      await this.waitForWindow();
      const batch = this.takeBatch();
      this.sentAt.push(this.now());
      try {
        await this.options.send(batch);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.options.warn(`Timeline: falha ao publicar ${batch.length} registro(s) no Discord; seguem perdidos (${reason})`);
      }
    }
    if (this.dropped > 0) {
      this.options.warn(`Timeline: fila cheia, ${this.dropped} registro(s) descartado(s)`);
      this.dropped = 0;
    }
  }

  /** Janela deslizante: com N envios nos últimos `windowMs`, espera o mais antigo sair da janela. */
  private async waitForWindow(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.sentAt.length > 0 && now - this.sentAt[0] >= this.limits.windowMs) this.sentAt.shift();
      if (this.sentAt.length < this.limits.maxMessagesPerWindow) return;
      await this.sleep(this.limits.windowMs - (now - this.sentAt[0]));
    }
  }

  /** Pega do início da fila (ordem preservada) até 10 embeds sem passar dos 6000 caracteres somados. */
  private takeBatch(): TimelineEmbed[] {
    const batch: TimelineEmbed[] = [];
    let chars = 0;
    while (this.pending.length > 0 && batch.length < this.limits.maxEmbedsPerMessage) {
      const size = embedSize(this.pending[0]);
      if (batch.length > 0 && chars + size > this.limits.maxCharsPerMessage) break;
      batch.push(this.pending.shift()!);
      chars += size;
    }
    return batch;
  }
}
