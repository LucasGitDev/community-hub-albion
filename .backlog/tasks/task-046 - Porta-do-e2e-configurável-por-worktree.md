---
id: TASK-046
title: Porta do e2e configurável por worktree
status: To Do
assignee: []
created_date: '2026-09-16 19:27'
labels:
  - e2e
  - dx
dependencies: []
priority: medium
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As specs do Playwright têm 'const ORIGIN = "http://localhost:4173"' hardcoded e o SameOriginGuard rejeita outra origem, então dois worktrees rodando e2e ao mesmo tempo disputam a porta 4173 e produzem falhas fantasma (observado nas TASK-027 e TASK-030). Tornar a porta/origem configurável por variável de ambiente nas specs, no webServer do Playwright e no SameOriginGuard, para permitir rodadas paralelas.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Specs usam a origem derivada de env em vez de 4173 hardcoded
- [ ] #2 Dois worktrees rodam e2e ao mesmo tempo em portas diferentes sem falha
- [ ] #3 SameOriginGuard aceita a origem configurada e segue recusando origem estranha
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
