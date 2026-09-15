import { Inject, Injectable } from "@nestjs/common";
import { Context, type ContextOf, On } from "necord";
import { classifyVoiceUpdate, shouldTrackVoiceMember } from "../domain/voice.js";
import { VoiceTrackingService } from "./voice-tracking.service.js";

export const VOICE_GUILD_ID = Symbol("VOICE_GUILD_ID");

type VoiceStateLike = Pick<ContextOf<"voiceStateUpdate">[0], "channelId" | "guild" | "id" | "member">;

@Injectable()
export class VoiceListener {
  constructor(
    private readonly tracking: VoiceTrackingService,
    @Inject(VOICE_GUILD_ID) private readonly guildId: string,
  ) {}

  @On("voiceStateUpdate")
  async onVoiceStateUpdate(@Context() [oldState, newState]: [VoiceStateLike, VoiceStateLike]): Promise<void> {
    const isBot = newState.member?.user.bot ?? oldState.member?.user.bot ?? false;
    if (!shouldTrackVoiceMember({ guildId: newState.guild.id, isBot }, this.guildId)) return;
    const action = classifyVoiceUpdate({ oldChannelId: oldState.channelId, newChannelId: newState.channelId });
    await this.tracking.apply({ discordUserId: newState.id, guildId: newState.guild.id, action });
  }
}
