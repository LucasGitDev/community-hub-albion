---
id: TASK-001
title: 'Monorepo com Turbo, packages shared e tooling de qualidade'
status: Done
assignee: []
created_date: '2026-09-15 03:23'
updated_date: '2026-09-15 05:23'
labels:
  - infra
  - ci
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Base do monorepo albion-hub (Q2) conforme doc-002: apps/server, apps/web, packages/db, packages/shared, com lint, typecheck e test orquestrados via Turbo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Workspace contém apps/server, apps/web, packages/db e packages/shared
- [x] #2 Comandos de lint, typecheck e test rodam em todos os pacotes a partir da raiz e passam
- [x] #3 packages/shared é importável por server e web
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
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local: lint 0, race 0, typecheck ok, coverage 97.56%, e2e 8/8, dup 0%, dead 0, vulns 0.
Evidências: AC#1 pnpm -r ls lista server, web, db, shared. AC#2 pnpm quality roda eslint (raiz, todos pacotes), turbo typecheck (4 pacotes) e vitest (web + shared) verdes. AC#3 web importa @albion-hub/shared (build + e2e ok); node apps/server/dist/main.js imprime '4 papéis carregados de @albion-hub/shared'.
Decisão: shared/db compilam com tsc (ESM NodeNext + d.ts); turbo builda deps antes de typecheck/test/e2e. Lint único na raiz (flat config cobre todos os pacotes).
Skills: task-done-check. Sem UI nova (só imports); visual coberto pelo e2e existente.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Monorepo com apps/server, apps/web, packages/db e packages/shared; shared exporta papéis (Q13) e helpers de prata (Q20) consumidos por web e server. Verificado com pnpm quality verde e execução do server importando shared.
<!-- SECTION:FINAL_SUMMARY:END -->
