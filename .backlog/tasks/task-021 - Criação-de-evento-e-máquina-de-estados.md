---
id: TASK-021
title: Criação de evento e máquina de estados
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 01:04'
labels:
  - events
  - backend
  - db
milestone: m-4
dependencies:
  - TASK-020
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Só caller cria evento (Q9); owner único transferível por staff (Q21); estados draft→open→closed→running→finished + cancelled (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Caller cria evento a partir de template e vira owner
- [x] #2 Não-caller não cria evento
- [x] #3 Transições inválidas são rejeitadas; testes cobrem todas as transições válidas
- [x] #4 Staff transfere owner e o histórico é mantido
- [x] #5 Inscrição fecha manualmente ou no horário configurado
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared: eventos - máquina de estados (EVENT_STATUSES, ALLOWED_TRANSITIONS, canTransition, transitionError) + schemas zod de criação/transferência + DTOs; testes exaustivos de todos os pares de transição (Q26).
2. db: tabelas events, event_role_slots (snapshot das roles do template na criação) e event_owner_history; migration via pnpm db:generate; events-repo (create com snapshot, get/list com filtros, applyTransition com timestamp por estado, transferOwner com histórico, closeDueEvents idempotente); testes de integração.
3. server: EventsModule com POST /api/events, GET /api/events, GET /api/events/:id, POST /api/events/:id/transitions/{open,close,start,finish,cancel} (owner ou staff via ability + asSubject), POST /api/events/:id/owner (staff, grava histórico). EventsService com hook onEventTransition (ListenerSet) para TASK-022/024 assinarem sem mudar o serviço. Transição inválida -> 409 PT-BR.
4. server: EventSignupsCloseService (intervalo 30s, clock injetável) fecha eventos open com signups_close_at vencido; idempotente e logado (AC#5).
5. Testes HTTP: caller cria e vira owner; membro 403; caller não-owner 403 nas transições; staff pode; transição inválida 409; transferência de owner grava histórico; job fecha só os vencidos.
6. Sem UI (painel é TASK-023). security-review, gate completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisões TASK-021:
- Máquina de estados pura em packages/shared/src/events.ts (ALLOWED_EVENT_TRANSITIONS + canTransition): mesma fonte para API, bot (TASK-022/024) e painel (TASK-023). 9 arestas: draft→open|cancelled, open→closed|running|cancelled, closed→running|cancelled, running→finished|cancelled. `open→running` existe porque Q26 diz que o start fecha a inscrição (o repo carimba closed_at junto). Sem volta (closed→open, running→open): reabrir não está em nenhuma Q da v1 e bagunçaria a janela de presença (Q6); entra depois se houver pedido.
- Snapshot de roles: `event_role_slots` copia nome + vagas do template na criação. Template é editável pela staff a qualquer hora (TASK-020); sem a cópia, editar o template mudaria as vagas de um evento já publicado e um inscrito perderia lugar sem ninguém tocar no evento. `role_id` é `on delete set null` (o nome já está guardado) e `template_id` do evento é `restrict` (não apagar a origem do evento).
- Carimbo por transição na própria linha do evento (opened_at, closed_at, started_at, finished_at, cancelled_at) + checks no banco amarrando estado e carimbo. `event_owner_history` é append-only e a criação já grava a primeira linha (from null), então o histórico nunca tem buraco (AC#4).
- Concorrência: applyEventTransition e transferEventOwner rodam em transação com `for update` e revalidam a máquina lá dentro; dois cliques em "iniciar" não geram dois starts.
- Hook para TASK-022/024: `EventsService.onEventTransition` (mesmo padrão de NickDecisionService.onDecided, via ListenerSet). Emite { event, from, to, transition, actorUserId }; `transition: "auto-close"` e actor null quando foi o job. Listener que estoura é logado e não desfaz a transição — provado em teste. TASK-022 (embed) e TASK-024 (canal de voz) assinam sem mexer neste serviço.
- AC#5 automático: EventSignupsCloseService com intervalo de 30s e relógio injetável (EVENTS_CLOCK), ligado no onApplicationBootstrap. Fecha por UPDATE filtrado em status='open' (idempotente por construção), loga o que fechou e não conhece Discord. Índice parcial events_signups_close_idx só nos abertos.
- Autorização: criar exige `create Event` (caller e staff, Q9); transições checam a regra CASL com condição no handler (ability.can(action, asSubject("Event", { ownerId }))) — open/close = update, start/finish/cancel têm ação própria; transferir owner exige `manage Event` (só staff, Q21). Toda rota de escrita com SameOriginGuard.
- Sem UI nesta task: o painel de eventos é TASK-023.

Gate completo (local, commit 82c52b90): ⚠️ passou com avisos — lint 0, race 0, typecheck ok, coverage branch 94.63% (≥79), e2e 34 ok/0 falhas, imagem Docker build+smoke ok, duplicação 0.4%, audit 0 high. Aviso não bloqueante: dead code 7 (exports shadcn pré-existentes, iguais aos da TASK-020).

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 caller cria e vira owner | events.http.test.ts 'caller cria evento a partir do template e vira owner, com snapshot das roles' (ownerUserId/createdByUserId = caller, roles Tank:1/Healer:2, histórico com from null); db.integration 'cria em draft com snapshot das roles do template e primeira linha de histórico' | ✅ |
| AC#2 não-caller não cria | events.http.test.ts 'membro não cria evento: 403 (AC#2, Q9); staff cria' + 401 sem sessão e 403 de outra origem | ✅ |
| AC#3 transições inválidas e cobertura total | events.test.ts 'cobre todos os 36 pares de estados: só as 9 arestas da tabela são permitidas' (tabela-verdade escrita à mão, não derivada do mapa) + terminais, auto-transição e sentido único; events.http.test.ts 409 PT-BR 'está rascunho e não pode ir para finalizado' e 'Esse é um estado final' sem mudar o estado; caminho feliz completo com os 4 carimbos | ✅ |
| AC#4 staff transfere owner com histórico | events.http.test.ts 'staff transfere o owner e o histórico guarda a troca; caller não transfere' (403 para caller/membro, 200 para staff, histórico [null→caller, caller→caller2], owner novo manda e o antigo perde o comando); db.integration 'staff transfere owner e o histórico guarda cada troca' | ✅ |
| AC#5 inscrição fecha manual ou no horário | events.http.test.ts 'fechamento automático fecha só os eventos open com horário vencido e é idempotente' (1 fechado, 2ª passada 0, futuro/sem prazo/rascunho intactos, relógio avança e fecha o outro, `close` na mão fecha); events-signups-close.service.test.ts (relógio injetável, sem empilhar passadas, erro vira log, start idempotente, shutdown desliga) | ✅ |
| DoD#6 security-review | sem achado ≥ confiança 8: autorização por objeto com asSubject conferida, owner não spoofável no create (zod strip), `:transition` imune a toString/__proto__ (Object.hasOwn), SQL só via query builder com bind, zod em body e query, SameOriginGuard em toda escrita, 404 antes do 403 não vaza existência | ✅ |
| DoD#4 UI | não se aplica: nenhuma tela alterada (painel de eventos é TASK-023) | — |

Skills: security-review, task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Eventos criados a partir de template com o caller virando owner (Q9/Q21) e máquina de estados draft→open→closed→running→finished + cancelled (Q26) compartilhada em @albion-hub/shared, aplicada em transação com for update pelo repo e exposta em /api/events (criação, transições open/close/start/finish/cancel restritas ao owner ou à staff, transferência de owner só para staff com histórico, listagem com filtros). As roles e vagas do template são copiadas para event_role_slots na criação, para que editar o template depois não altere evento já publicado. Um job de 30s com relógio injetável fecha as inscrições no horário marcado, e EventsService.onEventTransition deixa TASK-022/024 assinarem as transições sem mudar o serviço. Verificado com 14 testes unitários da máquina (todos os 36 pares de estados), 10 testes de integração no Postgres (snapshot, carimbos, histórico de owner, fechamento idempotente) e 11 testes HTTP (401/403/409/400, caller vira owner, não-owner barrado, staff intervém, hook emitido), gate completo verde e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
