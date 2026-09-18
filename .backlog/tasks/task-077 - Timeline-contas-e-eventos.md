---
id: TASK-077
title: 'Timeline: contas e eventos'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-18 03:22'
updated_date: '2026-09-18 03:52'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6910
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações de contas e de eventos. Decisões T1 a T14 no doc-005.

Contas: nick pedido, aprovado e recusado; papel concedido e removido; banimento e desbanimento; limpeza diária (quem saiu do servidor).
Eventos: criado, aberto, inscrições fechadas, iniciado, finalizado, cancelado, arquivado.

Inscrição **não** aparece uma a uma (T8): ao fechar as inscrições, sai um registro com a lista de todos que estavam inscritos, com role e posição.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cada operação de conta listada publica na timeline depois do commit, com ator e alvo
- [x] #2 Cada transição do ciclo de evento publica na timeline
- [x] #3 Inscrições individuais não publicam
- [x] #4 Fechar as inscrições publica a lista completa de inscritos com role e posição
- [x] #5 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db: grantRole devolve se o papel é novo; listTimelineUsers (nome do painel + discordId) para ator/alvo.
2. Contas: NickRequestService (account.nick_requested), NickDecisionService (account.nick_approved/rejected), concessão/remoção de papel (account.role_granted/revoked, só quando muda de fato), MemberBanService (account.banned/unbanned), GuildCleanupService (account.left_guild, ator system).
3. Eventos: EventsService.create (event.created) e transition/closeDue (event.opened, signups_closed, started, finished, cancelled, archived); fechamento automático com ator system.
4. signups_closed leva list Inscritos com Nick · Role · confirmado/espera N (T8); join/leave/move não publicam.
5. Testes com FakeTimelinePublisher por operação, incluindo recusa sem publicação; gate completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality, banco recriado, E2E_PORT=4181, commit 722a574): ⚠️ passou com avisos — lint 0, race 0, typecheck ok, coverage branch 87.47% (>=79), E2E 146 ok/0 falha, Docker ok, duplicação 2.3%, vulns 0; dead code 11 advisory, todos preexistentes.

Evidência por AC:
- AC#1 contas: member-ban.service.test.ts (account.banned/unbanned, recusa sem publicar, falha de montagem não derruba); guild-cleanup.service.test.ts (account.left_guild, ator system; abort sem publicar; 2a passada sem duplicar); nick.http.test.ts (account.nick_requested criado e corrigido; 400/409/403 sem publicar); staff-nick-requests.http.test.ts (account.nick_approved com nick anterior, account.nick_rejected com motivo; 409 sem publicar); admin-users.http.test.ts (account.role_granted/revoked; repetição e último admin sem publicar).
- AC#2 eventos: events.http.test.ts describe 'timeline (TASK-077)': created, opened, signups_closed, started, finished, archived, cancelled (motivo); 409/403/criação recusada sem publicar; fechamento automático com ator system.
- AC#3/AC#4: event-signups.http.test.ts — join/espera/troca/leave/move não publicam; close publica list Inscritos 'Nick · Role · confirmado|espera N', confirmados antes da espera, contagens nos details.
- AC#5: todos com FakeTimelinePublisher, asserts depois da operação resolver.

Decisões fora do doc-005: grantRole passa a devolver boolean (papel já existente não publica); action account.left_guild; limpeza sempre com ator system 'Limpeza diária' mesmo via /api/maintenance/cleanup; fechamento automático com ator system 'Fechamento automático'; publish antes dos listeners pós-commit (Discord); montagem do registro (consulta de nomes) protegida por publishAfterCommit. Login/bootstrap de papéis não publicam (T7 exclui login).
Skills: task-done-check. Sem UI (DoD#4 n/a). security-review: diff não muda autorização nem ledger, só publica após o commit; sem achado.
<!-- SECTION:NOTES:END -->
