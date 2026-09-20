import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

function boot(env: Record<string, string>) {
  const inherited = { ...process.env };
  delete inherited.DISCORD_TOKEN;
  delete inherited.GUILD_ID;
  delete inherited.DATABASE_URL;
  return spawnSync(process.execPath, ["dist/main.js"], { cwd: serverDir, env: { ...inherited, ...env }, encoding: "utf8", timeout: 60_000 });
}

describe("boot do servidor compilado", () => {
  beforeAll(() => {
    const build = spawnSync("pnpm", ["run", "build"], { cwd: serverDir, encoding: "utf8", shell: process.platform === "win32" });
    if (build.status !== 0) throw new Error(`build falhou:\n${build.stdout}${build.stderr}`);
  }, 120_000);

  it("sem DISCORD_TOKEN e GUILD_ID sai com código 1 e mensagem clara", () => {
    const result = boot({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Configuração inválida");
    expect(result.stderr).toContain("DISCORD_TOKEN: obrigatória");
    expect(result.stderr).toContain("GUILD_ID: obrigatória");
    // Timeout explícito: subir o bundle do Nest leva ~6 s em máquina carregada (mais ainda sob cobertura),
    // e o padrão de 5 s do vitest transformava isso em flake.
  }, 90_000);

  it("GUILD_ID inválido sai com código 1 sem vazar o token", () => {
    const token = "vazamento-proibido";
    const result = boot({ DISCORD_TOKEN: token, GUILD_ID: "abc" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GUILD_ID: formato inválido");
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  }, 90_000);

  // TASK-004: mesmo processo serve SPA na raiz (com fallback de rota) e API em /api.
  it("serve a SPA em / e em rotas client-side, mantendo /api na API", async () => {
    const spaDir = mkdtempSync(join(tmpdir(), "albion-hub-spa-"));
    writeFileSync(join(spaDir, "index.html"), "<!doctype html><title>albion-hub-spa</title>");
    const port = 39_000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ["dist/main.js"], {
      cwd: serverDir,
      env: {
        ...process.env,
        DISCORD_TOKEN: "a.b.c",
        GUILD_ID: "123456789012345678",
        DATABASE_URL: "postgres://albion:albion@127.0.0.1:1/indisponivel",
        DISCORD_BOT_ENABLED: "false",
        RUN_MIGRATIONS: "false",
        DISCORD_CLIENT_ID: "223456789012345678",
        DISCORD_CLIENT_SECRET: "secret",
        PUBLIC_URL: "http://localhost:3000",
        WEB_DIST_DIR: spaDir,
        PORT: String(port),
      },
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      await waitForHttp(`${base}/api/health`);
      for (const path of ["/", "/carteira", "/staff/saques"]) {
        const res = await fetch(base + path);
        expect(res.status, path).toBe(200);
        expect(await res.text(), path).toContain("albion-hub-spa");
      }
      const health = await fetch(`${base}/api/health`);
      expect(health.headers.get("content-type")).toContain("application/json");
      expect((await health.json()) as object).toMatchObject({ db: "down" });
      const missing = await fetch(`${base}/api/nao-existe`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toContain("application/json");
    } finally {
      child.kill();
    }
  }, 90_000);
});

/**
 * Espera o servidor compilado responder. O orçamento é folgado de propósito: o boot leva ~3s numa máquina
 * livre, mas passa dos 15s quando o gate roda com o cliente do jogo aberto (load acima de 10) — e aí o
 * teste reprovava o gate inteiro por carga, não por defeito. Esperar mais só custa tempo quando já falhou.
 */
async function waitForHttp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`servidor não respondeu em ${url}`);
}
