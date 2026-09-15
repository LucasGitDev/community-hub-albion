import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AdminUsersController } from "../admin/admin-users.controller.js";
import { AUTH_ENV, AuthController } from "./auth.controller.js";
import { AuthorizeGuard } from "./authorize.js";
import { DevLoginController } from "./dev-login.controller.js";
import { RolesController } from "./roles.controller.js";
import { SameOriginGuard } from "./same-origin.guard.js";
import { SessionService } from "./session.service.js";
import { DISCORD_OAUTH_CLIENT, FetchDiscordOAuthClient } from "./discord-oauth.client.js";

@Module({})
export class AuthModule {
  static register(env: Env): DynamicModule {
    return {
      module: AuthModule,
      // Dev login só existe quando habilitado (env proíbe em produção).
      controllers: [AuthController, RolesController, AdminUsersController, ...(env.AUTH_DEV_LOGIN ? [DevLoginController] : [])],
      providers: [
        { provide: AUTH_ENV, useValue: env },
        SessionService,
        AuthorizeGuard,
        SameOriginGuard,
        { provide: DISCORD_OAUTH_CLIENT, useValue: new FetchDiscordOAuthClient({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }) },
      ],
      exports: [SessionService, AuthorizeGuard],
    };
  }
}
