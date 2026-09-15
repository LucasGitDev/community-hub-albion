import { Inject, Injectable, Logger } from "@nestjs/common";
import { closeStaleSessionsAtHeartbeat, closeVoiceSession, openVoiceSession, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import type { MemberInVoice, VoiceAction } from "../domain/voice.js";

export const VOICE_CLOCK = Symbol("VOICE_CLOCK");
export type Clock = () => Date;

export interface VoiceUpdate {
  discordUserId: string;
  guildId: string;
  action: VoiceAction;
}

export interface ReconcileResult {
  closed: number;
  opened: number;
}

/** Aplica ações de voz classificadas em voice_sessions (TASK-018/019). Nunca lança: erro é logado. */
@Injectable()
export class VoiceTrackingService {
  private readonly logger = new Logger("VoiceTracking");
  /** Reconciliação em curso: eventos de voz esperam ela terminar para manter a ordem (TASK-019). */
  private reconciling: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(VOICE_CLOCK) private readonly clock: Clock,
  ) {}

  async apply(update: VoiceUpdate): Promise<void> {
    const { action, discordUserId, guildId } = update;
    if (action.kind === "noop") return;
    await this.reconciling;
    const at = this.clock();
    try {
      if (action.kind === "leave") {
        await closeVoiceSession(this.handle.db, discordUserId, at);
      } else {
        // join e move: openVoiceSession fecha a anterior e abre a nova na mesma transação.
        const channelId = action.kind === "join" ? action.channelId : action.toChannelId;
        await openVoiceSession(this.handle.db, { discordUserId, guildId, channelId, at });
      }
    } catch (error) {
      this.logger.error(`Falha ao registrar ${action.kind} de voz de ${discordUserId}: ${String(error)}`);
    }
  }

  /**
   * Reconciliação no boot (Q30): fecha toda sessão aberta no último heartbeat (perde no máximo ~1 min)
   * e abre sessão nova em `now` para quem está em voz. Eventos `apply` que chegam durante a reconciliação
   * aguardam o fim dela, então são aplicados depois e por cima do snapshot (ordem preservada).
   */
  reconcile(members: readonly MemberInVoice[]): Promise<ReconcileResult> {
    const run = this.doReconcile(members);
    this.reconciling = run;
    return run;
  }

  private async doReconcile(members: readonly MemberInVoice[]): Promise<ReconcileResult> {
    const result: ReconcileResult = { closed: 0, opened: 0 };
    try {
      result.closed = await closeStaleSessionsAtHeartbeat(this.handle.db);
    } catch (error) {
      this.logger.error(`Falha ao fechar sessões abertas no boot: ${String(error)}`);
    }
    const at = this.clock();
    for (const m of members) {
      try {
        await openVoiceSession(this.handle.db, { ...m, at });
        result.opened++;
      } catch (error) {
        this.logger.error(`Falha ao reabrir sessão de voz de ${m.discordUserId}: ${String(error)}`);
      }
    }
    return result;
  }
}
