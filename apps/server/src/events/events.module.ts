import { type DynamicModule, Module, type OnApplicationBootstrap } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { DEFAULT_SIGNUPS_CLOSE_INTERVAL_MS, EVENTS_CLOCK, EventSignupsCloseService, SIGNUPS_CLOSE_INTERVAL_MS } from "./events-signups-close.service.js";
import { EventSignupsController } from "./event-signups.controller.js";
import { EventSignupsService } from "./event-signups.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

/**
 * Eventos, máquina de estados (TASK-021) e inscrição por role (TASK-022). Global e exportando os dois
 * serviços porque o bot assina `onEventTransition`/`onSignupChanged` para manter o embed em dia e
 * TASK-024 (canal de voz) assina as transições sem que este módulo precise mudar.
 */
@Module({})
export class EventsModule implements OnApplicationBootstrap {
  constructor(private readonly signupsClose: EventSignupsCloseService) {}

  static register(env: Env): DynamicModule {
    return {
      module: EventsModule,
      global: true,
      controllers: [EventsController, EventSignupsController],
      providers: [
        { provide: AUTH_ENV, useValue: env },
        SessionService,
        AuthorizeGuard,
        SameOriginGuard,
        EventsService,
        EventSignupsService,
        EventSignupsCloseService,
        { provide: EVENTS_CLOCK, useValue: () => new Date() },
        { provide: SIGNUPS_CLOSE_INTERVAL_MS, useValue: DEFAULT_SIGNUPS_CLOSE_INTERVAL_MS },
      ],
      exports: [EventsService, EventSignupsService],
    };
  }

  /** Liga o fechamento automático de inscrições quando a aplicação sobe (AC#5). */
  onApplicationBootstrap(): void {
    this.signupsClose.start();
  }
}
