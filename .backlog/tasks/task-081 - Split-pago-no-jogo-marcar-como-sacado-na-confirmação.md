---
id: TASK-081
title: 'Split pago no jogo: marcar como sacado na confirmação'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-19 03:59'
updated_date: '2026-09-19 04:10'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6890
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões SP1 a SP6 no doc-005 (grelha de 2026-09-19). O caller divide o loot no jogo, na hora; o painel precisa registrar isso sem obrigar cada pessoa a pedir saque do que já recebeu.

Na confirmação do split, um modal lista os participantes **todos marcados por padrão** como pagos no jogo; o caller ou a staff desmarca quem não recebeu. Para cada marcado nasce o crédito normal do split e, no mesmo ato, um saque já liquidado do mesmo valor. Taxa e sobra do arredondamento, que vão para o caller, entram pagas automaticamente.

Só existe no ato da confirmação: depois, o que ficou é saldo normal e sai pela fila de saques.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A confirmação do split abre um modal com todos os participantes marcados como pagos no jogo, e dá para desmarcar um a um
- [x] #2 Cada pessoa marcada recebe o crédito do split e um saque já liquidado do mesmo valor, na mesma transação da confirmação
- [x] #3 O extrato do participante mostra o crédito e o saque, com saldo líquido zero para aquela leva
- [x] #4 Quem foi desmarcado recebe só o crédito, como hoje, e pode pedir saque normalmente
- [x] #5 Taxa e sobra do arredondamento entram como pagas automaticamente
- [x] #6 Nenhum saque marcado como pago no jogo aparece na fila de saques da staff
- [x] #7 Só caller e staff conseguem confirmar marcando como pago; depois da confirmação não existe caminho para marcar como pago
- [x] #8 Cada saque pago no jogo publica na timeline com quem marcou
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Repo (packages/db/loot-split-repo): confirmLootSplit aceita paidInGame { lineIds, markedBy }. Na MESMA transação, depois dos créditos: para cada linha marcada com conta e prata > 0, e para o split_fee do dono (SP3, automático), gera id do saque no app, insere lançamento kind=withdrawal (-X, reference withdrawal/<id>) e o withdrawals já em settled com ledger_entry_id, decided_by/at, settled_by/at e settlement_note — satisfaz todos os checks existentes sem migration. Line id desconhecido = recusa unknown_lines. Idempotência e trava continuam no lock do split.
2. Testes de integração: crédito+saque juntos, saldo líquido zero, desmarcado só crédito e pede saque normal, taxa/sobra paga, nada pending/approved (fila), concorrência 2 e 10 confirmações com paidInGame = um conjunto só, rollback total quando falha.
3. Shared: schema zod do corpo da confirmação (paidInGameLineIds: uuid[] opcional, sem duplicata).
4. Server: controller lê o corpo; service passa markedBy = ator da sessão (permissão distribute, SP5); publica economy.withdrawal_paid_in_game depois do commit (SP6), com quem marcou; teste com FakeTimelinePublisher. Nenhuma outra rota cria saque settled (SP4).
5. Web: ConfirmSplitDialog ganha lista de checkboxes (todos marcados), linha fixa da taxa/sobra como paga; confirmSplit envia os ids. e2e do modal (desmarcar um), screenshots 1280/400.
6. Skills emil-design-eng, security-review, task-done-check; pnpm quality; PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, commit d9557e9, banco recriado): ⚠️ só aviso advisory de dead code pré-existente. Lint 0, race 0, typecheck ok, coverage branch 87.58%, E2E 148 ok/0 falha (porta 4186), Docker ok, vulns 0.

Como o saque nasce liquidado sem afrouxar check nenhum (sem migration): id do saque gerado no app; lançamento novo kind=withdrawal (-X, reference withdrawal/<id>, memo 'Sacado: pago no jogo...'); withdrawals inserido já settled com ledger_entry_id, decided_by/at = settled_by/at = quem marcou + instante da confirmação, decision_note/settlement_note citando o split. Cumpre withdrawals_ledger_entry_consistent, decision_consistent, decided_when_not_pending, settlement_consistent. Mesma transação do crédito, sob a trava evento→split.

Evidências:
- AC#1: e2e/split-paid-in-game.spec.ts (checkbox marcado por padrão, desmarca/marca) + e2e/settlement.spec.ts (desmarca); screenshots pago-no-jogo-modal D/M revisados.
- AC#2: loot-split.integration 'marcado recebe crédito e saque liquidado...' e 'falha no meio desfaz crédito e saque juntos'; concorrência 10 confirmações = um conjunto.
- AC#3: e2e extrato (+5.000.000 / −5.000.000, saldo 0), screenshot pago-no-jogo-extrato-D.
- AC#4: integration 'desmarcado só recebe o crédito e pede saque normalmente'; http 'desmarcado recebe só o crédito'.
- AC#5: integration 'taxa e sobra do dono entram pagas automaticamente'.
- AC#6: integration 'nenhum saque pago no jogo cai na fila'; http consulta /api/withdrawals?status=pending|approved; e2e fila.
- AC#7: http 'membro comum e caller de outro evento... 403' e 'depois de confirmado não existe caminho' (reconfirmação ignora a lista); só settlePaidInGame cria settled direto (grep).
- AC#8: http 'o caller marca...' (economy.withdrawal_paid_in_game por saque, ator = quem marcou, depois de loot_split_confirmed) e 'a staff também marca'.
SP5: permissão distribute (caller dono + staff); vira permissão própria na F7.
Skills: emil-design-eng, security-review (sem achado), task-done-check.
<!-- SECTION:NOTES:END -->
