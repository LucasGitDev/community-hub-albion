import type { Logger } from "@nestjs/common";

export type Listener<E> = (event: E) => void | Promise<void>;

/** Listeners pós-commit (hooks dos serviços de nick). Erro de um listener é logado e não afeta os outros nem o chamador. */
export class ListenerSet<E> {
  private readonly listeners: Listener<E>[] = [];

  constructor(
    private readonly logger: Pick<Logger, "error">,
    private readonly label: string,
  ) {}

  /** Registra; retorna função pra remover. */
  add(listener: Listener<E>): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async emit(event: E, context: string): Promise<void> {
    for (const listener of [...this.listeners]) {
      try {
        await listener(event);
      } catch (error) {
        this.logger.error(`${this.label} falhou (${context}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
