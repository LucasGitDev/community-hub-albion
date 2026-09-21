---
id: TASK-087
title: Chamar no privado quem se inscreveu e não entrou na call
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-21 13:02'
updated_date: '2026-09-21 14:56'
labels: []
milestone: m-12
dependencies:
  - TASK-085
priority: medium
type: feature
ordinal: 6845
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE12 a PE16 no doc-005. Ao iniciar o evento, quem está na sala de espera é movido para a call (já acontece). Quem se inscreveu como **confirmado** e não está na call recebe **mensagem no privado** pedindo para entrar.

Quem está na lista de espera não recebe (PE13). Privado fechado cai para menção no chat da call, com a lista de quem não pôde ser avisado (PE14).

O mesmo chamado é acionável pelo menu do evento no painel e pelo menu da call no Discord, com intervalo de 5 minutos por pessoa (PE15). **Substitui** o "chamar os ausentes" da TASK-085, que era menção no chat (PE16).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Iniciar o evento envia privado a cada confirmado que não está na call
- [x] #2 Quem está na lista de espera não recebe privado
- [x] #3 Quem está com o privado fechado é mencionado no chat da call, numa mensagem só, com a lista
- [x] #4 O caller aciona o mesmo chamado pelo menu do evento no painel
- [x] #5 O caller aciona o mesmo chamado pelo menu da call no Discord
- [x] #6 Chamar a mesma pessoa de novo em menos de 5 minutos não envia privado repetido
- [x] #7 Falha de envio no privado nunca derruba o início do evento
- [x] #8 Cada chamado publica na timeline com quem acionou e quantos foram avisados
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/db: tabela event_summons (event_id, user_id, last_sent_at, PK composta) + claimEventSummons() com INSERT ... ON CONFLICT DO UPDATE WHERE last_sent_at <= now-5min RETURNING user_id (intervalo por pessoa atômico e sobrevive a restart). Migration gerada com build do shared antes.
2. apps/server/src/domain/event-summon.ts: funções puras — alvos (confirmado, com discordId, fora da call; espera nunca, PE13), copy do privado (nome do evento + como entrar), mensagem única de menção da queda (PE14), respostas do menu e do painel, EVENT_SUMMON_COOLDOWN_MS.
3. EventVoiceGateway ganha sendDirectMessage(discordId, view); DiscordJs implementa via user.send. Fakes dos testes estendidos.
4. apps/server/src/bot/event-summon.service.ts: porta EVENT_SUMMONER (token em domain/, injetada @Optional no controller como o MEMBER_IMPORTER). Checa CASL update em Event com dono, exige running + canal, calcula alvos, reserva o intervalo, manda privado um a um, quem recusar cai numa única menção no chat da call, publica timeline event.call_summoned com ator e contagem.
5. EventVoiceService.openChannel chama o summoner dentro de try/catch depois de arrastar a sala de espera (AC#1/AC#7).
6. Quarta ação no menu da call: botão 'Chamar quem falta' + @Button em EventCallInteractions (AC#5).
7. POST /api/events/:id/summon no EventsController + api/events.ts + botão no painel (AC#4).
8. Testes: unit das funções puras, integração do claim no banco, service (espera não recebe, privado fechado vira menção, intervalo, timeline), interactions, http do endpoint, e2e do painel.
9. Gate completo, screenshots 1280/400, skills, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementação: um serviço só (EventSummonService, BotModule) para as três portas — início do evento, menu da call e endpoint do painel. Porta EVENT_SUMMONER injetada @Optional no EventsController (padrão do MEMBER_IMPORTER): sem bot, 503 com texto claro.

Intervalo de 5 minutos: tabela event_summons (event_id, user_id, last_sent_at, PK composta) e claimEventSummons — um INSERT ... ON CONFLICT DO UPDATE ... WHERE last_sent_at <= now-5min RETURNING user_id. Atômico (dois cliques simultâneos liberam a pessoa uma vez só) e sobrevive a restart, ao contrário de um Map em memória. A reserva acontece ANTES de qualquer envio.

Ambiente: o Postgres compartilhado do gate (localgate-postgres-1) chegou a 99% do volume, com 1320 bancos de teste acumulados de todas as worktrees. Dois arquivos de teste falharam com o código 53100 do Postgres (sem espaço em disco), nada a ver com a mudança. Limpei os bancos das tasks já mergeadas (t000 a t085), preservando t086 (outro agent) e t087.

## Quality gate (commit 448a9c02, local)
| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 87.22% | ≥ 79% | ✅ |
| E2E desktop/mobile | 160 ok, 0 falha(s), 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 2.15% | ≤ 15% | ✅ |
| Dead code | 10 item(s), todos pré-existentes | 0 (advisory) | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

## Evidência por AC
| AC | Evidência |
|---|---|
| #1 | apps/server/src/bot/event-voice.service.test.ts "AC#1/AC#2: o start move a sala de espera e chama no privado só o confirmado que ficou de fora" |
| #2 | mesmo teste + apps/server/src/domain/event-summon.test.ts "a lista de espera nunca é chamada" + event-call.interactions.test.ts "AC#2: quem está na lista de espera não recebe privado" |
| #3 | event-call.interactions.test.ts "AC#3: privado fechado vira menção no chat da call, numa mensagem só, com a lista" + event-voice.service.test.ts "AC#3/AC#7" |
| #4 | apps/server/src/events/event-summon.http.test.ts "AC#4: o caller aciona o chamado pelo painel" + e2e/summon-absentees.spec.ts (desktop 1280 e mobile 400) |
| #5 | event-call.interactions.test.ts "AC#5: o caller aciona pelo menu da call, e quem já está dentro não é chamado" |
| #6 | event-call.interactions.test.ts "AC#6: chamar de novo antes de 5 minutos não manda privado repetido" (4m59s não manda, 5m00 manda) + packages/db/src/event-summons.integration.test.ts (5 casos, Postgres real, inclusive dois cliques simultâneos) |
| #7 | event-voice.service.test.ts "AC#7: o Discord recusando privado e menção não derruba o início do evento" |
| #8 | event-call.interactions.test.ts "AC#8: o chamado publica na timeline com quem acionou e quantos foram avisados" + asserções de timeline no teste do start |

Security review (diff da branch, subagent dedicado): nenhum achado HIGH/MEDIUM. Superfícies conferidas: authz/CSRF do endpoint novo (SameOriginGuard + Authorize + assertCan com condição de dono, igual aos irmãos), ator sempre da sessão (o endpoint não lê corpo) e re-checado dentro do serviço, botão do Discord (custom_id só carrega o eventId, validado e recarregado; identidade vem de interaction.user.id), injeção de menção (allowedMentions com users explícito neutraliza @everyone em nome de evento), SQL (drizzle parametrizado, sem sql.raw), exposição de dados (resposta é só a contagem), e o caminho do start que pula CASL (só alcançável pelo hook da transição já autorizada).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Chamado de quem confirmou e não entrou na call (PE12 a PE16): um serviço só (EventSummonService) atende o início do evento, a quarta ação do menu da call e o menu do evento no painel. Confirmado fora da call recebe privado com o nome do evento e link de um clique para a call; a lista de espera nunca recebe; privado fechado cai para uma única menção no chat da call com a lista inteira; o intervalo de 5 minutos por pessoa é reservado no banco (tabela event_summons, INSERT ... ON CONFLICT ... WHERE atômico) antes de qualquer envio, então sobrevive a restart e a dois callers clicando junto. Falha de envio nunca derruba o início do evento, e cada chamado publica na timeline com quem acionou e a contagem. Verificado com gate verde (coverage 87.22%, e2e 160/160, imagem Docker ok), testes de integração com Postgres real e Discord falso, e e2e do painel em 1280 e 400.
<!-- SECTION:FINAL_SUMMARY:END -->
