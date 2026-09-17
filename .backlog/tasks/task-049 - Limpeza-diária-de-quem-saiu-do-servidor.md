---
id: TASK-049
title: Limpeza diária de quem saiu do servidor
status: To Do
assignee: []
created_date: '2026-09-17 02:19'
labels:
  - backend
  - discord
dependencies: []
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Job agendado no Nest (madrugada, diário) que verifica quem não está mais no servidor do Discord: derruba as sessões, remove os papéis e marca a conta como inativa na lista de membros, com data. Saldo e ledger NUNCA são tocados: prata é dívida com a pessoa, mesmo que ela saia. Pode ser disparado sob demanda pelo namespace de manutenção (TASK-048).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Job roda diário de madrugada e é idempotente
- [ ] #2 Quem saiu do servidor perde sessões e papéis e fica marcado como inativo com data
- [ ] #3 Quem continua no servidor não é afetado
- [ ] #4 Saldo, lançamentos do ledger e saques existentes ficam intactos
- [ ] #5 Falha na API do Discord não derruba ninguém por engano nem quebra o job
- [ ] #6 security-review sem achados críticos
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
