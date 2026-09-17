---
id: TASK-060
title: Fila de pedidos da loja com entrega manual pela staff
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 19:09'
labels: []
milestone: m-6
dependencies:
  - TASK-059
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fecha o ciclo da F6: o pedido comprado vira uma fila que a staff trabalha, no molde da fila de saques que já existe (linha com status e carimbos, reserva sem ledger, lançamento na conclusão, FK única para o lançamento gerado).

Estados: pending -> claimed -> delivered, mais cancelled (comprador) e rejected (staff). Sem confirmação do comprador e sem disputa: a staff é confiável, e exigir clique do comprador encheria a fila de pedidos entregues e eternamente abertos (F6-21).

O claimed existe para a staff sinalizar "peguei este" antes de entrar no jogo — sem ele, dois membros da staff entregam o mesmo item e ninguém descobre. E ele volta para pending se a staff desistir, porque o membro não pode ficar preso a um staff que sumiu (F6-22).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 O pedido percorre pending -> claimed -> delivered, com cancelled e rejected como terminais
- [x] #2 Transição inválida é recusada pelo serviço e pelo banco, no mesmo padrão dos checks de withdrawals
- [x] #3 A staff assume um pedido (claimed) e pode devolvê-lo à fila, voltando para pending
- [x] #4 A entrega exige nota da staff dizendo onde e para quem foi entregue
- [x] #5 A Buffunfa fica reservada em pending e só entra no ledger em delivered
- [x] #6 O comprador cancela o próprio pedido enquanto estiver pending; depois de claimed, só a staff
- [x] #7 Cancelar, rejeitar ou estornar devolve a Buffunfa e o estoque na mesma transação, nunca só um dos dois
- [x] #8 A staff enxerga a fila de pedidos em um painel, no molde da fila de saques
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared/shop.ts: acrescentar 'claimed' e 'rejected' aos estados; transições reserved→claimed|cancelled|rejected, claimed→reserved|delivered|cancelled|rejected, terminais vazios (entregar exige ter pegado, F6-22); RESERVING passa a incluir claimed (Buffunfa segue reservada até o débito); labels, schemas de nota (entrega/recusa/cancelamento/estorno) e helper de quem pode cancelar.
2. packages/db/schema.ts + migration 0020: ADD VALUE no enum, checks com cast ::text (ALTER TYPE + uso do valor novo na mesma transação é recusado pelo Postgres), nota obrigatória em delivered/cancelled/rejected, coluna reversal_entry_id (única, só com ledger_entry_id presente) para o estorno da compra entregue.
3. shop-repo.ts: claim, release, deliver (insere o débito purchase/shop_order e amarra ledger_entry_id na mesma transação), cancel (dono só em reserved; staff em reserved|claimed), reject e refund (estorno do lançamento + devolução do estoque na mesma transação, F6-19). Trava sempre usuário → pedido → item (F6-40). Decisão de permissão tomada dentro da transação, depois da trava.
4. Server: ShopService + rotas POST /api/shop/orders/:id/{claim,release,deliver,cancel,reject,refund} e GET /api/shop/orders (fila da staff, fulfill; sem fulfill o filtro é o próprio id). CASL: cancel em ShopOrder para o dono e para a staff.
5. Web: api/shop-queue.ts + ShopQueueProvider (molde do QueueProvider), página StaffShopOrders no molde de StaffWithdrawals (abas, StatCards, ações por linha), rota /staff/pedidos com RequirePermission fulfill/ShopOrder, item de menu com contador, e botão de cancelar do comprador na tela da Loja.
6. Testes: shared (transições/labels/schemas), integração no Postgres (entrega lança uma vez só, duas entregas concorrentes, cancelamento concorrente com entrega, cancelar/recusar devolve moeda E estoque, estorno devolve os dois, dono não cancela depois de claimed), HTTP (autorização e dono da sessão) e e2e shop-queue.spec.ts com screenshots 1280/400 em E2E_PORT=4160.
7. Gate completo, skills task-done-check/emil-design-eng/security-review, rebase em origin/main (renumerar migration se 057/058 pegarem a 0020), PR citando TASK-060.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (commit e694775, depois do rebase em origin/main)

Lint 0 · race 0 · typecheck ok · coverage branch **88,76%** (≥79%) · e2e **144 ok / 0 falha / 0 flaky** na porta 4160 · Docker build+smoke ok · duplicação 2,34% · vulns high+ 0. Único aviso: dead code advisory com 6 exports de shadcn pré-existentes (button/dialog/table/tabs), nenhum deles desta task.

## Evidência por AC

| AC | Evidência |
|---|---|
| #1 reserved → claimed → delivered, cancelled e rejected terminais | shared: `shop.test.ts` "percorre reserved → claimed → delivered, com cancelled e rejected terminais"; db: `shop.integration.test.ts` "a staff pega o pedido..." + "a entrega lança o débito..."; e2e `shop-queue.spec.ts` caminho completo |
| #2 transição inválida recusada pelo serviço **e** pelo banco | db: "recusa a transição inválida: entregar sem ter pegado, e pegar duas vezes" e o bloco "o banco recusa a linha incoerente" (5 updates crus rejeitados por check); HTTP: 409 com a frase do estado |
| #3 staff assume e devolve o pedido à fila | db: "a staff pega o pedido, e pode devolvê-lo à fila voltando para reserved"; HTTP: "a staff devolve o pedido à fila..."; e2e: passo "Devolver à fila" + screenshot `fila-pedidos-em-entrega` |
| #4 entrega exige nota de onde/para quem | db: "entrega exige nota dizendo onde e para quem"; shared: `shopOrderDeliverSchema`; HTTP: 400 sem nota; e2e: botão desabilitado até a nota ser escrita |
| #5 Buffunfa reservada até delivered | db: "a entrega lança o débito e amarra o lançamento ao pedido" (saldo 1.200 → 900, reserva 0); `RESERVING_SHOP_ORDER_STATUSES = [reserved, claimed]`; e2e: "Compra na loja" só aparece no extrato depois da entrega |
| #6 comprador cancela em reserved; depois de claimed só a staff | db: "depois de claimed o comprador não cancela mais; a staff sim" + "um membro não cancela o pedido de outro"; HTTP: 200 / 403 / 404; e2e: botão Cancelar deixa de existir depois de pego |
| #7 cancelar, recusar e estornar devolvem moeda **e** estoque juntos | db: bloco "cancelar e recusar devolvem moeda e estoque juntos" + "estorno do pedido entregue" (estorno no ledger, original intacto, estoque 2→3) + "dois estornos simultâneos: um estorno só e uma unidade só de volta"; e2e: saldo cheio e item comprável de novo |
| #8 fila em painel no molde da de saques | `apps/web/src/pages/StaffShopOrders.tsx` (abas+contadores+StatCards do molde de `StaffWithdrawals`), `ShopQueueProvider`, rota `/staff/pedidos`; screenshots `fila-pedidos-na-fila`, `-em-entrega`, `-entregue`, `-recusado` em 1280 e 400; e2e "sem shop:fulfill a fila não existe" |

## Concorrência (o que quebra dinheiro)

- duas entregas simultâneas do mesmo pedido → **um** lançamento `purchase` (db: "dois membros da staff entregando o mesmo pedido");
- cancelamento concorrente com a entrega → um dos dois, nunca os dois: ou débito sem estoque de volta, ou estoque de volta sem débito (db: "cancelamento concorrente com a entrega");
- dois estornos simultâneos → um estorno e uma unidade só (índice único em `reversal_of` + `reversal_entry_id`).

## Visual (DoD#4)

Screenshots do e2e revisados nos dois tamanhos: desktop 1280 (fila com abas/contadores, linha em entrega com o campo da nota, linha recusada com motivo e valor riscado; Loja com o pedido e o botão Cancelar) e mobile 400 (mesmos estados, sem overflow horizontal, pílula + botão na mesma linha).

## Skills

emil-design-eng (painel novo), marclou-review (CTA por linha: um botão preenchido por estado, destrutivo em outline/ghost; textos dizem o que acontece), security-review (**nenhum achado** ≥ confiança 8: `fulfill` barra membro nas cinco rotas, `cancel` revalida dono via CASL com condição, nenhum `userId` vem do corpo, nenhum `sql.raw`, sem duplo débito nem duplo estorno), task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A fila da loja saiu: o pedido comprado percorre reserved → claimed → delivered, com cancelled (comprador) e rejected (staff) como saídas, e a staff trabalha isso num painel no molde da fila de saques. A entrega é o único ponto em que a Buffunfa vira lançamento — um débito `purchase` amarrado ao pedido na mesma transação — e cancelar, recusar ou estornar devolve moeda e estoque juntos, nunca um sem o outro. Verificado com 27 testes de integração no Postgres (incluindo três de concorrência: duas entregas, cancelamento contra entrega e dois estornos), 17 testes HTTP de autorização, 4 specs e2e em desktop e mobile, gate completo verde (coverage 88,76%, 144 e2e) e security-review sem achados.

Decisões tomadas no caminho, além do doc-005: (1) `reserved → delivered` foi **removida** — entregar sem ter pegado reabre o buraco que o `claimed` fecha; (2) o estorno de pedido entregue mantém o status `delivered` e marca `reversal_entry_id`, porque o ledger é append-only e desfazer uma compra é lançamento novo, não estado novo; (3) a entrega não passa pelo `spendCurrency` — aquela porta abre a própria transação e recusa saldo negativo, e o débito precisa ser atômico com o carimbo do pedido; (4) o cancelamento do próprio comprador grava uma nota escrita pelo servidor, porque o banco exige nota em todo cancelamento e obrigar o membro a justificar a desistência seria um formulário a mais para nada.
<!-- SECTION:FINAL_SUMMARY:END -->
