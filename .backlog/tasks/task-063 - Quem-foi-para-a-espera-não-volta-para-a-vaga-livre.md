---
id: TASK-063
title: Quem foi para a espera não volta para a vaga livre
status: To Do
assignee: []
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 17:09'
labels:
  - eventos
  - painel
milestone: m-12
dependencies: []
modified_files:
  - apps/web/src/pages/StaffEvents.tsx
priority: high
type: bug
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fluxo quebrado hoje: o caller manda alguém da role para a lista de espera (botão "↓ espera"). Depois a vaga continua livre — e não há como devolver a pessoa para ela.

Causa no painel: em `apps/web/src/pages/StaffEvents.tsx`, o `SignupRow` monta os botões de destino com `roles.filter((r) => r.slotId !== signup.slotId)`, ou seja, só as **outras** roles. Para quem está na espera da role X, o botão "→ X" nunca aparece, embora seja exatamente o movimento necessário. O backend já aceita: `moveEventSignup` (`packages/db/src/event-signups-repo.ts`) só recusa `already_there` quando a inscrição já está `confirmed` naquela vaga, e a promoção automática existe, mas só dispara quando alguém **sai** da role — mandar para a espera não libera promoção por decisão explícita (senão a pessoa voltaria sozinha).

Efeito no start: `start` arrasta só inscritos confirmados que estão em "Aguardando Evento" (Q29). Quem ficou preso na espera não entra no evento nem com vaga sobrando, e não há saída manual. É o que o usuário observou.

Escopo: devolver o controle manual. Não mexer na regra de promoção automática nem na regra do start.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Na lista de espera de uma role com vaga livre, o painel oferece o botão de mover para essa mesma role
- [ ] #2 Mover da espera para a própria role com vaga livre confirma a pessoa e reordena a espera restante
- [ ] #3 Com a role lotada, o botão aparece desabilitado com o motivo, igual ao tratamento das outras roles
- [ ] #4 Sair da role continua promovendo o primeiro da espera automaticamente, e mandar alguém para a espera continua não promovendo ninguém no lugar dele
- [ ] #5 E2E cobre o ciclo: confirmar, mandar para a espera, devolver para a vaga e iniciar o evento com a pessoa sendo arrastada
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
