---
id: TASK-081
title: 'Split pago no jogo: marcar como sacado na confirmação'
status: To Do
assignee: []
created_date: '2026-09-19 03:59'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6890
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões SP1 a SP6 no doc-005 (grelha de 2026-09-19). O caller divide o loot no jogo, na hora; o painel precisa registrar isso sem obrigar cada pessoa a pedir saque do que já recebeu.

Na confirmação do split, um modal lista os participantes **todos marcados por padrão** como pagos no jogo; o caller ou a staff desmarca quem não recebeu. Para cada marcado nasce o crédito normal do split e, no mesmo ato, um saque já liquidado do mesmo valor. Taxa e sobra do arredondamento, que vão para o caller, entram pagas automaticamente.

Só existe no ato da confirmação: depois, o que ficou é saldo normal e sai pela fila de saques.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A confirmação do split abre um modal com todos os participantes marcados como pagos no jogo, e dá para desmarcar um a um
- [ ] #2 Cada pessoa marcada recebe o crédito do split e um saque já liquidado do mesmo valor, na mesma transação da confirmação
- [ ] #3 O extrato do participante mostra o crédito e o saque, com saldo líquido zero para aquela leva
- [ ] #4 Quem foi desmarcado recebe só o crédito, como hoje, e pode pedir saque normalmente
- [ ] #5 Taxa e sobra do arredondamento entram como pagas automaticamente
- [ ] #6 Nenhum saque marcado como pago no jogo aparece na fila de saques da staff
- [ ] #7 Só caller e staff conseguem confirmar marcando como pago; depois da confirmação não existe caminho para marcar como pago
- [ ] #8 Cada saque pago no jogo publica na timeline com quem marcou
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
