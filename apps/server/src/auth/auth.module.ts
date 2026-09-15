import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV, AuthController } from "./auth.controller.js";
import { DISCORD_OAUTH_CLIENT, FetchDiscordOAuthClient } from "./discord-oauth.client.js";

@Module({})
export class AuthModule {
  static register(env: Env): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_ENV, useValue: env },
        { provide: DISCORD_OAUTH_CLIENT, useValue: new FetchDiscordOAuthClient({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }) },
      ],
    };
  }
}
