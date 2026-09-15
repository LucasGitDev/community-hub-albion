import { Inject, Injectable, Logger } from "@nestjs/common";
import { closeVoiceSession, openVoiceSession, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import type { VoiceAction } from "../domain/voice.js";

export const VOICE_CLOCK = Symbol("VOICE_CLOCK");
export type Clock = () => Date;

export interface VoiceUpdate {
  discordUserId: string;
  guildId: string;
  action: VoiceAction;
}

/** Aplica ações de voz classificadas em voice_sessions (TASK-018). Nunca lança: erro é logado. */
@Injectable()
export class VoiceTrackingService {
  private readonly logger = new Logger("VoiceTracking");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(VOICE_CLOCK) private readonly clock: Clock,
  ) {}

  async apply(update: VoiceUpdate): Promise<void> {
    const { action, discordUserId, guildId } = update;
    if (action.kind === "noop") return;
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
}
