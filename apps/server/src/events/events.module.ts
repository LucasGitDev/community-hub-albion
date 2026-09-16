import { type DynamicModule, Module, type OnApplicationBootstrap } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { DEFAULT_SIGNUPS_CLOSE_INTERVAL_MS, EVENTS_CLOCK, EventSignupsCloseService, SIGNUPS_CLOSE_INTERVAL_MS } from "./events-signups-close.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

/**
 * Eventos e máquina de estados (TASK-021). Global e exportando `EventsService` porque TASK-022 (embed)
 * e TASK-024 (canal de voz) assinam `onEventTransition` sem que este módulo precise mudar.
 */
@Module({})
export class EventsModule implements OnApplicationBootstrap {
  constructor(private readonly signupsClose: EventSignupsCloseService) {}

  static register(env: Env): DynamicModule {
    return {
      module: EventsModule,
      global: true,
      controllers: [EventsController],
      providers: [
        { provide: AUTH_ENV, useValue: env },
        SessionService,
        AuthorizeGuard,
        SameOriginGuard,
        EventsService,
        EventSignupsCloseService,
        { provide: EVENTS_CLOCK, useValue: () => new Date() },
        { provide: SIGNUPS_CLOSE_INTERVAL_MS, useValue: DEFAULT_SIGNUPS_CLOSE_INTERVAL_MS },
      ],
      exports: [EventsService],
    };
  }

  /** Liga o fechamento automático de inscrições quando a aplicação sobe (AC#5). */
  onApplicationBootstrap(): void {
    this.signupsClose.start();
  }
}
