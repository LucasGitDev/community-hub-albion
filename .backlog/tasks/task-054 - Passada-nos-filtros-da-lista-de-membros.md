---
id: TASK-054
title: Passada nos filtros da lista de membros
status: To Do
assignee: []
created_date: '2026-09-17 12:15'
labels:
  - web
  - admin
dependencies: []
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje a lista de membros filtra por todos / não encontrados / sem nick / banidos. Faltou 'Saiu do servidor' (TASK-049 entregou só o selo) e, com cinco chips, a pergunta certa deixa de ser 'qual estado' e passa a ser 'quem precisa de atenção'. Rever o conjunto de filtros e as contagens junto, não adicionar chip isolado (decisão N6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Filtro de quem saiu do servidor existe e a contagem bate com a lista
- [ ] #2 Conjunto de filtros revisto como um todo, sem chip solto
- [ ] #3 Filtros seguem no servidor (nada filtrado no cliente) e a paginação continua correta
- [ ] #4 Revisão visual em 1280 e 400 nos papéis staff e admin
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
