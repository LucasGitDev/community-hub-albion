---
id: TASK-052
title: Permissões separadas dos papéis
status: To Do
assignee: []
created_date: '2026-09-17 02:20'
labels:
  - rbac
  - backend
dependencies: []
priority: low
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje staff é um bloco: quem é staff ganha tudo que staff faz. O usuário quer conceder capacidade a capacidade (ver extrato, banir, editar membro, aprovar saque...) sem depender do papel. Torna definitivas as permissões provisórias das TASK-047 e TASK-049 (banimento). Desenho a combinar antes de implementar.
<!-- SECTION:DESCRIPTION:END -->

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
