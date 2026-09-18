---
id: TASK-079
title: 'Timeline: loja'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-18 03:22'
updated_date: '2026-09-18 03:52'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6930
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações da loja. Decisões T1 a T14 no doc-005.

Item criado, editado e despublicado; pedido reservado, pego, devolvido à fila, entregue, cancelado e recusado; estorno de pedido entregue.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cada operação de item publica na timeline depois do commit, com ator e preço
- [x] #2 Cada transição de pedido publica na timeline, com comprador, item, valor e quem da staff agiu
- [x] #3 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ShopService injeta TIMELINE_PUBLISHER e publica depois do repo resolver (commit): item criado/editado/despublicado; pedido reservado, pego, devolvido, entregue, cancelado (comprador ou staff), recusado, estornado.
2. Nome e Discord de ator/comprador via listMemberNicks + findDiscordIdByUserId (sem repo novo, sem migration).
3. Recusas (ok:false, item inexistente) não publicam.
4. Teste de serviço contra Postgres com FakeTimelinePublisher cobrindo cada operação e as recusas; HTTP test da loja passa fake via AppModule.register.
5. Gate completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Instrumentado em ShopService (apps/server/src/shop/shop.service.ts), publicando só quando o repo devolveu ok (depois do commit). Ações: shop.item_created, shop.item_updated, shop.item_unpublished, shop.order_reserved, order_claimed, order_released, order_delivered, order_cancelled (detalhe 'Cancelado por' comprador/staff), order_rejected, order_refunded (detalhe 'Motivo do estorno'). Valores em currency buffunfa; alvo = comprador; ator = quem agiu (comprador na compra/cancelamento próprio, staff no resto).
Decisões fora do doc-005: nick/Discord do ator e comprador lidos depois do commit via listMemberNicks + findDiscordIdByUserId (sem repo novo); despublicado = edição que leva published de true para false (lido antes do update, só rótulo); montagem do registro em try/catch com aviso no log (T6).
Evidência: apps/server/src/shop/shop.timeline.http.test.ts (7 testes, FakeTimelinePublisher via AppModule.register; recusas 400/403/404/409 com entries vazio; publicador que lança não derruba create/purchase).
Skills: task-done-check. Sem UI (DoD#4 n/a). Não altera regra de ledger (só lê resultado) — DoD#6 revisado pelo agent: sem SQL novo, sem entrada de usuário nova.
## Quality gate: ⚠️ Passou com avisos

Commit `6cfac341` · local · 2026-09-18 03:40 UTC

| Métrica | Resultado | Threshold | Bloqueia | Status |
|---|---|---|---|---|
| Linting | 0 issue(s) | 0 | sim | ✅ |
| Race conditions | 0 detectada(s) | 0 | sim | ✅ |
| Typecheck | ok | 0 erros | sim | ✅ |
| Testes + coverage (branch) | 87.81% | ≥ 79% | sim | ✅ |
| E2E + screenshots (desktop/mobile) | 146 ok, 0 falha(s), 0 flaky na porta 4183 | 0 falhas | sim | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | sim | ✅ |
| Duplicação | 2.3171821920257467% | ≤ 15% | não | ✅ |
| Dead code | 10 item(s) | 0 (advisory) | não | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | sim | ✅ |
<!-- SECTION:NOTES:END -->
