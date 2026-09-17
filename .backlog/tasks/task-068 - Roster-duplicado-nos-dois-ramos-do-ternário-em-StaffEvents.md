---
id: TASK-068
title: Roster duplicado nos dois ramos do ternário em StaffEvents
status: To Do
assignee: []
created_date: '2026-09-17 17:40'
labels: []
milestone: m-12
dependencies: []
priority: low
type: chore
ordinal: 7080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Em `apps/web/src/pages/StaffEvents.tsx`, o bloco do roster aparece inteiro nos dois ramos do ternário `settlement ? ... : ...` — cerca de 40 linhas idênticas. Qualquer mudança no roster precisa ser feita em dois lugares, e esquecer um deles é o tipo de erro que só aparece no fluxo de fechamento, que é justamente o menos exercitado.

Apareceu na TASK-063: a correção teve que ser aplicada duas vezes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O bloco do roster existe uma vez só
- [ ] #2 Os dois estados (com e sem fechamento) continuam renderizando o que renderizavam, comprovado por e2e existente
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
