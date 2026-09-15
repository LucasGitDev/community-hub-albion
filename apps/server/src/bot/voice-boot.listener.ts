import { Inject, Injectable, Logger } from "@nestjs/common";
import { Context, type ContextOf, Once } from "necord";
import { type CurrentVoiceState, membersInVoice } from "../domain/voice.js";
import { VoiceHeartbeatService } from "./voice-heartbeat.service.js";
import { VoiceTrackingService } from "./voice-tracking.service.js";
import { VOICE_GUILD_ID } from "./voice.listener.js";

type ClientLike = { guilds: { cache: { get(id: string): GuildLike | undefined } } };
type GuildLike = {
  id: string;
  voiceStates: { cache: { values(): Iterable<{ id: string; channelId: string | null; member: { user: { bot: boolean } } | null }> } };
};

/** Boot (TASK-019, Q30): reconcilia sessões pelo estado atual de voz e só então liga o heartbeat. */
@Injectable()
export class VoiceBootListener {
  private readonly logger = new Logger("VoiceBoot");

  constructor(
    private readonly tracking: VoiceTrackingService,
    private readonly heartbeat: VoiceHeartbeatService,
    @Inject(VOICE_GUILD_ID) private readonly guildId: string,
  ) {}

  @Once("clientReady")
  async onReady(@Context() [client]: ContextOf<"clientReady"> | [ClientLike]): Promise<void> {
    const guild = (client as ClientLike).guilds.cache.get(this.guildId);
    if (!guild) this.logger.warn(`Guild ${this.guildId} não está no cache: reabrindo nenhuma sessão`);
    const states: CurrentVoiceState[] = [...(guild?.voiceStates.cache.values() ?? [])].map((s) => ({
      userId: s.id,
      guildId: guild!.id,
      channelId: s.channelId,
      isBot: s.member?.user.bot,
    }));
    const { closed, opened } = await this.tracking.reconcile(membersInVoice(states, this.guildId));
    this.logger.log(`Reconciliação de voz: ${closed} fechadas no último heartbeat, ${opened} reabertas`);
    this.heartbeat.start();
  }
}
