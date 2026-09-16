---
id: TASK-042
title: Importar membros já registrados do Discord
status: To Do
assignee: []
created_date: '2026-09-16 03:53'
updated_date: '2026-09-16 03:56'
labels:
  - bot
  - backend
dependencies: []
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O servidor já tem 24 membros com o cargo Membro e apelido in-game definido (muitos com tag de guilda, ex: '[GENEI] Erijj'). Importar essas contas evita pedir /registrar a quem já está regularizado. Import idempotente disparado por admin, sem tocar em quem já tem conta.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Admin dispara a importação (comando do bot ou painel) e recebe resumo: criados, atualizados, ignorados, conflitos
- [ ] #2 Cada membro com cargo Membro vira conta com papel member e nick aprovado derivado do apelido do Discord
- [ ] #3 Tag de guilda no apelido (ex: '[GENEI] ') é removida antes de virar nick; nick inválido entra em conflitos sem quebrar a importação
- [ ] #4 Reexecutar não duplica conta nem sobrescreve nick já aprovado no painel
- [ ] #5 Membro sem apelido ou sem cargo Membro é ignorado e listado no resumo
- [ ] #6 Apelido é separado em tag de guilda (opcional) e nick; ambos ficam guardados
- [ ] #7 Nick importado é validado na API do Albion (região configurada) e o resultado fica registrado com data
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
