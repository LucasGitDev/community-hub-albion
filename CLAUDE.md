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
- Tasks em paralelo: worktree **sempre** em `.claude/worktrees/task-XXX` (ignorado no git): `git worktree add .claude/worktrees/task-XXX -b <branch> origin/main`, depois `pnpm install` dentro dele.
- Push + PR via `gh pr create` (título Conventional, corpo com `TASK-XXX`, resumo do gate e evidências).
- **Task só está Done quando o PR foi merged na `main`** com o check `summary` do quality gate verde.
- Merge: `gh pr merge --rebase --delete-branch` (preserva commits atômicos).
- Após merge: `git switch main && git pull`, apagar branch local, `git worktree remove` + `git worktree prune`, `git fetch --prune`.

## Quality gate e DoD
Doc "Quality Gate e DoD" no backlog. Resumo:
- `pnpm quality` (tudo) ou `pnpm quality lint,typecheck,coverage` (loop rápido). Thresholds em `quality.config.json`.
- Testes de banco precisam de Postgres: `POSTGRES_PORT=55432 docker compose -p <task> -f docker-compose.dev.yml up -d --wait` e `export TEST_DATABASE_URL=postgres://albion:albion@localhost:55432/albion_hub` (sem isso são pulados e a cobertura cai). Docker é OrbStack: sempre `timeout` nos comandos docker.
- CI (`.github/workflows/quality-gate.yml`) roda o mesmo script e comenta o resumo no PR.
- E2E em paralelo entre worktrees: `export E2E_PORT=41XX` (default 4173) antes do gate — a porta vale para as specs, o `webServer` e o `PUBLIC_URL` que o `SameOriginGuard` valida. O Playwright **não** reusa servidor existente (evita pegar o build de outra branch); só o loop rápido dentro do próprio worktree liga `E2E_REUSE_SERVER=true`.
- Antes de marcar AC/DoD ou abrir PR final: invocar skill `task-done-check` (gate + visual Playwright 1280/400 + produto vs doc-005 + skills do doc-003).

## Rotas de manutenção (TASK-048)

Namespace `/api/maintenance`, sem sessão, chamado por curl, válido em dev **e** em produção (G5).
**Ele cria prata em produção** — trate o segredo como trata a senha do banco.

- Ligar: `MAINTENANCE_TOKEN` no env, mínimo 32 caracteres (`openssl rand -base64 48`).
  Variável vazia ou ausente = namespace **desligado**: nenhuma rota é registrada. Sem default, sem fallback.
- Recusa é sempre `404` idêntico ao de rota inexistente: não dá para descobrir se o namespace está ligado.
- Rate limit de 20 chamadas por minuto no namespace inteiro.
- **Se o token vazar, troque o valor e reinicie o servidor.** Não há lista de revogação; o valor É o acesso.
  Nunca escreva o token real em commit, log, print, issue ou PR — nos exemplos abaixo ele é placeholder.

```bash
export HUB_URL=https://painel.exemplo.com
export MAINTENANCE_TOKEN=<cole-o-segredo-aqui>   # nunca versionar

# Ajuste de prata: motivo obrigatório, vira lançamento `adjustment` no extrato do jogador
curl -fsS -X POST "$HUB_URL/api/maintenance/silver" \
  -H "x-maintenance-token: $MAINTENANCE_TOKEN" -H 'content-type: application/json' \
  -d '{"userId":"<uuid-do-usuario>","amount":"-1500000","reason":"estorno do split 12 pago em duplicidade"}'

# Revalidar o nick do jogador na API do Albion
curl -fsS -X POST "$HUB_URL/api/maintenance/albion-check" \
  -H "x-maintenance-token: $MAINTENANCE_TOKEN" -H 'content-type: application/json' \
  -d '{"userId":"<uuid-do-usuario>"}'

# Disparar a limpeza diária sob demanda (503 enquanto a TASK-049 não estiver na base)
curl -fsS -X POST "$HUB_URL/api/maintenance/cleanup" -H "x-maintenance-token: $MAINTENANCE_TOKEN"
```

`amount` é prata inteira em string (Q20): positivo credita, negativo debita, zero é recusado.
O namespace **não** loga, não cria sessão, não lê sessão e não age como outro usuário — o `userId` é
sempre alvo, nunca ator. Login sem Discord continua só no dev-login, proibido em produção pelo env.

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
