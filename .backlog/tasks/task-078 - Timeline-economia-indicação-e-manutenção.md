---
id: TASK-078
title: 'Timeline: economia, indicação e manutenção'
status: To Do
assignee: []
created_date: '2026-09-18 03:22'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações que movem dinheiro. Decisões T1 a T14 no doc-005.

Loot split confirmado; saque pedido, aprovado, recusado e entregue; taxa de entrada cobrada e devolvida; Buffunfa por presença paga; indicação declarada, paga e estornada; ajustes de prata e de Buffunfa pela manutenção, revalidação de nick e limpeza sob demanda.

As rotas de manutenção aparecem **sempre**, com o ator "manutenção" (T9): elas criam prata em produção, e é justamente o que o canal de auditoria precisa ver. Valores em prata aparecem por inteiro — o canal é só de admins (T2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cada operação listada publica na timeline depois do commit, com ator, alvo, valor na moeda certa e ID
- [ ] #2 Ajuste pela rota de manutenção publica com ator "manutenção" e o motivo informado
- [ ] #3 Pagamento em lote (Buffunfa por presença, loot split) publica um registro por pessoa ou um consolidado legível, sem estourar o limite do Discord
- [ ] #4 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
