---
id: TASK-027
title: Draft de loot split proporcional à presença
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 19:27'
labels:
  - economy
  - events
  - backend
milestone: m-5
dependencies:
  - TASK-026
  - TASK-024
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Draft de split proporcional ao tempo no canal do evento entre start e finish (Q5, Q6); presente não inscrito entra com 0% (Q7); N splits por evento (Q23).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Draft calcula % por tempo no canal do evento entre start e finish
- [x] #2 Presente não inscrito aparece com 0%
- [x] #3 Evento aceita múltiplos splits
- [x] #4 Evento cancelado não aceita split
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
1. shared/loot-split.ts: taxa do evento (percent em basis points OU fixed em prata, bigint, sem teto), LOOT_SPLIT_STATUSES, DTOs e cálculo puro do draft (peso = ms de presença dos inscritos; largest-remainder pra % fechar 100%; prata por floor com resíduo explícito pro owner, Q23).
2. packages/db/schema.ts: colunas aditivas event_templates.default_fee_{type,value}, events.fee_{type,value} (herda do template na criação) e events.presence_channel_id (voice_channel_id vira null quando o canal é apagado no finish — sem isso a janela de presença some); tabelas loot_splits e loot_split_lines. Migration 0012 via pnpm db:generate.
3. packages/db/loot-split-repo.ts: presença por discord_user_id no canal do evento entre started_at e finished_at (Q6) unida aos inscritos (não inscrito presente entra com 0%, Q7), criação do draft em transação com evento travado, leitura e listagem, set da taxa do evento.
4. apps/server/economy/loot-split.service.ts (serviço interno, porta única) + controller REST com CASL em LootSplit e assertEventEditable; split só nasce com o evento finished, cancelado/arquivado recusa (AC#4). Plugar setArchivePrecondition (hook deixado pela TASK-044) com a consulta real de split em rascunho.
5. Testes: unit do cálculo puro, integration de banco (multiplos splits AC#3, 0% AC#2, presença AC#1, cancelado AC#4), http do controller (authz).
6. pnpm quality completo com Postgres na 55434, security-review (AC#5), task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, commit c073abf, Postgres :55434)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.49% | ≥ 79% | ✅ |
| E2E + screenshots (1280/400) | 58 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.36% | ≤ 15% | ✅ |
| Dead code | 6 (todos pré-existentes em apps/web/src/components/ui) | 0 advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

Resultado: **Passou com avisos** (só o advisory de dead code pré-existente).

Nota de ambiente: a porta 4173 do e2e é fixa e compartilhada entre worktrees; rodadas concorrentes com outro agent (task-030) deram falsos negativos até a porta liberar. Com a porta livre, 58/58 passam.

## Testes desta task
- 31 unitários do cálculo puro (packages/shared/src/loot-split.test.ts)
- 22 de integração em Postgres real (packages/db/src/loot-split.integration.test.ts)
- 18 HTTP do controller, focados em autorização (apps/server/src/economy/loot-split.http.test.ts)

## Rebase em origin/main (TASK-030 mergeada) + gate final

Rebase refeito depois do merge da TASK-030: migration renumerada 0013 → **0014_mixed_skaar**, journal e snapshot coerentes, e ainda puramente aditiva (0 DROP/ALTER COLUMN). O conflito de `schema.ts` foi resolvido reconstruindo o arquivo a partir do de `origin/main` + só as minhas adições, em vez de casar marcadores — as 18 tabelas seguem lá, incluindo `ledger_entries`, `user_notes`, `withdrawals` e as duas do split. Prova: o `drizzle-kit generate` só emitiu as **minhas** mudanças (nada de withdrawals/user_notes/ledger), e o typecheck passa (colchetes balanceados).
`economy.module.ts` ficou com os três serviços juntos: LedgerService + WithdrawalService + LootSplitService, e os três controllers.

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.2% | ≥ 79% | ✅ |
| E2E + screenshots (1280/400) | 58 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | ok | ok | ✅ |
| Duplicação | 1.68% | ≤ 15% | ✅ |
| Dead code | 6, todos pré-existentes em apps/web/src/components/ui | advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

## security-review (AC#5)
Sem achado com confiança ≥ 8. Verificado como seguro: nenhum endpoint aceita `userId` do cliente (o `userId` de cada linha vem de `voice_sessions`/`event_signups`); ler split exige `distribute` no evento e **não** `read` — `read` em Event é de todo membro logado, e o split mostra o ganho de todos; split de outro evento dá 404 pela rota de um evento que o caller manda; POST/PUT com SameOriginGuard; queries parametrizadas pelo drizzle; prata só em bigint, com `^\d+$` no schema e CHECKs no banco.
Registro para a TASK-028: a taxa não tem teto (decisão do usuário), então **lá** é preciso barrar taxa fixa maior que o total do split, senão o distribuível fica negativo.

## Guardrails (task-done-check)
Sem `any`/`@ts-ignore`/`eslint-disable` novos; sem hex solto; nenhum UPDATE/DELETE em `ledger_entries` (esta task não toca no ledger); todas as colunas de prata em `bigint`. O único `Number(` do diff é formatação de percentual em `formatEventFee`.

## Evidências por AC
| AC | Evidência | Status |
|---|---|---|
| AC#1 % por tempo no canal entre start e finish | unit "divide proporcionalmente aos milissegundos de presença" + integração "rateia pela presença medida...", "conta só o pedaço da sessão dentro da janela, e só no canal do evento", "a janela sobrevive ao canal apagado no finish" + HTTP "cria o rascunho com presença, percentual e prévia em prata" | ✅ |
| AC#2 presente não inscrito com 0% | unit "aparece na lista, com o tempo dele, mas sem participação" e "não dilui quem estava inscrito" + integração "aparece na lista com o tempo dele...", "presente sem conta no painel entra com userId null", "o banco recusa dar participação a quem não estava inscrito" | ✅ |
| AC#3 múltiplos splits | integração "o mesmo evento aceita várias levas, cada uma fechando 100% do próprio total" + HTTP "N splits por evento, listados na ordem em que as levas chegaram" | ✅ |
| AC#4 cancelado não aceita split | integração "evento cancelado não aceita split" + HTTP "evento cancelado não aceita split (AC#4)" (409 PT-BR) | ✅ |
| AC#5 security-review sem crítico | relatório acima, 0 achados ≥ 8 | ✅ |

Skills: security-review, task-done-check. Não se aplicam as de UI (emil-design-eng, marclou-review, frontend-design): esta task é backend-only, a tela é a TASK-029 — por isso DoD#4 não se aplica.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rascunho de loot split proporcional à presença, sem confirmação e sem tocar no ledger (isso é a TASK-028).

O rateio pesa os milissegundos de cada pessoa no canal do evento entre start e finish (Q6); não há presença mínima porque o split já é proporcional (Q5). Presente não inscrito aparece na lista com o tempo dele mas fica fora do denominador, com 0% (Q7). Arredondamento documentado e testado: prata truncada por linha, com o resíduo explícito no rascunho para o caller/dono (Q23), e percentual por maior resto para a lista fechar 100% exato (Q22). Um evento aceita N splits, cada um com seu total (AC#3); só nascem de evento finished, e cancelado/arquivado recusam (AC#4, Q26).

A taxa do evento entrou modelada e editável, não aplicada: percentual ou valor fixo, sem teto, default no template e copiada para o evento na criação, congelada no split quando o rascunho é criado.

Duas coisas que a implementação exigiu além do óbvio: events.presence_channel_id, porque o bot zera voice_channel_id ao apagar o canal no finish e o split nasce depois disso — sem o carimbo a janela de presença sumiria; e a precondição de arquivamento que a TASK-044 deixou preparada, agora ligada de verdade.

Verificado com 31 testes unitários do cálculo puro, 22 de integração em Postgres real e 18 HTTP focados em autorização; pnpm quality verde (coverage 89.2%, e2e 58/58) e security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
