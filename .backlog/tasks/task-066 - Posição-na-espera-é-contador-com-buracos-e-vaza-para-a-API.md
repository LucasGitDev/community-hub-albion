---
id: TASK-066
title: Posição na espera é contador com buracos e vaza para a API
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:40'
updated_date: '2026-09-17 23:05'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: bug
ordinal: 7060
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado durante a TASK-063. `nextWaitlistPosition` calcula a próxima posição com `max(position)` sobre **todas** as inscrições do slot — inclusive as canceladas e as confirmadas, que têm `position 0`. Resultado: `position` vira um contador monotônico que nunca reaproveita número, então a fila real fica com buracos permanentes (sobra só o "3º" depois que o 1º e o 2º saíram).

A TASK-063 mascarou isso **no painel**, passando a exibir o índice na lista ordenada (1º, 2º). Mas o número cru continua saindo em `/api/events/:id/roster` e no card do membro ("Tank, 1º na espera"). Ou seja: hoje o painel e o que o membro vê podem discordar entre si, que é pior do que os dois estarem errados juntos.

A correção é na origem — a posição precisa refletir a fila real — e não em mais uma camada de exibição.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A posição devolvida pela API é a posição real na fila, sem buracos, depois de cancelamentos e promoções
- [x] #2 O card do membro e o painel da staff mostram o mesmo número para a mesma pessoa
- [x] #3 Teste cobre a sequência: três na espera, o primeiro sai, o segundo é promovido, os restantes renumeram
- [x] #4 A renumeração não altera a ordem relativa de quem já estava esperando
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirmar no código: nextWaitlistPosition usa max(position) sobre TODAS as inscrições da vaga (canceladas e confirmadas têm position 0), virando contador monotônico com buracos.
2. Corrigir na origem em packages/db/src/event-signups-repo.ts: nextWaitlistPosition passa a olhar só quem está em 'waitlist' daquela vaga, e uma nova resequenceWaitlist(tx, slotId, at) renumera a espera para 1..N com row_number() over (order by position, created_at) — preserva a ordem relativa de quem já esperava e só escreve nas linhas cuja posição mudou.
3. Chamar resequenceWaitlist nas três mutações (joinEventRole, leaveEvent, moveEventSignup) para as vagas afetadas (a de origem e a de destino), depois de cancelar/promover, e reler a linha da inscrição para o DTO devolvido não sair defasado.
4. NÃO mexer na regra de promoção: mandar alguém para a espera continua não promovendo ninguém (exclude no promoteFirstWaiting).
5. Migration de dados 0024: renumerar a espera já gravada, para a API não devolver buraco em evento antigo que ninguém tocou.
6. Remover a camada de exibição da TASK-063 (prop rank em SignupRow/StaffEvents): com a origem certa, o painel da staff passa a mostrar o mesmo signup.position que a API e o card do membro. Render idêntico pixel a pixel.
7. Teste de integração que falha antes e passa depois: três na espera, o primeiro sai, o segundo é promovido, os restantes renumeram 1,2 sem trocar de ordem entre si; e teste http/unit provando que API e card do membro dão o mesmo número.
8. pnpm quality completo (TEST_DATABASE_URL no albion_hub_t066, E2E_PORT=4176), task-done-check, screenshots 1280/400, PR citando TASK-066.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Correção (TASK-066)

**Causa**: `nextWaitlistPosition` fazia `max(position)` sobre **todas** as inscrições da vaga — canceladas e confirmadas têm `position 0`, mas as canceladas guardavam o número antigo até serem zeradas, e o max nunca voltava atrás. A posição virou contador monotônico e a fila real ficou com buraco.

**Fix na origem** (`packages/db/src/event-signups-repo.ts`):
- `nextWaitlistPosition` passa a olhar só `status = 'waitlist'` daquela vaga;
- novo `resequenceWaitlist(tx, slotId, at)`: `row_number() over (order by position, created_at, id)` renumera a espera para 1..N **na ordem antiga** (não embaralha quem já esperava) e só escreve nas linhas que mudaram de número;
- `joinEventRole`, `leaveEvent` e `moveEventSignup` renumeram as vagas afetadas depois de cancelar/promover e releem a inscrição antes de devolver o DTO;
- migration `0024_waitlist_resequence.sql` arruma a fila já gravada (por `slot_id`), para evento antigo não devolver buraco pela API;
- a regra de promoção **não mudou**: quem é mandado para a espera continua excluído da promoção da vaga que ele mesmo liberou.

**Camada de exibição removida** (`apps/web/src/pages/StaffEvents.tsx`): a prop `rank` da TASK-063 (índice da lista ordenada) saiu; o painel mostra `signup.position`, igual ao card do membro, ao embed do Discord e à API. Render idêntico.

## Quality gate (commit 27c51c6, local, 2026-09-17 23:01 UTC)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 88.99% | ≥ 79% | ✅ |
| E2E desktop/mobile | 146 ok, 0 falha, 0 flaky (porta 4176) | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | ok | ok | ✅ |
| Duplicação | 2.39% | ≤ 15% | ✅ |
| Dead code | 6 (advisory, exports shadcn pré-existentes) | advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| AC#1 API sem buraco | `db.integration.test.ts` "a espera renumera sem buraco..." (falha antes do fix, passa depois) + e2e `waitlist-position.spec.ts` lendo `/api/events/:id/signups`: espera = [segundoP 1, terceiroP 2] | ✅ |
| AC#2 card do membro = painel da staff | e2e `waitlist-position.spec.ts`: card do membro "Tank, 1º na espera" e painel com "1º" no mesmo nome, desktop 1280 e mobile 400; screenshots `espera-fila-cheia`, `espera-membro-renumerado`, `espera-painel-staff` | ✅ |
| AC#3 três na espera, o 1º sai, o 2º é promovido, os restantes renumeram | `db.integration.test.ts` (TASK-066): 3 esperando [1,2,3] → confirmado sai → b promovido, [c=1, d=2] → c sai → [d=1] → quem entra depois pega 2 | ✅ |
| AC#4 renumeração não muda a ordem relativa | mesma sequência acima mantém c antes de d; `order by position, created_at, id` prova por construção; migration validada em psql com buracos 5 e 7 → 1 e 2, por slot, sem tocar confirmado/cancelado | ✅ |

Skills: task-done-check, emil-design-eng (linha da espera no painel: nenhuma mudança visual, nenhuma animação nova — nada a corrigir). `security-review` não se aplica: o diff não toca auth, ledger, prata nem saque.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A posição da lista de espera passou a ser a posição real da fila: nextWaitlistPosition só conta quem está esperando e toda mutação renumera a espera da vaga para 1..N na ordem antiga, com migration 0024 arrumando o que já estava gravado. Com a origem certa, a camada de exibição da TASK-063 saiu do painel — staff, card do membro, embed e API mostram o mesmo número. Verificado com testes de integração que falham antes e passam depois, e2e desktop/mobile lendo as duas telas e a API, e pnpm quality completo verde (146 e2e, coverage 88.99%).
<!-- SECTION:FINAL_SUMMARY:END -->
