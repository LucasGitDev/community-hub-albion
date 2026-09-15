import { Inject, Injectable, Logger } from "@nestjs/common";
import { decideNickRequest, type DbHandle, type NickDecision, type NickRequest } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { ListenerSet } from "./listener-set.js";

/** Evento emitido depois que a decisão foi gravada (TASK-014 aplica apelido/cargo no Discord). */
export interface NickDecidedEvent {
  decision: NickDecision;
  request: NickRequest;
  /** Nick vigente antes da decisão (null = primeira aprovação). Informativo: cargo Membro vem em toda aprovação (TASK-034). */
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
  private readonly listeners = new ListenerSet<NickDecidedEvent>(this.logger, "Listener de decisão de nick");

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** Registra um listener (ex.: módulo do bot no onModuleInit). Retorna função pra remover. */
  onDecided(listener: NickDecidedListener): () => void {
    return this.listeners.add(listener);
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
    await this.listeners.emit(event, `request ${requestId}`);
    return { ok: true, request: result.request };
  }
}
