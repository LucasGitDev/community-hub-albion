---
id: TASK-013
title: Aprovação de nick pelo painel staff
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 12:57'
labels:
  - backend
  - frontend
milestone: m-2
dependencies:
  - TASK-012
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff aprova ou rejeita solicitações de nick (Q14, Q31). Skills (doc-003): emil-design-eng, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff vê fila de pendentes e aprova ou rejeita
- [ ] #2 Aprovação torna o nick vigente; rejeição mantém o anterior
- [ ] #3 Usuário sem permissão de staff não acessa a fila nem a API
- [ ] #4 Decisão registra quem aprovou/rejeitou e quando
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db: decideNickRequest (approve/reject) transacional em nick-repo com lock FOR UPDATE; approve grava users.game_nick; conflito em não pendente; getNickStatus traz última recusa; testes de integração (audit, nick mantido, dupla decisão, concorrência).
2. server: módulo members com NickDecisionService (approve/reject + listeners NICK_DECISION_LISTENERS p/ TASK-014) + StaffNickRequestsController GET /api/staff/nick-requests, POST :id/approve, :id/reject (Authorize approve MemberRequest, SameOriginGuard, uuid/zod); testes unit + HTTP (401/403/validação/audit).
3. me/nick expõe lastRejection; web /nick mostra motivo da recusa.
4. web /staff/membros: fila com Aprovar nick / Recusar + motivo obrigatório, toasts, empty state; emil-design-eng + ask-sonner.
5. e2e desktop+mobile (aprovar, recusar com motivo, membro sem acesso); visual MCP 1280/400; security-review; quality; PR.
<!-- SECTION:PLAN:END -->
