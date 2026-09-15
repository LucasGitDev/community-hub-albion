#!/usr/bin/env node
/**
 * Quality gate: mesma lógica local e no CI.
 *
 *   node scripts/quality-gate.mjs                 roda tudo + resumo (pnpm quality)
 *   node scripts/quality-gate.mjs run <check>     roda um check, grava .quality/<check>.json
 *   node scripts/quality-gate.mjs summary         junta .quality/*.json, imprime markdown, exit 1 se bloqueante falhou
 *
 * Thresholds: quality.config.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = ".quality";
const cfg = JSON.parse(readFileSync("quality.config.json", "utf8"));
mkdirSync(OUT, { recursive: true });

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(output);
  return { code: r.status ?? 1, output };
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

/** Cada check devolve { status: pass|fail|warn, value, threshold, blocking, details? } */
const checks = {
  lint() {
    const { code } = sh(`pnpm exec eslint . --max-warnings 0 -f json -o ${OUT}/eslint.json`);
    const report = readJson(`${OUT}/eslint.json`) ?? [];
    const msgs = report.flatMap((f) => f.messages.map((m) => ({ ...m, file: f.filePath.replace(`${process.cwd()}/`, "") })));
    const asyncRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises", "@typescript-eslint/await-thenable"];
    const asyncIssues = msgs.filter((m) => asyncRules.includes(m.ruleId)).length;
    msgs.forEach((m) => console.log(`${m.file}:${m.line}:${m.column} ${m.ruleId} ${m.message}`));
    const ok = code === 0 && msgs.length <= cfg.lint.maxIssues;
    return [
      { id: "lint", label: "Linting", status: ok ? "pass" : "fail", value: `${msgs.length} issue(s)`, threshold: String(cfg.lint.maxIssues), blocking: true },
      {
        id: "race",
        label: "Race conditions",
        status: asyncIssues <= cfg.lint.maxAsyncIssues ? "pass" : "fail",
        value: `${asyncIssues} detectada(s)`,
        threshold: String(cfg.lint.maxAsyncIssues),
        blocking: true,
      },
    ];
  },

  typecheck() {
    const { code } = sh("pnpm exec turbo run typecheck --output-logs=errors-only && pnpm exec tsc -p tsconfig.json");
    return { id: "typecheck", label: "Typecheck", status: code === 0 ? "pass" : "fail", value: code === 0 ? "ok" : "erros", threshold: "0 erros", blocking: true };
  },

  coverage() {
    const { code } = sh("pnpm coverage");
    const pct = readJson("coverage/coverage-summary.json")?.total?.branches?.pct;
    const ok = code === 0 && typeof pct === "number" && pct >= cfg.coverage.branches;
    // Sem Postgres os testes de integração são pulados localmente e a cobertura cai.
    const dbHint = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL ? "" : " (sem TEST_DATABASE_URL: testes de banco pulados)";
    return { id: "coverage", label: "Testes + coverage (branch)", status: ok ? "pass" : "fail", value: `${pct == null ? "—" : `${pct}%`}${dbHint}`, threshold: `≥ ${cfg.coverage.branches}%`, blocking: true };
  },

  e2e() {
    const { code } = sh("pnpm exec playwright test");
    const stats = readJson(`${OUT}/playwright.json`)?.stats;
    const value = stats ? `${stats.expected} ok, ${stats.unexpected} falha(s), ${stats.flaky} flaky` : "—";
    return { id: "e2e", label: "E2E + screenshots (desktop/mobile)", status: code === 0 ? "pass" : "fail", value, threshold: "0 falhas", blocking: true };
  },

  image() {
    // TASK-006: builda a imagem de produção e faz smoke no container (SPA + API, sem Discord e sem banco).
    const tag = "albion-hub:quality";
    const name = `albion-hub-smoke-${process.pid}`;
    const build = sh(`docker build -t ${tag} .`);
    if (build.code !== 0) return { id: "image", label: "Imagem Docker (build + smoke)", status: "fail", value: "build falhou", threshold: "build + smoke ok", blocking: true };
    const env = "-e DISCORD_TOKEN=smoke.fake.token -e GUILD_ID=123456789012345678 -e DISCORD_BOT_ENABLED=false -e RUN_MIGRATIONS=false -e DATABASE_URL=postgres://smoke:smoke@127.0.0.1:1/smoke";
    const run = sh(`docker run -d --name ${name} -p 127.0.0.1::3000 ${env} ${tag}`);
    let value = "container não subiu";
    let ok = false;
    try {
      if (run.code === 0) {
        const port = sh(`docker port ${name} 3000/tcp`).output.trim().split(":").pop();
        const probe = sh(
          `for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:${port}/ && break; sleep 1; done; ` +
            `curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:${port}/carteira; ` +
            `curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:${port}/api/nao-existe; ` +
            `curl -s http://127.0.0.1:${port}/api/health`,
        ).output;
        ok = /200 404 \{"status":"degraded","db":"down","bot":"offline"\}/.test(probe);
        value = ok ? "build ok, SPA 200, /api 404 JSON, health ok" : "smoke falhou";
        if (!ok) sh(`docker logs ${name}`);
      }
    } finally {
      sh(`docker rm -f ${name}`);
    }
    return { id: "image", label: "Imagem Docker (build + smoke)", status: ok ? "pass" : "fail", value, threshold: "build + smoke ok", blocking: true };
  },

  duplication() {
    sh("pnpm exec jscpd");
    const pct = readJson(`${OUT}/jscpd/jscpd-report.json`)?.statistics?.total?.percentage ?? 0;
    return { id: "duplication", label: "Duplicação", status: pct <= cfg.duplication.maxPct ? "pass" : "warn", value: `${pct}%`, threshold: `≤ ${cfg.duplication.maxPct}%`, blocking: false };
  },

  deadcode() {
    const { output } = sh("pnpm exec knip --reporter json --no-exit-code");
    let items;
    try {
      const json = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
      items = json.issues.flatMap((i) =>
        Object.entries(i)
          .filter(([, v]) => Array.isArray(v) && v.length)
          .flatMap(([kind, v]) => v.map((x) => `${i.file}: ${kind} ${x.name}`)),
      );
    } catch {
      items = ["knip: saída não parseável"];
    }
    return { id: "deadcode", label: "Dead code", status: items.length ? "warn" : "pass", value: `${items.length} item(s)`, threshold: "0 (advisory)", blocking: false, details: items };
  },

  audit() {
    const { output } = sh(`pnpm audit --prod --audit-level=${cfg.audit.level} --json`);
    let vulns;
    try {
      const v = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)).metadata.vulnerabilities;
      vulns = (v.high ?? 0) + (v.critical ?? 0);
    } catch {
      vulns = -1;
    }
    const ok = vulns >= 0 && vulns <= cfg.audit.maxVulns;
    return { id: "audit", label: "Vulnerabilidades (high+)", status: ok ? "pass" : "fail", value: vulns < 0 ? "erro no audit" : `${vulns}`, threshold: String(cfg.audit.maxVulns), blocking: true };
  },
};

function run(name) {
  if (!checks[name]) throw new Error(`check desconhecido: ${name}. Opções: ${Object.keys(checks).join(", ")}`);
  const results = [checks[name]()].flat();
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(results, null, 2));
  return results;
}

function summary() {
  const results = Object.keys(checks).flatMap((name) => {
    const r = readJson(`${OUT}/${name}.json`);
    return r ?? [{ id: name, label: name, status: "fail", value: "não executado", threshold: "—", blocking: true }];
  });
  const icon = { pass: "✅", warn: "⚠️", fail: "❌" };
  const blockingFail = results.some((r) => r.blocking && r.status === "fail");
  const warn = results.some((r) => r.status !== "pass");
  const overall = blockingFail ? "❌ Falhou" : warn ? "⚠️ Passou com avisos" : "✅ Passou";

  const sha = (process.env.GITHUB_SHA ?? sh("git rev-parse HEAD").output.trim()).slice(0, 8);
  const run = process.env.GITHUB_RUN_ID ? ` · [run #${process.env.GITHUB_RUN_NUMBER}](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})` : " · local";
  const rows = results.map((r) => `| ${r.label} | ${r.value} | ${r.threshold} | ${r.blocking ? "sim" : "não"} | ${icon[r.status]} |`);
  const dead = results.find((r) => r.id === "deadcode" && r.details?.length);

  const body = [
    `## Quality gate: ${overall}`,
    "",
    `Commit \`${sha}\`${run} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "| Métrica | Resultado | Threshold | Bloqueia | Status |",
    "|---|---|---|---|---|",
    ...rows,
    ...(dead ? ["", `<details><summary>Dead code (${dead.details.length})</summary>`, "", ...dead.details.slice(0, 20).map((d) => `- ${d}`), "", "</details>"] : []),
    "",
    "<sub>Thresholds em `quality.config.json` · local: `pnpm quality`</sub>",
  ].join("\n");

  writeFileSync(`${OUT}/summary.md`, body);
  console.log(`\n${body}`);
  return blockingFail ? 1 : 0;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "run") {
  const results = run(arg);
  process.exit(results.some((r) => r.blocking && r.status === "fail") ? 1 : 0);
} else if (cmd === "summary") {
  process.exit(summary());
} else {
  const only = cmd ? cmd.split(",") : Object.keys(checks);
  for (const name of only) run(name);
  process.exit(summary());
}
