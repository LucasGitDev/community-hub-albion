import { type DynamicModule, Module } from "@nestjs/common";
import { IntentsBitField } from "discord.js";
import { NecordModule } from "necord";
import type { Env } from "../config/env.js";
import { PingCommand } from "./ping.command.js";
import { ReadyListener } from "./ready.listener.js";
import { VOICE_CLOCK, VoiceTrackingService } from "./voice-tracking.service.js";
import { VOICE_GUILD_ID, VoiceListener } from "./voice.listener.js";

@Module({})
export class BotModule {
  static register(env: Pick<Env, "DISCORD_TOKEN" | "GUILD_ID">): DynamicModule {
    return {
      module: BotModule,
      imports: [
        NecordModule.forRoot({
          token: env.DISCORD_TOKEN,
          // GuildVoiceStates: join/leave/move em voz (TASK-018).
          intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildVoiceStates],
          // Single guild (Q4): comandos registrados só na GUILD_ID, nunca globais.
          development: [env.GUILD_ID],
        }),
      ],
      providers: [
        PingCommand,
        ReadyListener,
        VoiceListener,
        VoiceTrackingService,
        { provide: VOICE_CLOCK, useValue: () => new Date() },
        { provide: VOICE_GUILD_ID, useValue: env.GUILD_ID },
      ],
    };
  }
}
