import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["json", { outputFile: ".quality/playwright.json" }], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 400, height: 860 } } },
  ],
  // TASK-004: e2e roda contra o Nest real servindo a SPA (mesmo processo da produção), sem Discord.
  webServer: {
    command: "pnpm exec turbo run build --filter=@albion-hub/web... --filter=@albion-hub/server... && node apps/server/dist/main.js",
    // raiz = SPA (200). /api/health daria 503 sem banco e o Playwright não consideraria pronto.
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DISCORD_TOKEN: "e2e.fake.token",
      GUILD_ID: "123456789012345678",
      DISCORD_BOT_ENABLED: "false",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://albion:albion@127.0.0.1:1/indisponivel",
      NODE_ENV: "test",
    },
  },
});
