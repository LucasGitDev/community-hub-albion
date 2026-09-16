---
id: TASK-041
title: Meu nick vira Meu perfil
status: To Do
assignee: []
created_date: '2026-09-16 03:45'
labels:
  - frontend
  - backend
dependencies: []
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Renomear e ampliar a página /nick para /perfil, base para futuras configurações e perfil compartilhável no servidor. Nesta task: nick + dados básicos do Discord + papéis, sem novas configurações.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rota /perfil mostra nick, conta Discord e papéis
- [ ] #2 Fluxo de registro/troca de nick continua igual
- [ ] #3 Navegação e textos atualizados; /nick redireciona para /perfil
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
