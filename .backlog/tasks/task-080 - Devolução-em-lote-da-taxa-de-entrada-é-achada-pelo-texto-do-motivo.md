---
id: TASK-080
title: Devolução em lote da taxa de entrada é achada pelo texto do motivo
status: To Do
assignee: []
created_date: '2026-09-18 03:52'
labels: []
milestone: m-12
dependencies: []
priority: low
type: chore
ordinal: 7097
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado na TASK-078. Para publicar na timeline as devoluções em lote da taxa de entrada (evento cancelado, ou iniciado com gente na espera), o `EntryFeeTimelineService` roda depois que a mudança do evento é salva e **encontra os estornos pelo texto fixo do motivo**. O agent fez assim para não tocar em `events.service` e `events-repo`, que eram da TASK-077 rodando em paralelo.

Funciona, mas é frágil: mudar a frase do motivo desliga o registro na timeline sem nenhum teste de tipo falhar. O jeito certo é a operação de cancelar ou iniciar devolver os estornos que ela mesma fez, e a publicação usar isso.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A publicação das devoluções em lote não depende do texto do motivo
- [ ] #2 Os testes da TASK-078 continuam provando a mesma publicação
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
