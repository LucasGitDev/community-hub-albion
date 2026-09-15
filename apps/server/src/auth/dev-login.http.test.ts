import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, runMigrations, type DbHandle } from "@albion-hub/db";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de dev-login não podem ser pulados");

const PUBLIC_URL = "http://localhost:3000";

async function isolatedDb(url: string, suffix: string) {
  const target = new URL(url);
  const name = `${target.pathname.slice(1)}_${suffix}`;
  target.pathname = `/${name}`;
  const admin = createDb(url, { max: 1 });
  await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
  await admin.db.execute(sql.raw(`create database "${name}"`));
  await admin.close();
  await runMigrations(target.toString());
  return target.toString();
}

async function boot(databaseUrl: string, devLogin: boolean): Promise<INestApplication> {
  const parsed = parseEnv({
    DISCORD_TOKEN: "a.b.c",
    GUILD_ID: "123456789012345678",
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    DISCORD_CLIENT_ID: "223456789012345678",
    DISCORD_CLIENT_SECRET: "secret",
    PUBLIC_URL,
    AUTH_DEV_LOGIN: String(devLogin),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.listen(0, "127.0.0.1");
  return app;
}

describe.skipIf(!baseUrl)("dev-login (TASK-010, só dev/e2e)", () => {
  let enabled: INestApplication;
  let disabled: INestApplication;
  let handle: DbHandle;

  beforeAll(async () => {
    const url = await isolatedDb(baseUrl!, "server_devlogin");
    handle = createDb(url);
    enabled = await boot(url, true);
    disabled = await boot(url, false);
  }, 60_000);

  afterAll(async () => {
    await enabled?.close();
    await disabled?.close();
    await handle?.close();
  });

  const body = { discordId: "400000000000000001", username: "grimwald", roles: ["staff"] };

  it("desligado: rota não existe (404)", async () => {
    const res = await request(disabled.getHttpServer()).post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send(body);
    expect(res.status).toBe(404);
  });

  it("ligado: cria sessão com papéis pedidos + member, e /me reflete", async () => {
    const res = await request(enabled.getHttpServer()).post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send(body);
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ah_session="))!;
    expect(cookie).toMatch(/HttpOnly/);
    const me = await request(enabled.getHttpServer()).get("/api/auth/me").set("Cookie", cookie.split(";")[0]);
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(["member", "staff"]);
    expect(me.body.user.username).toBe("grimwald");
  });

  it("recusa outra origem (403) e corpo inválido (400)", async () => {
    const cross = await request(enabled.getHttpServer()).post("/api/auth/dev-login").set("Origin", "https://evil.example").send(body);
    expect(cross.status).toBe(403);
    const bad = await request(enabled.getHttpServer()).post("/api/auth/dev-login").set("Origin", PUBLIC_URL).send({ ...body, roles: ["dono"] });
    expect(bad.status).toBe(400);
  });
});
