---
id: TASK-082
title: Extrato pula lançamentos ao paginar quando dois caem no mesmo milissegundo
status: Done
assignee: []
created_date: '2026-09-19 04:25'
updated_date: '2026-09-19 04:28'
labels: []
milestone: m-12
dependencies: []
priority: high
type: bug
ordinal: 6880
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado pelo gate do Actions na main (run #251), que reprovou o commit da TASK-081: o teste "lista do mais novo ao mais antigo e pagina por cursor" esperava [m3, m2] na segunda página e recebeu [m2, m1] — o m3 sumiu.

Causa: o cursor carrega o created_at como Date do JavaScript (precisão de milissegundo), enquanto o Postgres grava em microssegundo. A comparação `created_at < cursor` (ou `= cursor` no desempate) deixa de fora a linha que ficou entre o valor truncado e o real. Em máquina rápida, dois lançamentos do mesmo usuário caem no mesmo milissegundo com frequência.

Afeta o extrato do membro e o extrato lido pela staff (`listLedgerEntries` e `listLedgerEntriesWithAuthor`). A TASK-081 torna o caso mais comum em produção: o crédito do split e o saque pago no jogo nascem na mesma transação, com o mesmo timestamp.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Paginar o extrato nunca pula nem repete lançamento, mesmo com timestamps no mesmo milissegundo ou idênticos
- [ ] #2 Vale para o extrato do membro e para o extrato lido pela staff
- [ ] #3 Teste reproduz lançamentos com created_at idêntico e no mesmo milissegundo, e falha antes da correção
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
