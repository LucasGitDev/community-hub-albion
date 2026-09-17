#!/usr/bin/env node
/**
 * Pipeline local: faz na sua máquina o que o GitHub Actions faz na nuvem.
 *
 * Existe porque a conta do GitHub estourou o limite de gastos do Actions e nenhum job inicia
 * ("The job was not started because recent account payments have failed or your spending limit
 * needs to be increased"). Enquanto o saldo não volta, o portão de qualidade e o deploy rodam aqui.
 *
 *   node scripts/local-pipeline.mjs              gate + push + imagem + webhook   (pnpm ship)
 *   node scripts/local-pipeline.mjs gate         só o quality gate
 *   node scripts/local-pipeline.mjs deploy       só imagem + webhook (assume gate já verde)
 *   node scripts/local-pipeline.mjs --dry-run    mostra o que faria, sem push, build ou webhook
 *   node scripts/local-pipeline.mjs --skip-gate  pula o gate (só para reexecutar um deploy que falhou no meio)
 *
 * Credenciais: `.env.deploy` na raiz (git-ignored) ou variáveis de ambiente. Veja `.env.deploy.example`.
 * Os mesmos nomes dos secrets do GitHub, de propósito — quando o saldo voltar, o workflow assume
 * sem tradução nenhuma.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const stage = args.find((a) => !a.startsWith("-")) ?? "all";
const dryRun = flag("--dry-run");
const skipGate = flag("--skip-gate");

const BRANCH = "main";
const PLATFORMS = "linux/amd64,linux/arm64"; // VPS de produção é ARM; o CI também publica multi-arch.

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function run(cmd, { quiet = false, allowFail = false, stdin } = {}) {
  if (!quiet) console.log(`\n$ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: stdin === undefined ? "inherit" : ["pipe", "inherit", "inherit"], input: stdin });
  if (!allowFail && r.status !== 0) die(`comando falhou (${r.status}): ${cmd}`);
  return r.status ?? 1;
}

function capture(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

/** `.env.deploy` não sobrescreve o que já está no ambiente: exportar na sessão continua ganhando. */
function loadEnvFile(path = ".env.deploy") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

/** Trim defensivo: secret colado com quebra de linha gerou "malformed HTTP Authorization header" no CI. */
const clean = (v) => (v ?? "").replace(/\s+/g, "");

function ensureCleanTree() {
  const dirty = capture("git status --porcelain");
  if (dirty) die("árvore suja: commite ou descarte antes de publicar.", dirty.split("\n").slice(0, 5).join("\n  "));
}

function ensureBranch() {
  const current = capture("git rev-parse --abbrev-ref HEAD");
  if (current !== BRANCH) die(`você está em '${current}', não em '${BRANCH}'.`, "O deploy publica o que está na main, como o CI faria.");
}

/**
 * Mesma regra do workflow (`paths-ignore: .backlog/**`): commit só de backlog não muda
 * comportamento, então não roda gate nem gera imagem nova.
 */
function onlyBacklogChanged() {
  const base = capture(`git rev-parse --verify --quiet origin/${BRANCH}`);
  if (!base) return false;
  const files = capture(`git diff --name-only origin/${BRANCH}..HEAD`).split("\n").filter(Boolean);
  return files.length > 0 && files.every((f) => f.startsWith(".backlog/"));
}

function gate() {
  console.log("\n── Quality gate ────────────────────────────────────────────");
  if (!process.env.TEST_DATABASE_URL) {
    console.warn("⚠ TEST_DATABASE_URL não definida: os testes de banco são pulados e a cobertura cai.");
    console.warn("  POSTGRES_PORT=55432 docker compose -p local -f docker-compose.dev.yml up -d --wait");
    console.warn("  export TEST_DATABASE_URL=postgres://albion:albion@localhost:55432/albion_hub");
  }
  const code = run("node scripts/quality-gate.mjs", { allowFail: true });
  if (code !== 0) die("quality gate reprovou: nada foi publicado.", "Corrija e rode de novo — é o mesmo portão do CI.");
}

function deploy() {
  loadEnvFile();
  const user = clean(process.env.DOCKERHUB_USERNAME);
  const token = clean(process.env.DOCKERHUB_TOKEN);
  const webhook = clean(process.env.EASYPANEL_DEPLOY_WEBHOOK);
  if (!user || !token) {
    die("faltam DOCKERHUB_USERNAME e/ou DOCKERHUB_TOKEN.", "Crie `.env.deploy` a partir de `.env.deploy.example` (o arquivo é git-ignored).");
  }
  if (user.includes("@")) die("DOCKERHUB_USERNAME deve ser o usuário do Docker Hub, não o e-mail.");
  // Docker Hub só aceita o usuário em minúsculas: com maiúscula o registry devolve
  // "malformed HTTP Authorization header", que não diz nada sobre a causa real.
  const loginUser = user.toLowerCase();
  const image = process.env.DOCKERHUB_IMAGE || `${loginUser}/albion-hub`;
  const sha = capture("git rev-parse HEAD");
  const short = sha.slice(0, 7);

  console.log("\n── Deploy ──────────────────────────────────────────────────");
  console.log(`imagem:  ${image}:latest e :sha-${short}`);
  console.log(`commit:  ${sha}`);
  console.log(`webhook: ${webhook ? "configurado" : "ausente (a imagem sobe, o deploy não é disparado)"}`);
  if (dryRun) return console.log("\n--dry-run: parando antes do login, do build e do webhook.");

  run(`docker login docker.io --username ${JSON.stringify(loginUser)} --password-stdin`, { stdin: token });

  // buildx com QEMU: a VPS é ARM e a máquina local é ARM ou x86 — o mesmo comando serve nos dois casos.
  const builder = "albion-hub-local";
  if (capture(`docker buildx inspect ${builder} >/dev/null 2>&1; echo $?`) !== "0") {
    run(`docker buildx create --name ${builder} --driver docker-container --use`);
  } else {
    run(`docker buildx use ${builder}`);
  }
  run(`docker run --privileged --rm tonistiigi/binfmt --install arm64,amd64`, { allowFail: true });
  run(
    [
      "docker buildx build",
      `--platform ${PLATFORMS}`,
      `--tag ${image}:latest`,
      `--tag ${image}:sha-${short}`,
      `--label org.opencontainers.image.revision=${sha}`,
      "--push .",
    ].join(" "),
  );

  if (!webhook) {
    console.warn("\n⚠ EASYPANEL_DEPLOY_WEBHOOK ausente: imagem publicada, deploy não disparado.");
    return;
  }
  run(`curl -fsS -X POST ${JSON.stringify(webhook)} > /dev/null`);
  console.log(`\n✓ Deploy disparado no Easypanel (sha-${short}).`);
}

function push() {
  console.log("\n── Push ────────────────────────────────────────────────────");
  if (dryRun) return console.log(`--dry-run: pularia 'git push origin ${BRANCH}'.`);
  run(`git push origin ${BRANCH}`);
}

// `gate` roda em qualquer branch — é justamente o que se quer antes de abrir PR. Só publicar exige main.
if (stage === "gate") {
  // Sem exigir árvore limpa: o gate serve justamente para rodar em cima do que você acabou de escrever.
  gate();
  console.log("\n✓ Gate verde.");
} else if (stage === "deploy") {
  ensureBranch();
  ensureCleanTree();
  deploy();
} else {
  ensureBranch();
  ensureCleanTree();
  if (onlyBacklogChanged()) {
    console.log("Commits só de .backlog/: sem gate e sem imagem nova (mesma regra do workflow).");
    push();
    process.exit(0);
  }
  if (!skipGate) gate();
  push();
  deploy();
  console.log("\n✓ Pipeline local completo.");
}
