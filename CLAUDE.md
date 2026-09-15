# albion-hub

Sistema de comunidade Discord (Albion Online): bot + API + painel web.
Docs (produto, arquitetura, skills, roadmap) vivem no Backlog.md: `backlog doc list --plain`.
Skills/tools do agent: doc "Skills" no backlog — **ler antes de qualquer tarefa de UI, UX, produto ou review**.

## Stack
- Monorepo: pnpm workspaces + Turborepo
- `apps/server`: NestJS + Necord (bot + API no mesmo processo), serve `apps/web` build estático
- `apps/web`: Vite + React SPA + Tailwind + shadcn/ui
- `packages/db`: Postgres + Drizzle (schema, migrations)
- `packages/shared`: tipos, DTOs, schemas zod, regras CASL compartilhadas
- Deploy: imagem Docker única, multi-stage
- Realtime: fora da v1 (polling)

## Regras
- Status: **setup/planejamento**. Não implementar features sem plano aprovado.
- Commits: Conventional Commits, atômicos, **sem** `Co-Authored-By`.
- Ledger é imutável: correção só via estorno. Nunca UPDATE/DELETE em lançamentos.
- Valores monetários: inteiros (sem float).
- Início de evento, distribuição, etc: um serviço interno; comando Discord / painel / botão embed só chamam o serviço.
- RBAC via CASL, separado de cargos Discord.

## Fluxo de git (toda task)
- Nunca commitar direto na `main`. Uma branch por task: `<type>/task-XXX-slug` (ex: `feat/task-026-ledger`).
- Tasks em paralelo: `git worktree add ../hub-albion-task-XXX -b <branch>` (ou EnterWorktree).
- Push + PR via `gh pr create` (título Conventional, corpo com `TASK-XXX`, resumo do gate e evidências).
- **Task só está Done quando o PR foi merged na `main`** com o check `summary` do quality gate verde.
- Merge: `gh pr merge --rebase --delete-branch` (preserva commits atômicos).
- Após merge: `git switch main && git pull`, apagar branch local, `git worktree remove` + `git worktree prune`, `git fetch --prune`.

## Quality gate e DoD
Doc "Quality Gate e DoD" no backlog. Resumo:
- `pnpm quality` (tudo) ou `pnpm quality lint,typecheck,coverage` (loop rápido). Thresholds em `quality.config.json`.
- CI (`.github/workflows/quality-gate.yml`) roda o mesmo script e comenta o resumo no PR.
- Antes de marcar AC/DoD ou abrir PR final: invocar skill `task-done-check` (gate + visual Playwright 1280/400 + produto vs doc-005 + skills do doc-003).

## Uso automático de skills
Invocar skill via Skill tool sem o usuário pedir sempre que o gatilho do doc "Skills" (backlog) bater.
Resumo:
- Criar/alterar UI → `emil-design-eng` (+ `frontend-design`, `pick-ui-library`)
- Animação → `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary`
- Toasts → `ask-sonner`
- Explorar variações de UI → `prototype`
- Onboarding, landing, loja, conversão, retenção, economia/engajamento → `revenue-centric-design`
- Review de produto/feature estilo indie-hacker → `marclou-review`
- Verificar task antes de marcar AC/DoD, abrir PR ou fechar → `task-done-check`
- Tarefas, board, docs e decisões → Backlog.md CLI (ver bloco abaixo); gestão de tasks → agent `project-manager-backlog`

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.50.1 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
