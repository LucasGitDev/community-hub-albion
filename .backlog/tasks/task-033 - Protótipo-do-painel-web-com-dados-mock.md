---
id: TASK-033
title: Protótipo do painel web com dados mock
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:31'
updated_date: '2026-09-15 03:50'
labels:
  - frontend
milestone: m-0
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MVP navegável do painel (PT-BR, dark, tema Albion sem assets do jogo) com login Discord mockado e dados mock. Antecipa UI de TASK-004/010/031/032 pra validar design antes do backend. Skills: frontend-design, emil-design-eng, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Login mock permite entrar como membro ou staff/caller
- [ ] #2 Membro vê saldo disponível, reservado e extrato de prata com números em destaque
- [ ] #3 Membro pede saque respeitando mínimo e saldo disponível, e acompanha status
- [ ] #4 Estados pending/approved/rejected/settled visualmente distintos por cor, ícone e texto
- [ ] #5 Staff vê fila de saques e placeholders de eventos/membros; membro não vê rotas de staff
- [ ] #6 Build, typecheck passam; layout funciona em mobile (~400px)
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
1. Scaffold apps/web (Vite, React, TS, Tailwind v4, tokens shadcn-style). 2. Mock de auth/usuários/ledger/saques em memória+localStorage. 3. Layout com nav por papel. 4. Telas: login, carteira (saldo+extrato), saques, staff saques, placeholders. 5. Build + screenshots mobile/desktop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementado em apps/web: login mock (4 usuários de papéis diferentes), carteira (saldo disponível/total/reservado + extrato por dia com estorno), meus saques, fila de saques staff (aprovar/recusar com motivo/entregar com nota), placeholders de eventos/membros/splits. Store mock em localStorage. Verificado: typecheck + build ok, screenshots desktop 1280 e mobile 400. Aguardando validação visual do usuário.
<!-- SECTION:NOTES:END -->
