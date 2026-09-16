import { type DynamicModule, Module } from "@nestjs/common";
import { IntentsBitField } from "discord.js";
import { NecordModule } from "necord";
import type { Env } from "../config/env.js";
import { DISCORD_GUILD_GATEWAY, DISCORD_GUILD_ID, DiscordJsGuildGateway } from "./discord-guild.gateway.js";
import { DISCORD_MEMBER_ROLE_ID, DiscordMemberSync } from "./discord-member-sync.service.js";
import { EventEmbedService } from "./event-embed.service.js";
import { EventSignupInteractions } from "./event-signup.interactions.js";
import { DISCORD_EVENTS_CHANNEL_ID, DiscordJsEventsChannelGateway, EVENTS_CHANNEL_GATEWAY } from "./events-channel.gateway.js";
import { NickEmbedInteractions } from "./nick-embed.interactions.js";
import { NickStaffEmbedService } from "./nick-staff-embed.service.js";
import { PingCommand } from "./ping.command.js";
import { RegisterNickCommand } from "./register-nick.command.js";
import { ReadyListener } from "./ready.listener.js";
import { DISCORD_STAFF_CHANNEL_ID, DiscordJsStaffChannelGateway, STAFF_CHANNEL_GATEWAY } from "./staff-channel.gateway.js";
import { VoiceBootListener } from "./voice-boot.listener.js";
import { DEFAULT_HEARTBEAT_INTERVAL_MS, VOICE_HEARTBEAT_INTERVAL_MS, VoiceHeartbeatService } from "./voice-heartbeat.service.js";
import { VOICE_CLOCK, VoiceTrackingService } from "./voice-tracking.service.js";
import { VOICE_GUILD_ID, VoiceListener } from "./voice.listener.js";

@Module({})
export class BotModule {
  static register(env: Pick<Env, "DISCORD_TOKEN" | "GUILD_ID" | "DISCORD_MEMBER_ROLE_ID" | "DISCORD_STAFF_CHANNEL_ID" | "DISCORD_EVENTS_CHANNEL_ID">): DynamicModule {
    if (!env.DISCORD_MEMBER_ROLE_ID) throw new Error("DISCORD_MEMBER_ROLE_ID obrigatória com o bot ligado");
    if (!env.DISCORD_STAFF_CHANNEL_ID) throw new Error("DISCORD_STAFF_CHANNEL_ID obrigatória com o bot ligado");
    if (!env.DISCORD_EVENTS_CHANNEL_ID) throw new Error("DISCORD_EVENTS_CHANNEL_ID obrigatória com o bot ligado");
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
        VoiceHeartbeatService,
        VoiceBootListener,
        { provide: VOICE_HEARTBEAT_INTERVAL_MS, useValue: DEFAULT_HEARTBEAT_INTERVAL_MS },
        { provide: VOICE_CLOCK, useValue: () => new Date() },
        { provide: VOICE_GUILD_ID, useValue: env.GUILD_ID },
        // TASK-014: apelido + cargo Membro na aprovação de nick.
        { provide: DISCORD_GUILD_ID, useValue: env.GUILD_ID },
        { provide: DISCORD_GUILD_GATEWAY, useClass: DiscordJsGuildGateway },
        { provide: DISCORD_MEMBER_ROLE_ID, useValue: env.DISCORD_MEMBER_ROLE_ID },
        DiscordMemberSync,
        // TASK-015: embed do pedido de nick com botões no canal da staff.
        { provide: DISCORD_STAFF_CHANNEL_ID, useValue: env.DISCORD_STAFF_CHANNEL_ID },
        { provide: STAFF_CHANNEL_GATEWAY, useClass: DiscordJsStaffChannelGateway },
        NickStaffEmbedService,
        NickEmbedInteractions,
        // TASK-035: /registrar nick pelo Discord (mesmo serviço do painel).
        RegisterNickCommand,
        // TASK-022: embed de inscrição do evento com botão por role e lista de espera.
        { provide: DISCORD_EVENTS_CHANNEL_ID, useValue: env.DISCORD_EVENTS_CHANNEL_ID },
        { provide: EVENTS_CHANNEL_GATEWAY, useClass: DiscordJsEventsChannelGateway },
        EventEmbedService,
        EventSignupInteractions,
      ],
    };
  }
}
