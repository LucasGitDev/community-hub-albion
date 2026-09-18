---
id: TASK-076
title: 'Timeline: publicador, fila e canal de admins no Discord'
status: To Do
assignee: []
created_date: '2026-09-18 03:21'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Base da timeline da plataforma (decisões T1 a T14 no doc-005): uma linha do tempo de tudo que acontece, num canal do Discord só de admins, para depurar e identificar erros.

Esta task entrega a infraestrutura e nenhuma instrumentação de domínio — as três tasks seguintes instrumentam contas/eventos, economia e loja em paralelo, todas em cima desta.

Desenho: os serviços falam com uma interface `TimelinePublisher` e publicam **depois do commit** (T5). O único consumidor hoje é o Discord (T3); gravação em banco entra depois atrás da mesma interface. A publicação é **extra, nunca obrigatória** (T6): sem `DISCORD_TIMELINE_CHANNEL_ID` fica desligada, e falha do Discord não afeta a operação. Fila em memória com agrupamento de até 10 embeds por mensagem, respeitando o limite do Discord e mantendo a ordem (T10, T11). Sem BullMQ nem Redis (T12).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existe uma interface de publicação única que os serviços usam, sem conhecer Discord
- [ ] #2 Sem DISCORD_TIMELINE_CHANNEL_ID a timeline fica desligada e a aplicação sobe normalmente
- [ ] #3 Falha ou lentidão do Discord nunca derruba nem atrasa a operação que publicou
- [ ] #4 Cada registro sai como embed com ator, alvo, valor na moeda certa, ID curto e hora
- [ ] #5 Rajada de registros é agrupada (até 10 embeds por mensagem), respeita o limite do Discord e mantém a ordem
- [ ] #6 Existe um publicador falso para testes, que as tasks de instrumentação usam para provar o que publicaram
- [ ] #7 O CLAUDE.md documenta a env e como criar o canal só para admins
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
