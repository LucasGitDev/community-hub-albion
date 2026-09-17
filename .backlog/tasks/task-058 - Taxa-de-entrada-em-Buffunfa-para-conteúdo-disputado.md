---
id: TASK-058
title: Taxa de entrada em Buffunfa para conteúdo disputado
status: In Progress
assignee:
  - '@lucas'
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 18:47'
labels: []
milestone: m-6
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Primeiro sink da Buffunfa: o caller pode cobrar uma taxa de entrada em conteúdo disputado. O template nasce zerado e o caller define até fechar as inscrições, sem teto. É sink puro — a Buffunfa cobrada some, não vai para ninguém. É o que a diferencia da taxa do split em prata, que vai para o caller/dono (F6-16).

A cobrança acontece na inscrição, não no início do evento, porque é o único desenho que filtra de verdade: inscrever-se de graça mantém a lista inflada. Quem desiste antes do início recebe de volta; depois do início, não — assim quem avisa cedo não é punido (F6-13). A taxa é em Buffunfa e nunca em prata: em prata viraria barreira de dinheiro contra o membro novo, que é justamente quem tem pouca prata (F6-12).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 O template nasce com taxa zerada; o caller define o valor até o fechamento das inscrições, sem teto
- [x] #2 A inscrição debita a taxa em Buffunfa na hora; saldo insuficiente recusa a inscrição com mensagem clara
- [x] #3 Desistir antes do início do evento devolve a taxa por estorno; desistir depois não devolve
- [x] #4 Cancelar o evento devolve a taxa a todos os inscritos, automaticamente, por estorno apontando para o lançamento original
- [x] #5 A Buffunfa cobrada não é creditada a ninguém: o total em circulação diminui
- [x] #6 Um evento que cobra taxa e paga participação gera dois lançamentos separados no extrato, nunca um líquido
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
1. DB: migration 0019 — event_templates.default_entry_fee, events.entry_fee (bigint >= 0, default 0), event_signups.fee_entry_id -> ledger_entries, e ledger_entry_kind += 'entry_fee'.
2. shared: LEDGER_ENTRY_KINDS/labels com entry_fee; entryFee no EventDto e defaultEntryFee no EventTemplateDto/schemas; schema do PATCH de taxa de entrada (>= 0, sem teto).
3. db: extrair o núcleo do spendCurrency (spendCurrencyTx) para a inscrição cobrar DENTRO da transação que dá a vaga; joinEventRole cobra só quando é inscrição nova (troca de role carrega o fee_entry_id); leaveEvent estorna; applyEventTransition estorna a todos no cancelamento e a quem ainda está na espera no start.
4. server: EventSignupsService/controller/botão traduzem insufficient_funds numa mensagem clara; rota PATCH /api/events/:id/entry-fee liberada só em draft/open; template CRUD carrega a taxa default.
5. web: campo de taxa de entrada no template e no evento (draft/open), taxa visível no card de inscrição, erro de saldo em toast; embed do Discord mostra a taxa.
6. testes: integração (cobra, recusa por saldo, estorno ao sair, estorno no cancelamento, sink não credita ninguém, taxa + participação em dois lançamentos) + concorrência (dois inscritos, saldo para um) + e2e do fluxo + screenshots 1280/400.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (commit dac3e4cd, local, pós-rebase na main com a loja)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.69% | ≥ 79% | ✅ |
| E2E (desktop 1280 / mobile 400) | 132 ok, 0 falha, 0 flaky (porta 4158) | 0 falhas | ✅ |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | build + smoke | ✅ |
| Duplicação | 1.76% | ≤ 15% | ✅ |
| Dead code | 6 (todos pré-existentes em components/ui) | advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| #1 template zerado, caller define sem teto até fechar | `entry-fee.integration.test.ts` "template nasce zerado e o evento herda uma cópia editável" (cópia, não referência; 10^10 passa; negativo o banco recusa); `templates.http.test.ts` "taxa de entrada do template nasce zerada e sobrevive a um PATCH que não fala dela"; `event-signups.http.test.ts` "a taxa congela quando as inscrições fecham" (409) | ✅ |
| #2 debita na inscrição; saldo insuficiente recusa com mensagem clara | integração "a inscrição debita a taxa na hora..." e "saldo insuficiente recusa a inscrição inteira, sem vaga e sem lançamento"; HTTP 409 com `20 BUF` no corpo; e2e "Faltam 20 BUF para a entrada deste evento." com as vagas desligadas | ✅ |
| #3 desistir antes devolve por estorno; depois do início não | integração "desistir antes do início devolve por estorno; depois do início, não" (o lançamento original fica intacto e o estorno aponta para ele); e2e: chip do header 100→70→100 BUF | ✅ |
| #4 cancelar devolve a todos por estorno do original | integração "cancelar o evento devolve a todos, por estorno do lançamento original" (confirmado + espera, 3 pessoas); `event-signups.http.test.ts` "cancelar o evento devolve a taxa a todos os inscritos" | ✅ |
| #5 a Buffunfa cobrada não é creditada a ninguém | integração soma **toda** a Buffunfa da base antes/depois: cai exatamente o valor cobrado, e o saldo do caller/dono continua 0 | ✅ |
| #6 cobra e paga = dois lançamentos, nunca um líquido | integração "evento que cobra e paga gera dois lançamentos separados no extrato, nunca um líquido": duas linhas (−20 e +15) na mesma origem, líquido só no saldo | ✅ |

## Visual (DoD#4)
Screenshots desktop 1280 e mobile 400 revisados pelo agent: detalhe do caller com o editor de taxa, card do membro sem saldo, card pago e extrato com cobrança + estorno. Em 400px nada estoura: o selo dourado, o aviso "Faltam 20 BUF" e o editor quebram em linha. Anexados pelo `snap()` em `e2e/entry-fee.spec.ts`.

## Skills
emil-design-eng (UI da taxa no template, no evento e no card do membro), marclou-review (fluxo: o custo passou a estar no nome acessível da vaga, não só no selo ao lado), security-review (ledger/prata), task-done-check.

## Decisões além do doc-005
1. **Quem começa o evento ainda na lista de espera recebe a taxa de volta.** A cobrança é na inscrição (F6-13) e vale para confirmado e para espera — senão inscrever-se na espera seria grátis e a lista continuaria inflada. Mas quem nunca teve vaga não jogou, então o start estorna a taxa de quem ficou na espera. Confirmado que desistiu tarde continua sem devolução (F6-13).
2. **Trocar de role e ser movido pelo caller não recobram nem devolvem.** A taxa é do evento, não da vaga: a inscrição nova carrega o `fee_entry_id` da antiga.
3. **A taxa congela quando as inscrições fecham**, não no arquivamento (como a taxa de prata). A partir de `closed` a lista já foi formada e cobrada, e um preço novo valeria para quem pagou o antigo.
4. **`fee_entry_id` na inscrição** em vez de procurar o lançamento por evento+usuário: quem entra, sai e volta gera mais de uma cobrança no mesmo evento, e a devolução precisa apontar para a certa.
5. **Teto físico de int8** na validação (não teto de política): sem ele um valor acima de 2^63-1 virava 500 do Postgres em vez de 400 legível.

## Bug encontrado no caminho
O PATCH de template não carregava `defaultEntryFee` na mesclagem com o template atual: editar o nome zerava a taxa em silêncio. Os e2e de template pegaram. Corrigido com teste de regressão.

## spendCurrency
Usado, não reescrito: o núcleo dele virou `spendCurrencyTx`, que roda na transação de quem chama, para a cobrança e a vaga serem a **mesma** transação. `spendCurrency` continua existindo e só embrulha o núcleo numa transação. Ordem de travas igual em todo caminho: evento primeiro, usuário depois. Provado por dois testes de concorrência (duas inscrições simultâneas com saldo para uma; clique duplo no mesmo evento cobra uma vez).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Primeiro sink da Buffunfa: taxa de entrada em conteúdo disputado, cobrada na inscrição e devolvida por estorno. Template nasce zerado e o caller define o valor do evento, sem teto, até as inscrições fecharem. A cobrança usa o núcleo do spendCurrency (F6-33) dentro da transação que dá a vaga, então saldo insuficiente recusa a inscrição inteira e duas inscrições simultâneas com saldo para uma terminam em uma paga e uma recusada. Devolução é sempre estorno apontando para a cobrança original: sair antes do início, cancelar o evento (a todos) e começar o evento ainda na espera. Sink puro: a soma de toda a Buffunfa da base cai exatamente o que foi cobrado e ninguém é creditado. Verificado com 10 testes de integração contra Postgres (inclusive dois de concorrência), 4 testes HTTP da rota e da recusa, 6 unitários dos textos e da validação, e um e2e do fluxo do caller ao estorno no extrato, com screenshots 1280 e 400 revisados.
<!-- SECTION:FINAL_SUMMARY:END -->
