---
id: TASK-065
title: Import de YAML sobrescreve a descrição global da role
status: To Do
assignee: []
created_date: '2026-09-17 17:37'
labels: []
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-010 - Role-e-build-por-tipo-de-conteúdo.md
priority: high
type: bug
ordinal: 7050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado do spike TASK-064 (doc-010), com perda de dado silenciosa.

O YAML de template já trata `description` como propriedade do par (template, role) — ver `packages/shared/src/event-template-yaml.ts:14-22`. O banco não tem onde guardar isso: `event_template_roles` só tem `slots` e `sort_order`, e a descrição vive uma única vez no catálogo global `event_roles`. Então o import despeja a descrição no catálogo (`packages/db/src/event-templates-repo.ts:191`).

Efeito: importar um template de ZvZ com a descrição do "Tank" daquele conteúdo **reescreve o Tank de todos os outros templates**. Ninguém é avisado, e a descrição anterior se perde.

Este bug não espera a decisão de modelagem da TASK-064 (que está congelada): mesmo que a coluna por par nunca exista, sobrescrever silenciosamente catálogo global num import é errado. A correção mínima é não deixar o import escrever por cima de descrição já preenchida, avisando o que foi ignorado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Importar um template não altera a descrição de uma role que já tem descrição no catálogo
- [ ] #2 O resultado do import diz explicitamente quais descrições foram ignoradas e por quê
- [ ] #3 Role nova, sem descrição no catálogo, continua recebendo a descrição do YAML
- [ ] #4 Teste cobre o caso de dois templates com a mesma role e descrições diferentes
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
