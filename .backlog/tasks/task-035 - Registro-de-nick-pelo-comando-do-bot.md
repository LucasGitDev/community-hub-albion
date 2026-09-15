---
id: TASK-035
title: Registro de nick pelo comando do bot
status: To Do
assignee: []
created_date: '2026-09-15 13:59'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-012
  - TASK-015
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mudança pedida pelo usuário (2026-09-15): membro registra ou troca o nick por slash command no Discord, sem precisar abrir o painel. Reusa o mesmo serviço do painel (doc-002), dispara o embed da staff (TASK-015) e a consulta Albion (TASK-016). O site continua funcionando como alternativa.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Comando PT-BR permite enviar nick sem login prévio no painel; usuário é criado a partir da conta Discord
- [ ] #2 Solicitação criada pelo comando fica pending e publica o embed da staff
- [ ] #3 Mesmas regras do painel: validação de nick, uma pendência por usuário, troca mantém nick vigente até aprovação
- [ ] #4 Respostas do comando são efêmeras e informam o estado (enviado, corrigido, já aprovado, inválido)
- [ ] #5 Comando só funciona na guild configurada
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
