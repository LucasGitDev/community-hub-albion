import { type DynamicModule, Logger, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { FetchAlbionPlayerLookup } from "../domain/albion-lookup.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { AccountService } from "./account.service.js";
import { AlbionCheckService } from "./albion-check.service.js";
import { NickDecisionService } from "./nick-decision.service.js";
import { NickRegistrationService } from "./nick-registration.service.js";
import { NickRequestService } from "./nick-request.service.js";
import { StaffNickRequestsController } from "./staff-nick-requests.controller.js";

/** Entrada de membros pela staff (TASK-013). Exporta os serviços de pedido/decisão (com hooks) para bot/embed (TASK-014/015). */
@Module({})
export class MembersModule {
  static register(env: Env): DynamicModule {
    return {
      module: MembersModule,
      global: true,
      controllers: [StaffNickRequestsController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard,
        AccountService,
        AlbionCheckService,
        NickDecisionService,
        NickRequestService,
        NickRegistrationService,
        { provide: ALBION_PLAYER_LOOKUP, useFactory: () => new FetchAlbionPlayerLookup({
            region: env.ALBION_REGION,
            onUnavailable: (reason) => new Logger("AlbionPlayerLookup").warn(`API do Albion indisponível: ${reason}`),
          }) },
      ],
      exports: [AccountService, AlbionCheckService, NickDecisionService, NickRequestService, NickRegistrationService, ALBION_PLAYER_LOOKUP],
    };
  }
}
