---
id: TASK-088
title: Gate deixa banco de teste acumulando até encher o disco
status: To Do
assignee: []
created_date: '2026-09-21 15:04'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: chore
ordinal: 7085
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado na TASK-087: o Postgres de teste (`localgate-postgres-1`) chegou a **1320 bancos** e 99% do volume, e duas suítes falharam com `53100` (sem espaço). Cada suíte de integração cria o seu banco (`albion_hub_*_<sufixo>`) e ninguém apaga depois; a cada rodada de gate, em cada worktree, nascem dezenas.

Hoje foram apagados à mão os bancos das tasks já mergeadas, mas isso volta na próxima leva de tasks em paralelo. Restam 335.

A correção é o gate (ou o helper de teste) apagar o que criou ao terminar, e não depender de ninguém lembrar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rodar o gate completo não deixa banco de teste para trás
- [ ] #2 Uma suíte interrompida no meio não impede a limpeza da próxima rodada
- [ ] #3 A limpeza não apaga o banco de desenvolvimento nem o de outra worktree rodando em paralelo
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
