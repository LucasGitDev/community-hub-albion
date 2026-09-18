---
id: TASK-076
title: 'Timeline: publicador, fila e canal de admins no Discord'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-18 03:21'
updated_date: '2026-09-18 03:52'
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
- [x] #1 Existe uma interface de publicação única que os serviços usam, sem conhecer Discord
- [x] #2 Sem DISCORD_TIMELINE_CHANNEL_ID a timeline fica desligada e a aplicação sobe normalmente
- [x] #3 Falha ou lentidão do Discord nunca derruba nem atrasa a operação que publicou
- [x] #4 Cada registro sai como embed com ator, alvo, valor na moeda certa, ID curto e hora
- [x] #5 Rajada de registros é agrupada (até 10 embeds por mensagem), respeita o limite do Discord e mantém a ordem
- [x] #6 Existe um publicador falso para testes, que as tasks de instrumentação usam para provar o que publicaram
- [x] #7 O CLAUDE.md documenta a env e como criar o canal só para admins
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Env opcional DISCORD_TIMELINE_CHANNEL_ID (snowflake, sem refine: T6).
2. domain/timeline.ts: tipo TimelineEntry (action com domínio, ator user/maintenance/system, alvo, amounts bigint+moeda, recordId, detalhes, lista), interface TimelinePublisher (publish síncrono, nunca lança) e token TIMELINE_PUBLISHER.
3. domain/timeline-embed.ts: render puro do embed (formatAmount, ID curto, timestamp, truncamento nos limites do Discord).
4. domain/timeline-queue.ts: fila em memória, lotes de até 10 embeds e 6000 caracteres, janela de 5 mensagens/5s, ordem FIFO, teto de memória, falha vira log.
5. timeline/: DiscordTimelinePublisher, NoopTimelinePublisher, FakeTimelinePublisher (testes) e TimelineModule global (Discord só com bot ligado + env; senão no-op).
6. Testes unitários de cada peça + AppModule sobe sem a env.
7. CLAUDE.md e .env.example: env e criação do canal só para admins (T13).
8. Gate completo, security-review, task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality, commit 0cff05d, local, E2E_PORT=4180): lint 0, race 0, typecheck ok, coverage branch 87.81%, e2e 146 ok/0 falha, Docker build+smoke ok, duplicação 2.33%, audit 0. Dead code advisory: tipos do contrato (TimelineTarget/Amount/Detail/List/Domain) ainda sem consumidor — 077/078/079 consomem; exports internos sobrando removidos em 8b9f50b.

Evidência por AC:
- AC#1: domain/timeline.ts (TIMELINE_PUBLISHER, TimelinePublisher, TimelineEntry) sem import de discord.js; TimelineModule global injeta em qualquer serviço.
- AC#2: env.test.ts 'canal da timeline (TASK-076, T6)'; app.module.test.ts 'sem DISCORD_TIMELINE_CHANNEL_ID sobe normal com a timeline desligada'; timeline.module.test.ts (sem canal ou sem bot = no-op).
- AC#3: discord-timeline.publisher.test.ts 'Discord lento não atrasa quem publicou' (200 publishes < 200ms, 0 envios síncronos), 'falha do Discord vira aviso', 'canal inexistente...', 'registro malformado não lança', 'logger quebrado'; timeline.module.test.ts guardTimeline.
- AC#4: domain/timeline.test.ts 'leva ator, alvo, valores na moeda certa, ID curto e hora' (formatAmount: 1.482.300 / 340 BUF), ator manutenção (T9), lista (T8), limites do embed.
- AC#5: domain/timeline-queue.test.ts: lotes 10/10/3 em ordem, janela 5 msgs/5s, 6000 chars por mensagem, falha mantém ordem, fila cheia.
- AC#6: timeline/fake-timeline.publisher.ts + teste; AppModule.register(env,{timeline: fake}) e timeline.module.test 'dublê de teste substitui'.
- AC#7: CLAUDE.md seção 'Timeline no Discord (TASK-076)'.

Skills: security-review (sem achado: allowedMentions vazio, markdown escapado, nenhum segredo em log), task-done-check. Sem UI: skills de design e screenshots não se aplicam.
Decisões fora do doc-005: publish síncrono void; guardTimeline envolve qualquer implementação; teto de 1000 registros na fila (excedente descartado com aviso); lista cortada em ~3000 chars com '… e mais N'; ID curto = 8 primeiros caracteres, ID inteiro no rodapé; Discord publisher exige bot ligado.
<!-- SECTION:NOTES:END -->
