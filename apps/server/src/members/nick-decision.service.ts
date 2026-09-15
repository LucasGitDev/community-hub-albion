import { Inject, Injectable, Logger } from "@nestjs/common";
import { decideNickRequest, type DbHandle, type NickDecision, type NickRequest } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";

/** Evento emitido depois que a decisão foi gravada (TASK-014 aplica apelido/cargo no Discord). */
export interface NickDecidedEvent {
  decision: NickDecision;
  request: NickRequest;
  /** Nick vigente antes da decisão (null = primeira aprovação, TASK-014 concede cargo Membro). */
  previousGameNick: string | null;
  deciderUserId: string;
}

export type NickDecidedListener = (event: NickDecidedEvent) => void | Promise<void>;

export type NickDecisionResult = { ok: true; request: NickRequest } | { ok: false; reason: "not_found" | "not_pending" };

/**
 * Único ponto de decisão de nick (doc-002): painel staff (TASK-013) e botões do embed (TASK-015) chamam este serviço.
 * Listeners rodam após o commit; falha de listener é logada e não desfaz a decisão (TASK-014 AC#3).
 */
@Injectable()
export class NickDecisionService {
  private readonly logger = new Logger(NickDecisionService.name);
  private readonly listeners: NickDecidedListener[] = [];

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Registra um listener (ex.: módulo do bot no onModuleInit). Retorna função pra remover. */
  onDecided(listener: NickDecidedListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  approve(requestId: string, deciderUserId: string, note: string | null = null): Promise<NickDecisionResult> {
    return this.decide(requestId, "approved", deciderUserId, note);
  }

  /** Motivo obrigatório: validado no chamador (validateRejectionNote) e exigido aqui. */
  reject(requestId: string, deciderUserId: string, note: string): Promise<NickDecisionResult> {
    if (!note.trim()) throw new Error("Recusa exige motivo.");
    return this.decide(requestId, "rejected", deciderUserId, note.trim());
  }

  private async decide(requestId: string, decision: NickDecision, deciderUserId: string, note: string | null): Promise<NickDecisionResult> {
    const result = await decideNickRequest(this.handle.db, { requestId, decision, deciderUserId, note });
    if (!result.ok) return result;
    const event: NickDecidedEvent = { decision, request: result.request, previousGameNick: result.previousGameNick, deciderUserId };
    for (const listener of [...this.listeners]) {
      try {
        await listener(event);
      } catch (error) {
        this.logger.error(`Listener de decisão de nick falhou (request ${requestId}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ok: true, request: result.request };
  }
}
