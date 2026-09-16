import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, ORIGIN } from "./e2e/origin";

// TASK-010: login real (sessão no Postgres) via dev-login; e2e precisa de banco.
const E2E_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!E2E_DATABASE_URL) {
  throw new Error("e2e precisa de Postgres: exporte TEST_DATABASE_URL (veja CLAUDE.md, seção Quality gate).");
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["json", { outputFile: ".quality/playwright.json" }], ["html", { open: "never" }]],
  use: {
    baseURL: ORIGIN,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 400, height: 860 } } },
  ],
  // TASK-004/010: e2e roda contra o Nest real servindo a SPA, com banco e dev-login (sem Discord).
  webServer: {
    command: "pnpm exec turbo run build --filter=@albion-hub/web... --filter=@albion-hub/server... && node apps/server/dist/main.js",
    url: `${ORIGIN}/`,
    // TASK-046: reuso desligado por padrão. Com a 4173 compartilhada, reusar pegava o servidor de
    // outra branch (build diferente) e a falha aparecia como 404 fantasma na spec. Quem quer o loop
    // rápido dentro do próprio worktree liga E2E_REUSE_SERVER=true de propósito.
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === "true",
    timeout: 180_000,
    env: {
      PORT: String(E2E_PORT),
      DISCORD_TOKEN: "e2e.fake.token",
      GUILD_ID: "123456789012345678",
      DISCORD_BOT_ENABLED: "false",
      RUN_MIGRATIONS: "true",
      AUTH_DEV_LOGIN: "true",
      DATABASE_URL: E2E_DATABASE_URL,
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "e2e-fake-secret",
      PUBLIC_URL: ORIGIN,
    },
  },
});
