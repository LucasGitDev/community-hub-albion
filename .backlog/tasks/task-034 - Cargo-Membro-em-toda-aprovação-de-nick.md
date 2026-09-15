---
id: TASK-034
title: Cargo Membro em toda aprovação de nick
status: To Do
assignee: []
created_date: '2026-09-15 13:59'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-014
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mudança pedida pelo usuário (2026-09-15): toda aprovação de nick, inclusive troca, garante o cargo Membro além de trocar o apelido (substitui a regra da Q31 de dar cargo só na primeira aprovação). Base: TASK-014 (DiscordMemberSync).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Primeira aprovação troca apelido e concede cargo Membro
- [ ] #2 Aprovação de troca de nick troca apelido e concede cargo Membro se ausente
- [ ] #3 Rejeição continua sem alterar apelido nem cargos
- [ ] #4 Falha no Discord continua registrada sem desfazer a aprovação
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
