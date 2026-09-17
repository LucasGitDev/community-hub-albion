---
id: TASK-050
title: Banimento de jogador no painel
status: To Do
assignee: []
created_date: '2026-09-17 02:19'
labels:
  - admin
  - backend
  - discord
  - web
dependencies: []
priority: high
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff e admin podem banir um jogador. O banimento corta o acesso IMEDIATAMENTE (não espera a verificação diária de guilda): bloqueia login no painel, o bot recusa inscrição em evento pelo embed, e o cargo Membro é removido no Discord. NÃO expulsa nem bane do servidor do Discord — essa decisão é separada e continua no Discord. Soft delete: a conta fica na lista de membros marcada como banida, com motivo, autor e data, e dá para desbanir; o nick continua ocupado para não embaralhar o histórico. Saldo fica CONGELADO: não é zerado, não pode ser sacado, e saque pendente não é aprovado enquanto durar o banimento. Permissão para staff é provisória até existirem permissões separadas de papéis.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff e admin banem com motivo obrigatório; membro e caller não conseguem
- [ ] #2 Banimento revoga as sessões na hora e bloqueia novo login
- [ ] #3 Bot recusa inscrição em evento de jogador banido, pelo embed e pelo painel
- [ ] #4 Cargo Membro é removido no Discord ao banir
- [ ] #5 Banido aparece na lista de membros marcado, com motivo, autor e data; desbanir restaura o acesso
- [ ] #6 Saldo e ledger intactos; saque novo é recusado e saque pendente não pode ser aprovado
- [ ] #7 Nick do banido continua ocupado
- [ ] #8 security-review sem achados críticos
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
