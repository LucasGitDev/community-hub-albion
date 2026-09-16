---
id: TASK-028
title: Edição e confirmação de split com lançamento no ledger
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 20:04'
labels:
  - economy
  - backend
milestone: m-5
dependencies:
  - TASK-027
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff edita %; confirmar bloqueado se ≠ 100% (Q22); sobra de arredondamento vai ao owner (Q21, Q23); confirma quem tem event:distribute ou owner. Split confirmado impede cancelar (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Confirmação com soma ≠ 100% é recusada
- [x] #2 Confirmação lança créditos cuja soma é exatamente o valor do split, com sobra ao owner
- [x] #3 Só event:distribute ou owner confirmam
- [x] #4 Confirmação é idempotente (sem crédito duplo)
- [x] #5 Evento com split confirmado não pode ser cancelado
- [x] #6 security-review executado sem achados críticos
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
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared/loot-split.ts: feeBreakdown(total, fee) -> {feeSilver, distributable, exceedsTotal} (percent em bp com floor, fixed sem teto mas barrado quando > total); distributeByShare(lines, distributable) reaproveitando o floor+residual do rascunho; checkSplitConfirm() com as recusas em PT-BR (soma != 100% Q22, taxa fixa maior que o total, linha com participacao sem conta no painel, nao inscrito com participacao Q7); lootSplitUpdateSchema (totalSilver e/ou shareBp por linha).
2. schema.ts (aditivo): loot_splits.fee_silver, confirmed_at, confirmed_by + check (status='confirmed') = (confirmed_at is not null). Migration 0015 via pnpm db:generate, mais trigger manual (padrao da 0011) que recusa UPDATE/DELETE em split confirmado e nas linhas dele: split confirmado e imutavel, correcao so por estorno.
3. loot-split-repo.ts: a previa do rascunho passa a ser sobre o LIQUIDO (taxa retirada antes da divisao, doc-005 'Taxa do split'); updateLootSplitDraft (tx + for update, so draft, evento so finished) e confirmLootSplit (tx unica: um split_payout por participante + um split_fee com taxa+residuo pro dono, depois status confirmed). Idempotente pela trava da linha do split: a segunda confirmacao le confirmed e nao lanca nada. reverseLootSplit chama reverseLedgerEntry de cada lancamento do split, nunca UPDATE.
4. loot-split.service.ts + controller: PATCH splits/:id (editar), POST splits/:id/confirm, POST splits/:id/reversals. Todos com assertEventEditable e assertCan('distribute', event) - nunca 'read' em Event, que todo membro logado tem. Ator sempre do principal autenticado.
5. Testes: unit do calculo da taxa/recusas; integracao em Postgres real (edicao, confirmacao lancando no ledger com soma exata, taxa percent e fixed, residuo pro dono, taxa fixa > total recusada, imutabilidade por trigger, estorno, AC#5 evento finished nao cancela, arquivamento liberado depois do confirm); teste de concorrencia real (duas confirmacoes simultaneas -> um unico conjunto de lancamentos); HTTP de autorizacao dos tres endpoints novos.
6. pnpm quality completo (Postgres :55436), security-review, task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, Postgres :55436, worktree task-028)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.3% | ≥ 79% | ✅ |
| E2E + screenshots (1280/400) | 58 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.60% | ≤ 15% | ✅ |
| Dead code | 6 (todos pré-existentes em apps/web/src/components/ui) | 0 advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

Resultado: **Passou com avisos** (só o advisory de dead code pré-existente, nenhum arquivo desta task).

## O que a task decidiu, além do óbvio

**A taxa é retirada antes da divisão e o retido vai para o caller/dono** (doc-005, bloco "Taxa do split", Q23). A sobra do arredondamento vai junto, no **mesmo** lançamento `split_fee`: os dois valores têm a mesma justificativa e o mesmo destino, e separá-los deixaria duas linhas no extrato do dono sem explicar nada a mais.

**Taxa fixa maior que o total é barrada na confirmação** — a pendência que a TASK-027 registrou. Sem teto (decisão do usuário), uma taxa fixa acima do total deixaria o distribuível negativo. O rascunho continua existindo com distribuível zero, para o caller ver e corrigir, e a confirmação recusa com a frase "A taxa do evento é maior que o total deste split: não sobra prata para dividir. Baixe a taxa ou aumente o total."

**A prata de cada linha passou a sair do percentual, não dos milissegundos.** Era a única forma de o número conferido na tela ser o número creditado: depois de uma edição à mão os milissegundos deixam de ser a verdade, e um rascunho que divide por tempo e uma confirmação que divide por percentual dariam valores diferentes. O custo é a granularidade do basis point (0,01%), que é exatamente a que o caller vê e edita. Dois testes da TASK-027 foram ajustados por causa disso, com o motivo no comentário.

**Idempotência é do banco, não do JavaScript.** A confirmação trava a linha do split com `select ... for update` antes de olhar o status, no mesmo padrão do saque (TASK-030). A segunda confirmação só roda depois que a primeira commitou, lê `confirmed` e volta `alreadyConfirmed` sem lançar nada. Provado com 10 confirmações simultâneas contra Postgres de verdade.

**Split confirmado é imutável de verdade**, não por convenção: a migration 0015 traz triggers que recusam UPDATE e DELETE no split e nas linhas dele, no mesmo espírito do ledger append-only da TASK-026. A correção é `reverseLootSplit`, que estorna cada lançamento pelo `reverseLedgerEntry` — nunca reescreve. O estorno filtra os lançamentos já estornados **antes** de tentar: no Postgres uma violação de unicidade aborta a transação inteira, então descobrir pelo erro custaria o estorno dos outros.

**Ordem de travas documentada**: evento primeiro, split depois, em todo caminho de escrita. O arquivamento trava o evento e só *lê* os splits, então não existe ciclo.

**AC#5 é estrutural**: `finished` só transita para `archived` — a máquina de estados nunca permite cancelar um evento finalizado, e split só existe em evento finalizado. Testado como tal, mais `hasConfirmedLootSplit` para quem precisar da consulta.

## Migration
`0015_lethal_vivisector` puramente aditiva: `loot_splits.fee_silver`, `confirmed_by`, `confirmed_at`, dois CHECKs e as quatro triggers de imutabilidade. Zero DROP/ALTER COLUMN.

## Testes desta task
- 25 unitários novos do cálculo puro (taxa, distribuição por percentual, conferência da confirmação, schemas de edição e estorno) — `packages/shared/src/loot-split.test.ts`, 56 no total
- 23 de integração novos em Postgres real — `packages/db/src/loot-split.integration.test.ts`, 45 no total, incluindo os de concorrência e os das triggers
- 16 HTTP novos focados em autorização e frases de erro — `apps/server/src/economy/loot-split.http.test.ts`, 34 no total

## Guardrails (task-done-check)
Sem `any`, `@ts-ignore` ou `eslint-disable` novos no diff; nenhum `Number(`/`parseFloat` sobre prata; nenhum UPDATE/DELETE em `ledger_entries` (o ledger só recebe insert e estorno); nenhum hex solto. Todas as colunas e cálculos de prata em `bigint`. DoD#4 (visual) não se aplica: task backend-only, a tela é a TASK-029.

## security-review (AC#6)

Rodado sobre o diff `origin/main...HEAD` (fd899a3, 38e71fc, 2285fd7). **Nenhum achado com confiança ≥ 8.**

Verificado como seguro:
- **Autorização**: escrever exige `distribute` em `Event` (condição de dono), não `read` em `Event` — que é de todo membro logado e vazaria o ganho de todos. `member` puro não tem `distribute`; caller de outro evento leva 403; staff passa em qualquer um. Estorno é `manage` em `LootSplit`, só staff/admin.
- **IDOR**: `loadSplit` recusa com 404 split que não é do evento da rota, então quem manda num evento não edita/confirma/estorna o split de outro. Ids validados por regex de UUID antes de qualquer query.
- **`userId` no ledger**: nunca vem do pedido. O destinatário de cada `split_payout` sai de `loot_split_lines.userId` (preenchido de `voice_sessions`/`event_signups`) e o do `split_fee` sai de `events.owner_user_id` lido **dentro** da transação. O corpo da edição só aceita `{ totalSilver?, lines?: {id, shareBp}[] }`.
- **Tampering da lista de linhas**: a edição exige cobertura exata das linhas do split; id estranho não entra e linha nenhuma some calada.
- **Integridade do dinheiro**: tudo em `bigint`, sem `number` no caminho de escrita. `silverAmountSchema` recusa sinal, decimal e não-dígito; `shareBp` fica em 0..10000 por linha e a soma tem que ser 10000 exato. A conservação fecha: `total = feeSilver + distributable`, `soma(linhas) = distributable - residual`, `dono = feeSilver + residual`. Nada é criado nem perdido. Taxa maior que o total é recusada em vez de virar distribuível negativo.
- **Crédito duplo**: trava `for update` no evento e no split antes de ler o status; segunda confirmação não insere. Estorno filtra o que já foi estornado e ainda tem o índice único parcial em `reversal_of` atrás.
- **Ledger append-only**: nada no diff faz UPDATE/DELETE em `ledger_entries`. `insertLedgerEntry`/`reverseLedgerEntry` só foram alargados para aceitar transação.
- **SQL injection**: queries parametrizadas pelo drizzle; o único `sql` cru é DDL estática, e as triggers formatam `TG_OP`, não dado de usuário.
- **CSRF**: as três mutações novas sob `SameOriginGuard`.

Observação abaixo da barra de reporte, registrada de propósito: a edição pode gravar `fee_silver` maior que `total_silver` num rascunho com taxa fixa alta (distribuível 0). Não tem impacto em prata — a confirmação recusa —, mas é um valor guardado momentaneamente sem sentido. Se a tela da TASK-029 mostrar esse número, vale ela tratar o caso.

Skills: security-review, task-done-check. As de UI (emil-design-eng, frontend-design, marclou-review, ask-sonner) não se aplicam: task backend-only, a tela é a TASK-029 — por isso DoD#4 não se aplica.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
O rascunho da TASK-027 virou prata de verdade: editar, confirmar e lançar no ledger.

A taxa do evento sai antes da divisão (doc-005, "Taxa do split"), em percentual ou valor fixo e sem teto, e o retido vai para o caller/dono junto com a sobra do arredondamento, num lançamento `split_fee` só (Q23). A pendência que a TASK-027 registrou foi fechada: taxa fixa maior que o total é recusada na confirmação com frase própria, em vez de deixar o distribuível negativo.

Confirmar é uma transação única — um `split_payout` por participante mais o `split_fee` do dono — e a soma dos créditos é exatamente o total do split. A idempotência é do banco, não do JavaScript: a trava `for update` na linha do split faz a segunda confirmação ler `confirmed` e não lançar nada, provado com dez confirmações simultâneas contra Postgres real. Split confirmado vira imutável por trigger, como o ledger, e a correção é estorno pelo `reverseLedgerEntry`, nunca reescrita.

Uma decisão que a implementação exigiu: a prata de cada linha passou a sair do percentual, não dos milissegundos. Depois de uma edição à mão os milissegundos deixam de ser a verdade, e sem isso o número conferido na tela não seria o número creditado.

Verificado com 56 testes unitários do cálculo puro, 45 de integração em Postgres real (incluindo concorrência e as triggers) e 34 HTTP focados em autorização; pnpm quality verde (coverage 89.3%, e2e 58/58) e security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
