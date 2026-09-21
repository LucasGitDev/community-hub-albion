---
id: TASK-084
title: Presença vira o peso da divisão do loot
status: To Do
assignee: []
created_date: '2026-09-21 12:57'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6860
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE1 a PE6 no doc-005 (grelha de 2026-09-21). Hoje o formulário de fechamento pede a **% do loot** de cada um, que precisa somar 100% — o caller faz conta na mão. O que ele sabe é quanto cada um participou.

O caller passa a editar **presença de 0 a 100% por pessoa**, independente. A divisão é derivada: cada um recebe `presença ÷ soma das presenças`. A presença nasce da medição da call e o caller edita por cima.

A presença é dado **do evento** (PE4), não da leva: uma leva confirmada não muda quando a presença é editada depois. A **Buffunfa por presença passa a ler a presença editada** (PE5), mantendo o corte de 90% sobre esse número.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O fechamento pede presença de 0 a 100% por pessoa, sem exigir que some 100%
- [ ] #2 A prata de cada um é calculada como presença dividida pela soma das presenças, e a tela mostra os dois números
- [ ] #3 A presença de cada participante nasce do tempo medido na call e pode ser editada
- [ ] #4 A presença vive no evento: leva de split já confirmada não muda ao editar a presença depois
- [ ] #5 A Buffunfa por presença usa a presença editada, com o corte de 90% sobre ela
- [ ] #6 Quem esteve na call sem inscrição aparece com presença 0 e só recebe se o caller der presença
- [ ] #7 Soma de presenças zero é recusada com mensagem clara, sem dividir por zero
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
