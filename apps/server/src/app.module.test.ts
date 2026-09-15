import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "./app.module.js";
import { parseEnv } from "./config/env.js";

describe("API HTTP (sem Discord)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const parsed = parseEnv({ DISCORD_TOKEN: "a.b.c", GUILD_ID: "123456789012345678", NODE_ENV: "test" });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health responde 200 com bot offline", async () => {
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", bot: "offline" });
  });

  it("rotas fora de /api não pertencem à API", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(404);
  });
});
