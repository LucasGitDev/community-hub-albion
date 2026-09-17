---
id: TASK-059
title: 'Loja: catálogo de itens e compra com Buffunfa'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 18:39'
labels: []
milestone: m-6
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A loja em si: a staff cadastra itens, o membro compra com Buffunfa. O item é de texto livre (nome, descrição, preço, estoque opcional), não um catálogo tipado — categorias tipadas agora seriam adivinhação, e três meses de uso dizem quais existem de verdade (F6-17). Itens previstos pelo usuário: itens do jogo, ping/criação de evento, e itens beneficentes. Cargos e cosméticos do Discord seguem mapeados e não automatizados, decisão que vem da v1.

Esta task entrega o catálogo e a compra; a fila de entrega vem na seguinte. O ponto de parada é utilizável sozinho: a staff cadastra e a guilda vê os preços antes de qualquer entrega existir.

Capacidades shop:manage (publicar item, definir preço) e shop:fulfill (entregar pedido) ficam no bloco staff, provisórias, com os nomes já registrados para a F7 (F6-25).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A staff cadastra, edita e despublica itens com nome, descrição, preço em Buffunfa e estoque opcional
- [x] #2 O membro vê o catálogo com os preços e o próprio saldo de Buffunfa
- [x] #3 Item sem estoque aparece marcado como esgotado e não clicável, em vez de sumir do catálogo
- [x] #4 A compra recusa quando o saldo é insuficiente ou o estoque acabou, revalidando dentro da transação
- [x] #5 A compra reserva a Buffunfa e o estoque sem lançar no ledger, no mesmo desenho da reserva da fila de saques
- [x] #6 As capacidades shop:manage e shop:fulfill existem e estão ligadas ao bloco staff
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
1. shared/shop.ts: SHOP_CURRENCY (buffunfa), máquina de estados do pedido (reserved→delivered|cancelled), RESERVING_SHOP_ORDER_STATUSES, schemas zod de item e compra, checkShopPurchase puro (saldo/estoque/publicação) + mensagens PT-BR, DTOs e o registro de capacidades shop:manage/shop:fulfill (F6-25).
2. permissions.ts: subjects ShopItem e ShopOrder, ação 'fulfill'; membro lê catálogo e cria pedido; staff manage ShopItem + read/fulfill ShopOrder (bloco staff, provisório até a F7).
3. schema + migration: shop_items (nome, descrição, preço bigint, estoque opcional, published) e shop_orders (reserva: status, preço congelado, ledger_entry_id nulo até a entrega) com os mesmos checks de consistência dos withdrawals.
4. db/shop-repo.ts: CRUD de item, getShopBalance (ledger buffunfa − reservas), purchaseShopItem em transação com 'for update' no usuário e no item, revalidando saldo/estoque/publicação lá dentro (F6-7, AC#4/#5). Sem lançamento no ledger — o débito é da TASK-060.
5. apps/server/src/shop: ShopModule + ShopService + ShopController (GET /api/shop, POST /api/shop/orders, GET /api/me/shop/orders, CRUD de item da staff). Dono sempre da sessão.
6. apps/web: página /loja com catálogo, saldo Buffunfa, item esgotado cinza e não clicável (F6-18), diálogo de compra e diálogo de cadastro/edição/despublicação da staff; item no menu.
7. Testes: unit do shared, integração no Postgres (incl. duas compras concorrentes), http do controller e e2e /loja (desktop+mobile) com screenshots.
8. task-done-check, pnpm quality completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Entregue

Catálogo e compra. A **entrega do pedido é a TASK-060** e não entrou: a compra deixa o pedido em `reserved`, que é o estado que a fila vai consumir.

Contrato que a TASK-060 consome:
- `shop_orders.status`: `reserved` → `delivered` | `cancelled` (`ALLOWED_SHOP_ORDER_TRANSITIONS`, `canTransitionShopOrder`);
- `reserved` é o único estado em `RESERVING_SHOP_ORDER_STATUSES`: reserva = pedido que ainda não virou lançamento;
- colunas já prontas e com check no banco: `ledger_entry_id` (not null **iff** `delivered`), `handled_by`/`handled_at` (existem juntos, e só fora de `reserved`), `note` (obrigatória no cancelamento);
- `purchase` (kind) e `shop_order` (reference_type) já existem no ledger, sem consumidor — igual ao spendCurrency da 056 (F6-33). A entrega lança o débito por `spendCurrency`/`insertLedgerEntry` e amarra o id;
- cancelar devolve moeda (deixando a reserva cair) e **incrementa o estoque na mesma transação** (F6-19);
- `shop:fulfill` já é `can(['read','fulfill'], 'ShopOrder')` no bloco staff.

## Decisões minhas, fora do doc-005
- **Um pedido = uma unidade.** Sem coluna de quantidade: nenhum AC pede, e quantidade obrigaria a decidir se o cancelamento é parcial. Comprar duas é comprar duas vezes.
- **Sem coluna `currency` na loja**: `SHOP_CURRENCY` é constante (Buffunfa). Loja que aceitasse prata competiria com o saque.
- **Nome e preço congelados no pedido** (`item_name`, `price`): reprecificar ou renomear o item não reescreve compra feita.
- **Item nunca é apagado**: despublicar (`published = false`) é o caminho — os pedidos apontam pra ele.
- **Teto de preço** (1e9 BUF): achado não-crítico do security-review — sem ele, preço acima do int8 virava 500 mudo em vez de 400 explicado.
- **Trava usuário → item, nessa ordem**, para dois membros comprando o mesmo item não fecharem deadlock com dois comprando itens diferentes.
- **A compra não passa pelo `spendCurrency`**: aquela porta é a do débito, e o débito é da entrega. `spendCurrency` continua sendo o que a 060 usa.

## Evidências

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 staff cadastra/edita/despublica | e2e/shop.spec.ts 'staff cadastra, reprecifica e despublica item pela tela' (desktop+mobile) + shop.http.test.ts 'staff cadastra, edita e despublica; membro comum leva 403' + shop.integration.test.ts 'edita preço sem apagar o resto' | ✅ |
| AC#2 membro vê catálogo, preços e saldo | e2e 'membro vê catálogo, preços e o próprio saldo de Buffunfa' + http 'o membro vê catálogo e o próprio saldo de Buffunfa' + screenshot loja-1280/loja-400 | ✅ |
| AC#3 esgotado marcado e não clicável | e2e 'item sem estoque aparece esgotado e não clicável' (botão `toBeDisabled`, 'Comprar' com count 0, card ainda visível) + http 'item esgotado continua no catálogo, marcado por stock 0' | ✅ |
| AC#4 recusa revalidando na transação | shop.integration.test.ts 'recusa saldo insuficiente contando o que já está reservado', 'recusa item esgotado e item despublicado', 'duas compras simultâneas de 300 com 500 de saldo', 'dois membros disputando a última unidade' + http 409 'Faltam 100 BUF' | ✅ |
| AC#5 reserva sem lançar no ledger | shop.integration.test.ts 'desconta do disponível e do estoque, e o extrato do membro não muda' (ledger com 1 lançamento, o do crédito) + e2e conferindo que 'Compra na loja' não aparece no extrato | ✅ |
| AC#6 shop:manage e shop:fulfill no staff | shop.test.ts 'os nomes registrados para a F7 batem com as regras CASL de hoje' e 'membro comum não tem nenhuma das duas' | ✅ |
| DoD#1 gate | `pnpm quality` completo: lint 0, race 0, typecheck ok, coverage 89.98% (≥79%), e2e 130 ok / 0 falhas na porta 4159, Docker build+smoke ok, dup 1.79%, audit 0. Único aviso: dead code advisory de 6 exports de shadcn pré-existentes | ✅ |
| DoD#2 evidência por AC | tabela acima: nenhuma linha é leitura de código | ✅ |
| DoD#3 skills | revenue-centric-design, emil-design-eng, marclou-review, security-review, task-done-check | ✅ |
| DoD#4 visual 1280/400 | .playwright-mcp/loja-1280.png, loja-400.png, loja-compra-400.png revisados; scrollWidth 1265≤1280 e 385≤400 (sem overflow); Esc fecha o diálogo; console sem erro nem aviso; snap() no e2e nos 4 estados | ✅ |
| DoD#5 doc-005 | F6-17 (texto livre), F6-18 (esgotado cinza na lista), F6-19 (contrato do estorno pronto p/ 060), F6-20 (nada automatizado), F6-25 (capacidades no staff), F6-5 (Buffunfa sem abreviar), F6-7 (saldo nunca negativo por compra), Q20 (bigint) | ✅ |
| DoD#6 security-review | sem achado crítico; um achado não-crítico (preço > int8 = 500) corrigido em 9dc6a8d | ✅ |
| DoD#7 commits | 6 commits Conventional atômicos, sem co-autor | ✅ |

marclou-review da tela: 🟢 #3 (números: 'Faltam 200 BUF', '3 unidades'), #22 (um CTA por card; 'Novo item' é outline e só da staff), #28 ('Confirmar compra' diz o que acontece), #2 (três cores: foreground, ouro da Buffunfa, âmbar do CTA). 🟡 #6 (catálogo + meus pedidos + controles da staff na mesma tela — aceito: os controles da staff só existem com shop:manage e os pedidos ficam abaixo do catálogo). Sugestão não implementada por estar fora dos ACs: 'avise-me quando voltar' no item esgotado, que é o que transformaria a fila de espera do F6-18 em sinal de demanda.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Loja: catálogo de itens de texto livre (nome, descrição, preço em Buffunfa, estoque opcional) que a staff cadastra, edita e despublica, e compra do membro que **reserva** moeda e estoque sem lançar no ledger — o débito é da entrega (TASK-060), que consome o pedido em `reserved`. A recusa por saldo ou estoque é decidida dentro da transação, com `for update` no usuário e no item e releitura lá dentro; provado por dois testes de concorrência contra Postgres. Item esgotado fica cinza e não clicável sem sair do catálogo (F6-18). `shop:manage` e `shop:fulfill` entram no bloco staff, provisórias, com os nomes registrados para a F7. Verificado com pnpm quality completo (coverage 89.98%, e2e 130 ok), 4 specs e2e em desktop e mobile, 11 testes de integração, 9 http, 20 unitários e revisão visual em 1280 e 400.
<!-- SECTION:FINAL_SUMMARY:END -->
