import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_PREFIX, AppModule, configureApp } from "./app.module.js";
import { applyMigrationsOrExit } from "./boot/migrations.js";
import { parseEnv } from "./config/env.js";

async function bootstrap() {
  // Valida config antes de qualquer conexão (AC#4).
  const parsed = parseEnv(process.env);
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exit(1);
  }
  const { env } = parsed;
  if (env.RUN_MIGRATIONS) await applyMigrationsOrExit(env.DATABASE_URL);
  // Login no Discord acontece no bootstrap do Nest: token recusado derruba o boot (fail fast).
  const app = configureApp(await NestFactory.create(AppModule.register(env, { bot: env.DISCORD_BOT_ENABLED })), { webDistDir: env.WEB_DIST_DIR });
  await app.listen(env.PORT);
  const logger = new Logger("Bootstrap");
  logger.log(`API ouvindo em http://localhost:${env.PORT}/${API_PREFIX}`);
  if (!env.DISCORD_BOT_ENABLED) logger.warn("DISCORD_BOT_ENABLED=false: bot do Discord desativado");
}

bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Falha ao iniciar o servidor: ${reason}`);
  process.exit(1);
});
