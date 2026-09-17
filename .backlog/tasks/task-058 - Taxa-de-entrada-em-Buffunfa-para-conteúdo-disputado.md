---
id: TASK-058
title: Taxa de entrada em Buffunfa para conteúdo disputado
status: To Do
assignee: []
created_date: '2026-09-17 17:04'
labels: []
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Primeiro sink da Buffunfa: o caller pode cobrar uma taxa de entrada em conteúdo disputado. O template nasce zerado e o caller define até fechar as inscrições, sem teto. É sink puro — a Buffunfa cobrada some, não vai para ninguém. É o que a diferencia da taxa do split em prata, que vai para o caller/dono (F6-16).

A cobrança acontece na inscrição, não no início do evento, porque é o único desenho que filtra de verdade: inscrever-se de graça mantém a lista inflada. Quem desiste antes do início recebe de volta; depois do início, não — assim quem avisa cedo não é punido (F6-13). A taxa é em Buffunfa e nunca em prata: em prata viraria barreira de dinheiro contra o membro novo, que é justamente quem tem pouca prata (F6-12).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O template nasce com taxa zerada; o caller define o valor até o fechamento das inscrições, sem teto
- [ ] #2 A inscrição debita a taxa em Buffunfa na hora; saldo insuficiente recusa a inscrição com mensagem clara
- [ ] #3 Desistir antes do início do evento devolve a taxa por estorno; desistir depois não devolve
- [ ] #4 Cancelar o evento devolve a taxa a todos os inscritos, automaticamente, por estorno apontando para o lançamento original
- [ ] #5 A Buffunfa cobrada não é creditada a ninguém: o total em circulação diminui
- [ ] #6 Um evento que cobra taxa e paga participação gera dois lançamentos separados no extrato, nunca um líquido
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
