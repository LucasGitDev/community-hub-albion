---
id: TASK-083
title: Staff abre saque para um membro
status: To Do
assignee: []
created_date: '2026-09-20 13:15'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6870
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões SS1 a SS6 no doc-005 (grelha de 2026-09-20). O membro pede no Discord ou no jogo e não usa o painel; a staff abre o saque por ele.

Nasce `pending` como qualquer outro (SS1), com motivo obrigatório (SS4) e limitado ao saldo disponível do membro (SS3). Tem o atalho "já paguei no jogo", que faz o saque nascer liquidado no mesmo desenho da TASK-081 (SS2).

Entra na fila de saques e na lista de jogadores (SS5). Na lista, a ação vai num **menu de ações**, não em mais um botão — é a convenção nova (SS6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff e admin abrem um saque para um membro informando valor e motivo
- [ ] #2 O saque nasce pending e aparece na fila como qualquer outro, mostrando que foi aberto pela staff e por quem
- [ ] #3 Valor acima do disponível do membro é recusado, com a mesma conta do saque normal
- [ ] #4 Marcando "já paguei no jogo", o saque nasce liquidado, com quem marcou, e não entra na fila
- [ ] #5 Membro comum não consegue abrir saque para outro, nem pela API
- [ ] #6 A ação existe na fila de saques e na lista de jogadores, esta última dentro de um menu de ações
- [ ] #7 Cada saque aberto pela staff publica na timeline, com quem abriu, o alvo, o valor e o motivo
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
