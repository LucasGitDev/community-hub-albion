---
id: TASK-051
title: Staff vê o extrato de um jogador
status: To Do
assignee: []
created_date: '2026-09-17 02:19'
labels:
  - admin
  - web
  - economy
dependencies: []
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff e admin conseguem abrir o ledger de um jogador específico a partir da lista de membros: saldo disponível, reservado e o extrato com origem, data, valor, autor e motivo de cada lançamento. Leitura apenas — ajuste de prata só existe no namespace de manutenção (TASK-048). Serve para responder 'cadê minha prata' sem abrir o banco.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff e admin leem o extrato de qualquer jogador a partir da lista de membros
- [ ] #2 Extrato mostra origem, data, valor, autor e motivo, com paginação
- [ ] #3 Membro comum não lê extrato alheio (API e UI)
- [ ] #4 Valores em PT-BR; nenhum valor passa por number
- [ ] #5 security-review sem achados críticos
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
