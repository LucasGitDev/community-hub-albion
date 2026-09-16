---
id: TASK-038
title: Import e export de templates de evento em YAML
status: To Do
assignee: []
created_date: '2026-09-16 03:45'
labels:
  - backend
  - frontend
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-001: DB é fonte de verdade; YAML é só import/export. Staff exporta template(s) e importa de volta, inclusive em outro servidor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff exporta um template como YAML pelo painel
- [ ] #2 Staff importa YAML e o template é criado com roles e vagas
- [ ] #3 Import valida schema e reporta erro legível sem gravar nada
- [ ] #4 Roles inexistentes no catálogo são criadas ou reportadas conforme decisão registrada
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
