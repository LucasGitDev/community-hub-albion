import { Controller, Get, Inject, Optional } from "@nestjs/common";
import { Client } from "discord.js";
import { buildHealth, type HealthReport } from "../domain/health.js";

@Controller("health")
export class HealthController {
  constructor(@Optional() @Inject(Client) private readonly client?: Client) {}

  @Get()
  check(): HealthReport {
    return buildHealth(this.client?.isReady() ?? false);
  }
}
