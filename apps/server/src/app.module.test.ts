import "reflect-metadata";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "./app.module.js";
import { parseEnv } from "./config/env.js";
import { DB_HANDLE } from "./db/db.module.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const NO_SPA_DIR = join(tmpdir(), "albion-hub-sem-spa");

function testEnv(databaseUrl = "postgres://albion:albion@localhost:1/none", webDistDir = NO_SPA_DIR) {
  const parsed = parseEnv({
    DISCORD_TOKEN: "a.b.c",
    GUILD_ID: "123456789012345678",
    DATABASE_URL: databaseUrl,
    WEB_DIST_DIR: webDistDir,
    NODE_ENV: "test",
    DISCORD_CLIENT_ID: "223456789012345678",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_MEMBER_ROLE_ID: "323456789012345678",
    PUBLIC_URL: "http://localhost:3000",
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.env;
}

/** Handle falso: `execute` simula banco up/down sem Postgres. */
const fakeHandle = (up: boolean) => ({
  db: { execute: async () => (up ? [{ ok: 1 }] : Promise.reject(new Error("down"))) },
  close: async () => {},
});

async function start(handle?: unknown, databaseUrl?: string, webDistDir?: string): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule.register(testEnv(databaseUrl, webDistDir), { bot: false })] });
  if (handle) builder = builder.overrideProvider(DB_HANDLE).useValue(handle);
  const app = configureApp((await builder.compile()).createNestApplication({ logger: false }));
  await app.init();
  return app;
}

describe("API HTTP (sem Discord)", () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("GET /api/health responde 200 com banco up e bot offline", async () => {
    app = await start(fakeHandle(true));
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", db: "up", bot: "offline" });
  });

  it("GET /api/health responde 503 com banco down", async () => {
    app = await start(fakeHandle(false));
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "degraded", db: "down", bot: "offline" });
  });

  it("rotas fora de /api não pertencem à API", async () => {
    app = await start(fakeHandle(true));
    expect((await request(app.getHttpServer()).get("/health")).status).toBe(404);
  });

  // TASK-002 AC#2: server conecta e consulta usando @albion-hub/db de verdade.
  it.skipIf(!TEST_DATABASE_URL && !process.env.CI)("conecta no Postgres real via @albion-hub/db", async () => {
    if (!TEST_DATABASE_URL) throw new Error("CI sem TEST_DATABASE_URL");
    app = await start(undefined, TEST_DATABASE_URL);
    const response = await request(app.getHttpServer()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.db).toBe("up");
  });

  it("/api continua com a API: rota inexistente dá 404 JSON (TASK-004)", async () => {
    app = await start(fakeHandle(true));
    for (const path of ["/api", "/api/nao-existe", "/api/rota/profunda"]) {
      const missing = await request(app.getHttpServer()).get(path);
      expect(missing.status, path).toBe(404);
      expect(missing.headers["content-type"], path).toContain("application/json");
    }
  });
});
