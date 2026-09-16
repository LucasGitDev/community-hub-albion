---
id: TASK-026
title: Ledger append-only de prata
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 19:27'
labels:
  - economy
  - db
  - backend
milestone: m-5
dependencies:
  - TASK-009
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ledger único append-only (doc-002) em bigint de prata inteira (Q20); correção só por estorno; saldo pode ficar negativo (Q24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lançamentos não podem ser editados nem apagados (garantido no banco)
- [x] #2 Estorno cria lançamento inverso vinculado ao original
- [x] #3 Saldo calculado é exato para valores acima de 2^53
- [x] #4 Saldo negativo é permitido
- [x] #5 security-review executado sem achados críticos
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema: enum ledger_entry_kind em @albion-hub/shared + tabela ledger_entries (bigint amount, kind, reference_type/id, reversal_of FK auto, created_by, memo, created_at) com unique parcial em reversal_of e checks (amount<>0, reversal<->kind).
2. Migration via pnpm db:generate + SQL manual no mesmo arquivo: função + triggers statement-level BEFORE UPDATE/DELETE/TRUNCATE que dão RAISE EXCEPTION (imutabilidade no banco, AC#1).
3. packages/db/src/ledger-repo.ts: insertLedgerEntry, reverseLedgerEntry (transação + catch de unique violation => already_reversed), getLedgerBalance (coalesce(sum(amount),0)::bigint, nunca number JS), listLedgerEntries (extrato paginado).
4. apps/server/src/economy/{ledger.service.ts,economy.module.ts} registrado no AppModule; sem controller/UI (fora do escopo).
5. Testes de integração (ledger.integration.test.ts, banco próprio): UPDATE e DELETE falham; estorno cria inverso vinculado; segundo estorno concorrente perde (Promise.allSettled); saldo exato acima de 2^53; saldo negativo permitido (Q24); extrato ordenado.
6. security-review + task-done-check; pnpm quality completo; commits atômicos e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, commit 5b39143)
⚠️ Passou com avisos (só o aviso pré-existente de dead code em componentes shadcn do web, nada da task).

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 91.46% | ≥ 79% | ✅ |
| E2E + screenshots | 52 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | build + smoke | ✅ |
| Duplicação | 1.17% | ≤ 15% | ✅ |
| Dead code | 7 (pré-existentes, apps/web/components/ui) | 0 (advisory) | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

Banco dos testes: POSTGRES_PORT=55432 docker compose -p task026 + TEST_DATABASE_URL.

## AC → evidência
| AC | Evidência | Status |
|---|---|---|
| #1 Lançamento não editado nem apagado (no banco) | Triggers statement-level BEFORE UPDATE/DELETE/TRUNCATE em `ledger_entries` (migration 0011). ledger.integration.test.ts: 'UPDATE é rejeitado pelo banco', 'DELETE é rejeitado pelo banco', 'TRUNCATE é rejeitado pelo banco', 'UPDATE que não casaria com nenhuma linha também é rejeitado' — todos esperam SQLSTATE 23514 e conferem que a linha continua intacta. Também 'apagar a conta é bloqueado' (FK restrict, 23503) | ✅ |
| #2 Estorno cria lançamento inverso vinculado | `reverseLedgerEntry`/`LedgerService.reverse` criam kind=reversal com reversal_of = original, amount = -original. Testes: 'cria lançamento inverso vinculado ao original, sem tocar nele', 'dois estornos concorrentes: só um passa (índice único parcial)' (3 estornos simultâneos → 1 ok + 2 already_reversed, 1 linha no banco), 'estorno sequencial repetido devolve already_reversed', 'estorno de estorno é recusado', 'reversal_of sem kind reversal é recusado pelo banco' | ✅ |
| #3 Saldo exato acima de 2^53 | `getLedgerBalance` faz `coalesce(sum(amount),0)::int8` no banco e o driver devolve BigInt. Teste 'é exato acima de 2^53': 9007199254740993 + 9007199254740994 = 18014398509481987n, typeof bigint, e `BigInt(Number(balance)) !== balance` prova que em number a prata seria perdida | ✅ |
| #4 Saldo negativo permitido (Q24) | Teste 'permite saldo negativo (Q24)': payout → saque → estorno do payout deixa saldo -1.000.000n sem erro nem linha apagada. ledger.service.test.ts termina em -400.000n | ✅ |
| #5 security-review sem crítico | Skill security-review na branch: **nenhum achado com confiança ≥ 8**. Conferiu SQL injection (tudo parametrizado; sql.raw só em teste com nome de banco vindo de env), integridade append-only, forja/duplicação de estorno (amount e userId vêm da linha original, nunca do caller; índice único fecha o TOCTOU), precisão bigint ponta a ponta, e superfície de autorização (nenhum controller/rota/comando novo). Recomendação registrada para o futuro: quem expuser `balance()`/`statement()` em TASK-027/028/030 precisa amarrar o userId ao principal autenticado ou a uma ability CASL | ✅ |

## Decisões (doc-005)
- Q20: amount em `bigint` inteiro; nenhum valor de prata passa por number no código de produção (único `Number(` do diff está no teste, justamente para provar a perda de precisão).
- Q24: saldo negativo permitido; bloquear saque com saldo negativo é do módulo de saque (TASK-030), fora daqui.
- Q10: ledger é dívida com o membro; user_id e created_by com `on delete restrict` para o histórico não sumir junto com a conta.
- doc-002: tabela única append-only, correção só por estorno.

## Achado durante o gate
`created_by` tinha sido criado com `on delete set null`; apagar uma conta vira um UPDATE em ledger_entries, que o trigger recusa — o teste de cascata do auth quebrou. Corrigido para `restrict` (commit 5b39143) e coberto por teste.

## Escopo
Só a primitiva do ledger (schema + migration + repo + serviço Nest) e leitura de saldo/extrato. Sem split, sem saque, sem UI, sem controller.

Skills: security-review, task-done-check. Não se aplicam nesta task: emil-design-eng, marclou-review, animate, ask-sonner e revenue-centric-design (nenhuma UI ou copy tocada).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ledger único append-only de prata (doc-002): tabela ledger_entries em bigint (Q20) com triggers no Postgres que recusam UPDATE, DELETE e TRUNCATE, índice único parcial em reversal_of (um estorno por lançamento), repo em packages/db/src/ledger-repo.ts e LedgerService em apps/server/src/economy — a porta única que loot split, saque e carteira vão consumir. Saldo é SUM no banco devolvido como bigint, exato acima de 2^53, e pode ser negativo (Q24). Verificado por 17 testes de integração contra Postgres real (imutabilidade, estorno concorrente, precisão, saldo negativo, extrato), gate completo verde (coverage 91,46%) e security-review sem achado. Sem UI: só backend + db.
<!-- SECTION:FINAL_SUMMARY:END -->
