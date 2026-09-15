---
id: doc-003
title: Skills
type: guide
created_date: '2026-09-15 02:46'
updated_date: '2026-09-15 05:23'
---

Skills ficam em `.agents/skills/` (symlink em `.claude/skills/`), versionadas via `skills-lock.json`.
Agent **deve invocar automaticamente** (Skill tool) quando o gatilho bater — não esperar pedido explícito.
Várias skills podem ser combinadas numa mesma tarefa.

| Skill | Origem | Gatilho (usar quando…) | Onde no projeto |
|---|---|---|---|
| `emil-design-eng` | emilkowalski/skill | criar/polir qualquer componente ou tela | `apps/web` |
| `animate` | emilkowalski/skill | adicionar animação nova | `apps/web` |
| `review-animations` | emilkowalski/skill | revisar diff com motion | review de PR web |
| `improve-animations` | emilkowalski/skill | auditoria de motion existente | fases de polish |
| `find-animation-opportunities` | emilkowalski/skill | tela pronta parece "seca" | fases de polish |
| `animation-vocabulary` | emilkowalski/skill | descrição vaga de efeito → termo preciso | apoio |
| `apple-design` | emilkowalski/skill | interações físicas/fluidas, gestos, sheets | `apps/web` |
| `pick-ui-library` | emilkowalski/skill | antes de adicionar lib de frontend — **só o usuário invoca** (`/pick-ui-library`); agent registra a lib escolhida nas notas e pede revisão | `apps/web` |
| `prototype` | emilkowalski/skill | decisão de layout com alternativas reais | telas novas |
| `ask-sonner` | emilkowalski/skill | toasts/notificações no painel | `apps/web` |
| `frontend-design` | global | direção estética, tipografia | `apps/web` |
| `revenue-centric-design` | heliocosta-dev/revenue-centric-design | onboarding (verificação/registro nick), loja, giveaway, streak, ranking, indicação, retenção, landing | produto + `apps/web` |
| `marclou-review` | local (`.claude/skills/marclou-review`) | review de feature/escopo/plano: cortar excesso, shipar rápido | planejamento e review |
| `task-done-check` | local (`.claude/skills/task-done-check`) | antes de marcar AC/DoD, abrir PR ou fechar task: gate + visual Playwright + produto + skills | todas as tasks |
| `grill-me` / `grilling` | mattpocock/skills | estressar plano ou decisão em rodadas | planejamento |
| `project-manager-backlog` (agent) | local | criar, quebrar e revisar tasks no Backlog.md | todas as tasks |
| `simplify`, `code-review`, `security-review` | built-in | após implementar; `security-review` obrigatório em auth, ledger, saque | todas |



## Mapeamento por módulo
- **Auth/Onboarding (OAuth, registro nick)** → `revenue-centric-design` (activation), `emil-design-eng`, `security-review`
- **Eventos/Templates/Painel** → `emil-design-eng`, `prototype`, `ask-sonner`
- **Economia/Ledger/Loot split/Saque** → `security-review`, `marclou-review` (escopo)
- **Loja/Giveaway/Streak/Ranking/Indicação** → `revenue-centric-design`, `animate` (feedback de recompensa)
- **Planejamento de fase** → `marclou-review` + tasks no Backlog.md
