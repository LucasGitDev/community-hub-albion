---
id: TASK-072
title: Ajustar Buffunfa de todas as roles durante o evento
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 19:59'
updated_date: '2026-09-17 21:19'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 7020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje o valor de Buffunfa por role é editável durante todo o ciclo do evento (só trava depois de pago, `setEventRoleBuffunfa`), mas de dois jeitos inconvenientes: **uma role por vez** e **preso à faixa que o template definiu**.

O caso real que o usuário descreveu: no geral todas as roles ganham o mesmo X desde o início, e depois isso muda. Com o desenho atual, isso é uma edição por role, repetida, e impossível de levar acima do máximo do template — inclusive em template antigo, que veio com faixa 0 a 0 (F6-51) e por isso não paga nada.

O que muda: um ajuste em lote ("todas as roles recebem X") e a faixa do template deixando de ser teto rígido do evento, passando a ser **sugestão de partida**. O teto que continua valendo é o do sistema (`BUFFUNFA_ROLE_MAX`), que existe para evitar erro de digitação, não para limitar o caller.

Isto revisa as decisões F6-8 e F6-48 por pedido do usuário em 2026-09-17: a faixa obrigatória foi desenhada para conter inflação, mas na prática virou atrito para quem organiza o evento, que é quem sabe quanto o conteúdo vale naquele dia.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 O caller define um valor de Buffunfa para todas as roles do evento de uma vez
- [x] #2 O valor de uma role específica continua editável individualmente depois do ajuste em lote
- [x] #3 O valor do evento aceita qualquer inteiro entre zero e o teto do sistema, independente da faixa do template
- [x] #4 A faixa do template continua servindo de valor inicial do evento
- [x] #5 Depois de pago, o valor segue congelado e o ajuste é recusado com motivo
- [x] #6 Evento criado a partir de template antigo, com faixa zerada, consegue pagar Buffunfa
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
1. DB: o check `event_role_slots_buffunfa_range` deixa de amarrar `buffunfa_value` à faixa do template e passa a dizer o que continua valendo — min>=0, max>=min (faixa ainda é snapshot/sugestão) e `buffunfa_value between 0 and BUFFUNFA_ROLE_MAX` (teto do sistema). Renomeado para `event_role_slots_buffunfa_bounds` para o nome não mentir. Migration 0023.
2. Repo (`packages/db/src/event-attendance-repo.ts`): `setEventRoleBuffunfa` troca a recusa `out_of_range` (faixa do template) por `above_max` (teto do sistema); `already_paid` e `not_found` ficam. Nova `setAllEventRolesBuffunfa(db, eventId, value)` com as mesmas guardas, um UPDATE em todas as vagas do evento na mesma transação, devolvendo quantas roles mudaram.
3. Shared: `inBuffunfaRange` continua para o template; a checagem do evento vira `isBuffunfaValue` (0..BUFFUNFA_ROLE_MAX). `formatBuffunfaRange` ganha leitura de sugestão.
4. Server: `PATCH /api/events/:eventId/attendance/roles` (lote) ao lado do `PATCH .../roles/:slotId` (individual), mesma autorização `distribute` + SameOriginGuard + `assertEventEditable`; mensagens de recusa reescritas (teto do sistema, já pago).
5. Web: campo único 'todas as roles recebem X' + Aplicar a todas, acima da grade por role; campo por role deixa de travar quando min==max (era o que impedia template antigo de pagar); `checkRoleValue` valida 0..teto do sistema e a faixa do template vira texto de sugestão.
6. Testes: integração no repo (lote sobre valores diferentes, acima da faixa antiga, acima do teto, faixa zerada pagando, depois de pago), http do controller, unit do lib web, e2e do fluxo em 1280 e 400.
7. Skills task-done-check e emil-design-eng, `pnpm quality` completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate

`pnpm quality` completo (E2E_PORT=4172, TEST_DATABASE_URL=albion_hub_t072): ⚠️ Passou com avisos — lint 0, race 0, typecheck ok, coverage de branch 88.79% (≥79%), e2e 144 ok / 0 falha / 0 flaky, imagem Docker build + smoke ok, duplicação 2.33% (≤15%), vulnerabilidades high+ 0. Único aviso: dead code advisory de 6 exports de shadcn (button/dialog/table/tabs), todos pré-existentes e fora do diff.

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| #1 valor para todas as roles de uma vez | `event-attendance.integration.test.ts` "o lote põe todas as roles no mesmo valor..." (roles saem do template com 10 e 0, viram 77/77); `event-attendance.http.test.ts" lote via PATCH /attendance/roles + o teste de autorização do lote (401/403/403/404); e2e "caller põe todas as roles num valor de uma vez" desktop e mobile; screenshots buffunfa-lote-{D,M} e buffunfa-lote-aplicado-{D,M} | ✅ |
| #2 role específica editável depois do lote | mesmo teste de integração (lote 77 → Tank individual 120 → {Tank 120, Healer 77}); http idem (55/55 → Tank 80); e2e aplica 135 na Tank depois do lote de 60 e confere no GET /api/events/:id | ✅ |
| #3 qualquer inteiro entre zero e o teto do sistema | integração: 900 e 3 passam (fora da faixa 10–40 do template), BUFFUNFA_ROLE_MAX passa, +1 recusa com `above_max` e não deixa rastro; http: 900/9/0 → 200, 10001 → 400 citando 10000, -1 e "2,5" → 400; unit `attendance.test.ts`; e2e escreve 10001 e lê o erro na tela | ✅ |
| #4 faixa do template como valor inicial | integração "a faixa do template vira snapshot na vaga e o valor nasce no mínimo"; http "o evento nasce com a faixa do template e o valor no mínimo" (Tank 10/40→10, Healer 0/0→0); e2e lê "template sugere 10 a 40 BUF" e campo em 10 | ✅ |
| #5 congelado depois de pago, com motivo | integração: individual e lote devolvem `already_paid` e o valor continua 30; http: os dois PATCH devolvem 409 com "já foi paga" | ✅ |
| #6 template antigo de faixa zerada paga | integração "evento de template antigo, com faixa 0 a 0, paga Buffunfa de verdade" (lote 60 → preview sem skip → ledger 60n); http "template antigo com faixa zerada" (lote 0 → zero_value; lote 70 → payout 201 e saldo +70); e2e confere que o campo do Healer 0/0 está editável | ✅ |

## Guardrails

Grep no diff `main...HEAD`: nenhum `any`/`@ts-ignore`/`eslint-disable` novo, nenhum `Number(`/`parseFloat` sobre valor, nenhum update/delete de lançamento, nenhum hex solto. Valores todos `bigint`.

## Segurança (DoD#6)

Revisão do diff de servidor/db: a rota em lote herda a mesma porta do ajuste individual (`@Authorize()` + `SameOriginGuard` + `assertCan("distribute")` + `assertEventEditable`), com 401/403/403/404 provados em teste. A criação de moeda continua limitada em três camadas — zod (`^\d+$`, sem sinal, ≤ BUFFUNFA_ROLE_MAX), `isBuffunfaValue` no repo e o `check` do banco (`between 0 and 10000`) —, então tirar a parte da faixa do check não afrouxa o teto. O UPDATE em lote é escopado por `eventId` (UUID validado), o individual mantém o par `and(id, eventId)`, e o `already_paid` continua sob `select ... for update` na mesma transação do UPDATE. Nenhum `userId` vem do cliente; ledger segue insert-only. Sem achado.

## Skills

emil-design-eng (campo em lote acima da grade por role), task-done-check, security-review (revisão manual do diff: a skill shelled out para o repo raiz e veio com diff vazio). `marclou-review` e `revenue-centric-design` não se aplicam: painel interno do caller, sem onboarding, conversão ou economia nova.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A faixa de Buffunfa do template deixou de ser teto do evento e virou valor de partida: o que limita agora é o teto do sistema (BUFFUNFA_ROLE_MAX), que existe contra erro de digitação. Junto veio o ajuste em lote — `PATCH /api/events/:id/attendance/roles` põe todas as roles no mesmo valor —, com o ajuste individual valendo por cima dele. O check do banco foi reescrito (`event_role_slots_buffunfa_bounds`, migration 0023): a faixa continua coerente e o valor vigente fica entre zero e o teto, sem estar mais preso à faixa. Com isso, evento criado de template antigo com faixa 0 a 0 passa a pagar. Depois de pago tudo continua congelado, no lote e no individual. Verificado com testes de banco, HTTP, unit e e2e em desktop 1280 e mobile 400, e `pnpm quality` completo verde. Revisa F6-8 e F6-48.
<!-- SECTION:FINAL_SUMMARY:END -->
