---
id: TASK-043
title: Lista de membros para admin com validação de nick no Albion
status: To Do
assignee: []
created_date: '2026-09-16 03:56'
labels:
  - frontend
  - backend
dependencies: []
priority: high
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Admin precisa ver todos os membros do painel num só lugar, com nick, tag de guilda, papéis e se o nick foi encontrado na API do Albion (TASK-016). Base para acompanhar a importação (TASK-042) e achar nick errado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Admin vê lista de membros com nick, tag de guilda, papéis e data de entrada
- [ ] #2 Cada linha mostra se o nick foi encontrado no Albion, não encontrado, ou se a consulta está indisponível
- [ ] #3 Consulta ao Albion não bloqueia a tela nem a importação; resultado é cacheado
- [ ] #4 Filtro por não encontrados e busca por nick ou usuário do Discord
- [ ] #5 Sem permissão de admin, rota e API respondem 403
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
