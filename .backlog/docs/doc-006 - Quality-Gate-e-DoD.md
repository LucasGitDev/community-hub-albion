---
id: doc-006
title: Quality Gate e DoD
type: guide
created_date: '2026-09-15 03:49'
updated_date: '2026-09-15 03:50'
---
Como o albion-hub garante que uma task está pronta: **gate automático** (local = CI) + **DoD no backlog** + **verificação do agent** (skill `task-done-check`).

## 1. Gate automático
Fonte única de thresholds: `quality.config.json`. Mesmo script local e no GitHub (`scripts/quality-gate.mjs`).

| Métrica | Ferramenta | Threshold | Bloqueia |
|---|---|---|---|
| Linting | ESLint + typescript-eslint tipado | 0 issues | sim |
| Race conditions | `no-floating-promises`, `no-misused-promises`, `await-thenable` | 0 | sim |
| Typecheck | `tsc` via Turbo + root | 0 erros | sim |
| Testes + coverage | Vitest + v8, branch sobre regra de negócio (`src/lib`, `src/domain`, `mock/rules.ts`, `packages/*/src`) | ≥ 79% | sim |
| E2E + screenshots | Playwright, projetos desktop 1280 e mobile 400 | 0 falhas | sim |
| Vulnerabilidades | `pnpm audit --prod` | 0 high/critical | sim |
| Duplicação | jscpd (ts/tsx) | ≤ 15% | não (aviso) |
| Dead code | knip | 0 | não (aviso) |

Coverage não mede componente visual de propósito: UI é garantida por e2e + verificação visual do agent.

### Comandos
- `pnpm quality` — tudo + resumo em `.quality/summary.md`
- `pnpm quality lint,typecheck,coverage` — loop rápido
- `node scripts/quality-gate.mjs run <check>` / `summary` — usado pelo CI
- Isolados: `pnpm lint`, `pnpm test`, `pnpm coverage`, `pnpm e2e`, `pnpm dup`, `pnpm deadcode`, `pnpm audit:prod`

### CI (`.github/workflows/quality-gate.yml`)
PR e push na `main`. Matriz paralela de checks + job e2e (artifacts `playwright-report`, `coverage-report`) → job `summary` junta os JSON, escreve no Step Summary, comenta sticky no PR e falha se algum bloqueante falhou.
Recomendado: branch protection exigindo o check `summary`.

## 2. Definition of Done (backlog)
Default em `.backlog/config.yml`, aplicado a toda task nova (e já adicionado às existentes):
1. `pnpm quality` sem falha bloqueante; resumo nas notas
2. Cada AC verificado com evidência objetiva, nunca só leitura de código
3. Skills aplicáveis do doc-003 invocadas e listadas nas notas
4. UI alterada: e2e cobre o fluxo + screenshots 1280 e 400 revisados
5. Confere com doc-005 (Qs citadas), sem escopo extra
6. Toca auth/ledger/prata/saque: `security-review` sem crítico
7. Notas + final summary com evidências; commits Conventional atômicos sem co-autor
8. PR merged na `main` com gate verde; branch e worktree removidos

## 3. Acceptance criteria — como escrever
- Resultado observável, testável, sem passo de implementação.
- Cada AC deve ter caminho claro de evidência: teste unitário, cenário e2e, screenshot ou comando.
- Regras de dinheiro/estado viram AC com caso-limite explícito (mínimo, saldo exato, transição inválida).
- Cite a Q do doc-005 quando o AC vier de uma decisão.

## 4. Verificação do agent (`task-done-check`)
Checks que o gate não enxerga, feitos pelo agent antes de marcar AC/DoD:
- **Escopo**: diff ↔ AC; nada de pós-v1.
- **Guardrails**: bigint em prata, ledger só insert/estorno, sem `any`/ts-ignore, cores só via tokens.
- **Visual (Playwright MCP)**: screenshots 1280/400 lidos pelo agent; hierarquia, estados sem depender só de cor, sem overflow horizontal, foco por teclado, console limpo, copy PT-BR.
- **Produto**: tabela AC → evidência; cruzar com doc-005; `marclou-review` em UI/copy; `revenue-centric-design` em onboarding/retenção.
- **Skills**: confirmar uso conforme doc-003 e registrar.

Saída padrão: tabela AC/DoD → evidência → status, colada nas notas da task.

## 5. Fluxo de entrega
- Branch por task (`<type>/task-XXX-slug`), worktree quando houver tasks em paralelo.
- PR via `gh`; CI comenta o resumo do gate.
- **Done = merged na `main`** (`gh pr merge --rebase --delete-branch`), depois limpar branch local, worktree e `git fetch --prune`.
- Recomendado: branch protection na `main` exigindo o check `summary`.
