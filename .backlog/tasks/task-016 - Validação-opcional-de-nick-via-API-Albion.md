---
id: TASK-016
title: Validação opcional de nick via API Albion
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:11'
labels:
  - backend
milestone: m-2
dependencies:
  - TASK-013
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ajuda ao staff, não bloqueio (Q14): consulta nick na API Albion da ALBION_REGION (Q15, pendente de confirmação).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Solicitação mostra ao staff se o nick foi encontrado na região configurada
- [ ] #2 Indisponibilidade da API Albion ou região ausente não impede registro nem aprovação
- [ ] #3 Resultado é exibido tanto no painel quanto no embed quando disponível
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pesquisar API gameinfo (hosts por região, shape). 2. packages/shared/src/albion.ts: regiões, tipo AlbionLookupResult, matchPlayer exato sem caixa (puro, testado). 3. apps/server: env ALBION_REGION opcional; AlbionPlayerLookup (fetch, timeout 3s, cache TTL, sem retry) + AlbionNickCheckService exportado (reuso TASK-015). 4. Consulta lazy na leitura da fila staff (paralela, cache) + pré-aquecimento fire-and-forget após POST /api/me/nick; sem coluna nova. 5. GET /api/staff/nick-requests ganha albion; UI mostra status. 6. Testes unit/HTTP com lookup fake; e2e com lookup desligado. 7. Env docs/compose. 8. Visual 1280/400, security-review, gate, PR.
<!-- SECTION:PLAN:END -->
