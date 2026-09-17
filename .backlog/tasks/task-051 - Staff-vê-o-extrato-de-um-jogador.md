---
id: TASK-051
title: Staff vê o extrato de um jogador
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 02:19'
updated_date: '2026-09-17 03:53'
labels:
  - admin
  - web
  - economy
dependencies: []
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff e admin conseguem abrir o ledger de um jogador específico a partir da lista de membros: saldo disponível, reservado e o extrato com origem, data, valor, autor e motivo de cada lançamento. Leitura apenas — ajuste de prata só existe no namespace de manutenção (TASK-048). Serve para responder 'cadê minha prata' sem abrir o banco.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff e admin leem o extrato de qualquer jogador a partir da lista de membros
- [ ] #2 Extrato mostra origem, data, valor, autor e motivo, com paginação
- [ ] #3 Membro comum não lê extrato alheio (API e UI)
- [ ] #4 Valores em PT-BR; nenhum valor passa por number
- [ ] #5 security-review sem achados críticos
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. packages/db: listLedgerEntriesWithAuthor(userId, keyset) — mesmo keyset de listLedgerEntries, com leftJoin users em created_by para o nome do autor (memberNick).
2. packages/shared: MemberLedgerEntryDto = LedgerEntryDto + author {id,name}|null; reaproveita encodeLedgerCursor/parseLedgerPageQuery/LEDGER_ENTRY_KIND_LABELS.
3. apps/server: MemberLedgerController GET /api/admin/members/:userId/ledger — saldo (getWithdrawalBalance, reserva = só pending) + extrato paginado. Permissão: @Authorize('read','Wallet') no tipo + checagem de condição no handler com asSubject('Wallet',{userId: alvo}) — member e caller têm a regra condicionada ao próprio id e levam 403; staff/admin têm read Wallet sem condição. Prata sai string.
4. apps/web: extrai a tabela de extrato do Wallet.tsx para components/ledger.tsx (kindMeta + LedgerTable) e reusa nos dois; novo MemberLedgerDialog aberto pela linha de AdminMembers (ação 'Ver extrato'), com saldo/reservado/disponível, coluna Autor+motivo, 'Carregar mais' por cursor, estados vazio/carregando/erro. BigInt na borda.
5. Testes: http test do controller (staff/admin 200, member/caller/estranho 403, paginação, autor, manual/maintenance), unit do repo, e2e admin-members-ledger.spec.ts com screenshots 1280/400.
6. security-review + task-done-check + pnpm quality.
<!-- SECTION:PLAN:END -->
