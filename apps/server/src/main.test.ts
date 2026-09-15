import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

function boot(env: Record<string, string>) {
  const inherited = { ...process.env };
  delete inherited.DISCORD_TOKEN;
  delete inherited.GUILD_ID;
  delete inherited.DATABASE_URL;
  return spawnSync(process.execPath, ["dist/main.js"], { cwd: serverDir, env: { ...inherited, ...env }, encoding: "utf8", timeout: 20_000 });
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
  });

  it("GUILD_ID inválido sai com código 1 sem vazar o token", () => {
    const token = "vazamento-proibido";
    const result = boot({ DISCORD_TOKEN: token, GUILD_ID: "abc" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GUILD_ID: formato inválido");
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  });
});
