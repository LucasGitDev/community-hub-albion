---
id: TASK-004
title: SPA Vite + React + Tailwind + shadcn servida pelo Nest
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:23'
labels:
  - frontend
  - backend
milestone: m-0
dependencies:
  - TASK-003
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Painel web (Q3) em apps/web servido como estático pelo mesmo processo Nest (doc-002). Skills aplicáveis (doc-003): frontend-design, emil-design-eng, pick-ui-library antes de adicionar libs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Build do web gera SPA com Tailwind e shadcn funcionando
- [x] #2 Nest serve a SPA na raiz e rotas client-side não quebram em refresh
- [x] #3 Rotas /api continuam respondendo pela API e não pela SPA
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shadcn/ui (components.json + button/dialog) adaptado aos tokens. 2. Nest serve apps/web/dist na raiz com fallback client-side e /api excluído. 3. e2e contra o Nest real. 4. Gate + visual.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local: lint 0, race 0, typecheck ok, coverage 93.1%, e2e 10/10 (desktop+mobile) contra o Nest servindo a SPA, dup 0%, dead 0, vulns 0.
Evidências:
- AC#1: build do web com Tailwind v4 + shadcn/ui (components.json, ui/button e ui/dialog usando ponte de tokens shadcn→albion em index.css); WithdrawDialog e botões migrados; screenshots .playwright-mcp/t004-dialog-1280.png e t004-saques-400.png revisados (visual igual ao protótipo, sem overflow a 400px).
- AC#2: main.test 'serve a SPA em / e em rotas client-side' (boot do dist) + e2e 'refresh em rota client-side' (reload em /saques mantém tela); curl: / /entrar /carteira 200 text/html.
- AC#3: /api/health JSON, /api e /api/nao-existe 404 JSON (app.module.test + e2e); arquivo inexistente com extensão 404 (spa.test).
Decisões: trocado @nestjs/serve-static por fallback próprio (serve-static usa sendFile sem root e devolve 404 quando o caminho tem diretório com ponto, ex. .claude/worktrees). WEB_DIST_DIR opcional (default apps/web/dist relativo ao dist do server). Ponte de tokens: text-muted mantém significado local; não usar bg-muted do shadcn. Skill pick-ui-library é só invocável pelo usuário (disable-model-invocation) — não executada.
Skills: frontend-design, emil-design-eng (adaptação dos componentes), task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SPA com shadcn/ui nos tokens do albion-hub servida pelo mesmo processo Nest, com fallback de rota e /api isolado. Verificado com pnpm quality (e2e contra o Nest real) e screenshots 1280/400.
<!-- SECTION:FINAL_SUMMARY:END -->
