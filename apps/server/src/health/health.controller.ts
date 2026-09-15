import { Controller, Get, Inject, Optional, Res } from "@nestjs/common";
import { ping, type DbHandle } from "@albion-hub/db";
import { Client } from "discord.js";
import type { Response } from "express";
import { DB_HANDLE } from "../db/db.module.js";
import { buildHealth, type HealthReport } from "../domain/health.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(Client) private readonly client?: Client,
  ) {}

  /** 200 com banco up, 503 com banco down (healthcheck do Docker usa o status). */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = buildHealth({ dbUp: await ping(this.handle.db), botReady: this.client?.isReady() ?? false });
    res.status(report.status === "ok" ? 200 : 503);
    return report;
  }
}
