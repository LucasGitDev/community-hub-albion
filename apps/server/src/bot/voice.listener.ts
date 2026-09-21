import { Inject, Injectable } from "@nestjs/common";
import { Context, type ContextOf, On } from "necord";
import { classifyVoiceUpdate, shouldTrackVoiceMember } from "../domain/voice.js";
import { EventLateSignupService } from "./event-late-signup.service.js";
import { VoiceTrackingService } from "./voice-tracking.service.js";

export const VOICE_GUILD_ID = Symbol("VOICE_GUILD_ID");

type VoiceStateLike = Pick<ContextOf<"voiceStateUpdate">[0], "channelId" | "guild" | "id" | "member">;

@Injectable()
export class VoiceListener {
  constructor(
    private readonly tracking: VoiceTrackingService,
    @Inject(VOICE_GUILD_ID) private readonly guildId: string,
    private readonly lateSignup: EventLateSignupService,
  ) {}

  @On("voiceStateUpdate")
  async onVoiceStateUpdate(@Context() [oldState, newState]: [VoiceStateLike, VoiceStateLike]): Promise<void> {
    const isBot = newState.member?.user.bot ?? oldState.member?.user.bot ?? false;
    if (!shouldTrackVoiceMember({ guildId: newState.guild.id, isBot }, this.guildId)) return;
    const action = classifyVoiceUpdate({ oldChannelId: oldState.channelId, newChannelId: newState.channelId });
    await this.tracking.apply({ discordUserId: newState.id, guildId: newState.guild.id, action });
    // TASK-086: entrar num canal (direto ou vindo de outro) é o gatilho da pergunta. A medição de
    // presença vem primeiro de propósito: a sessão de voz precisa existir antes de alguém aceitar.
    const channelId = action.kind === "join" ? action.channelId : action.kind === "move" ? action.toChannelId : null;
    if (channelId) {
      this.lateSignup.noteArrival({
        discordUserId: newState.id,
        channelId,
        displayName: newState.member?.displayName || oldState.member?.displayName || newState.id,
      });
    }
  }
}
