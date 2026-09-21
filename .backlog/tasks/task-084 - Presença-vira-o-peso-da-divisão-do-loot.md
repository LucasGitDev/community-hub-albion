---
id: TASK-084
title: Presença vira o peso da divisão do loot
status: Done
assignee:
  - '@claude'
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 13:47'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 6860
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE1 a PE6 no doc-005 (grelha de 2026-09-21). Hoje o formulário de fechamento pede a **% do loot** de cada um, que precisa somar 100% — o caller faz conta na mão. O que ele sabe é quanto cada um participou.

O caller passa a editar **presença de 0 a 100% por pessoa**, independente. A divisão é derivada: cada um recebe `presença ÷ soma das presenças`. A presença nasce da medição da call e o caller edita por cima.

A presença é dado **do evento** (PE4), não da leva: uma leva confirmada não muda quando a presença é editada depois. A **Buffunfa por presença passa a ler a presença editada** (PE5), mantendo o corte de 90% sobre esse número.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 O fechamento pede presença de 0 a 100% por pessoa, sem exigir que some 100%
- [x] #2 A prata de cada um é calculada como presença dividida pela soma das presenças, e a tela mostra os dois números
- [x] #3 A presença de cada participante nasce do tempo medido na call e pode ser editada
- [x] #4 A presença vive no evento: leva de split já confirmada não muda ao editar a presença depois
- [x] #5 A Buffunfa por presença usa a presença editada, com o corte de 90% sobre ela
- [x] #6 Quem esteve na call sem inscrição aparece com presença 0 e só recebe se o caller der presença
- [x] #7 Soma de presenças zero é recusada com mensagem clara, sem dividir por zero
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
1. shared/loot-split.ts: presença vira peso. `measuredPresenceBp`/`effectivePresenceBp` (override ?? medido; não inscrito nasce 0, PE6), `sharesFromPresence` (maior resto sobre 10000, desempate por chave). `calculateSplitDraft` passa a ratear por presenceBp. `checkSplitConfirm` deriva as fatias da presença e recusa `zero_presence` (AC#7); saem `shares_not_100` e `share_without_signup` (AC#6 exige poder dar presença a quem não se inscreveu). `lootSplitUpdateSchema` fica só com totalSilver; nasce `eventPresenceUpdateSchema` ({entries:[{discordUserId,presenceBp}]}).
2. shared/event-attendance.ts: `attendanceRows` passa a receber a presença efetiva (override) e o corte de 90% passa a ser sobre ela (PE5).
3. db: tabela `event_presence_overrides` (event_id, discord_user_id, presence_bp, updated_by, updated_at) — a presença é do evento (PE4). Coluna `presence_bp` em `loot_split_lines` (congela o que a leva usou). Cai o check `loot_split_lines_not_signed_up_has_no_share`. Migration gerada com `db:generate` depois de rebuildar shared.
4. db/repos: `listEventPresenceOverrides`/`setEventPresenceOverrides` (upsert + re-sync do rascunho aberto na mesma transação; leva confirmada intocada). `listEventPresence` devolve presenceBp efetivo. Draft, update e confirm passam a derivar fatia da presença.
5. server: rota `PUT /api/events/:id/presence` (mesma autorização `distribute`), timeline `events.presence_edited` publicada depois do commit.
6. web: tabela do acerto mostra os dois números (presença editável + prata derivada, PE2), em prévia e em rascunho; rodapé troca 'soma 100%' por 'soma das presenças'; e2e do fluxo; screenshots 1280 e 400.
7. Gate completo, security-review, task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Security review (skill security-review, subagent): **nenhum achado com confiança >= 8**. Conferidos: autorização da rota nova (`SameOriginGuard` + `@Authorize()` + `assertCan(distribute)` sobre o `ownerUserId`, igual às rotas irmãs — `member` leva 403); ids do cliente (só snowflake com regex, nenhum `userId` de painel; override de snowflake que não esteve na call nem se inscreveu é **inerte**, porque `listEventPresence` monta a lista de `voice_sessions`+`event_signups` e o override só é mesclado em candidato existente); SQL injection (os únicos `sql`` ` são literais `excluded.presence_bp` e `now()`, tudo mais é bind do drizzle); conta do dinheiro (soma das fatias + taxa + sobra = total exato, nunca negativo, sem estouro); migration que desliga a trigger append-only (o `ENABLE` está no mesmo arquivo, `ALTER TABLE ... DISABLE TRIGGER` é transacional no Postgres e a migration roda em transação, então não há como ficar desligada; o UPDATE toca só a coluna nova); imutabilidade (`setEventPresence` só alcança split `draft`, com o evento travado, e a trigger continua de rede).

**Onde a presença ficou guardada** — tabela nova `event_presence_overrides` (PK `event_id` + `discord_user_id`, `presence_bp` 0..10000, `updated_by`, `updated_at`). Ela guarda **só o que o caller mudou**: sem linha, a presença é a medida (`measuredPresenceBp` sobre `eventCallWindowMs`), e é assim que a PE3 vale sem copiar lista nenhuma no finish. Chave é o snowflake, como em `voice_sessions`, porque quem esteve na call pode não ter conta no painel (PE6).

**Como a leva confirmada congela o que usou** — coluna nova `loot_split_lines.presence_bp`. `setEventPresence` trava o evento, grava o override e, na **mesma transação**, recalcula **todos** os splits em `draft` (presença, participação e prata). Split `confirmed` nunca entra no `where`, e as triggers append-only da TASK-028 continuam de rede. `checkSplitConfirm` deriva a divisão da presença **da linha**, não da presença do evento, então nem a confirmação olha para fora da leva.

`marclou-review` no passo 3 do acerto: sem achado 🔴. #3 (números em vez de adjetivos) ✅ — o rodapé diz "150% de presença somada, entre 2 pessoas", número e divisor, não "divisão proporcional". #28 (CTA diz o que acontece) ✅ — "Calcular divisão", "Salvar só a presença", "Confirmar e creditar". #6 (uma tela, uma ideia) ✅ — o passo é só dividir o loot; a presença é o insumo, não outro assunto. #22 (um CTA) 🟡 aceito — o botão secundário "Salvar só a presença" é um segundo caminho, mas só aparece quando há presença alterada e é `outline` ao lado do primário preenchido; existe porque a presença é dado do evento (PE4) e o prêmio de Buffunfa a lê, então salvar sem abrir leva é caso real.

**Gate completo verde** (commit a991897b, `E2E_WORKERS=2 E2E_PORT=4192`, Postgres real):

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 87.25% | ≥ 79% | ✅ |
| E2E + screenshots | 158 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | ✅ |
| Duplicação | 2,2% | ≤ 15% | ✅ |
| Dead code | 10 item(s) | advisory | ⚠️ (todos pré-existentes) |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

**Evidência por AC**

| AC | Evidência |
|---|---|
| #1 presença de 0 a 100% por pessoa, sem somar 100% | `loot-split.http.test.ts` "a presença do evento vem em lista parcial, de 0 a 100% (PE1, PE4)" e "presença fora de 0 a 100%, lista vazia ou pessoa repetida é 400"; `loot-split.integration.test.ts` "a presença NÃO precisa somar 100%: 10% e 10% dividem meio a meio"; e2e `presence-weight.spec.ts` com 150% somados |
| #2 prata = presença ÷ soma, com os dois números na tela | `loot-split.test.ts` "100%, 100% e 50% de presença viram 40%, 40% e 20%"; `settlement.test.ts` (web) mesma conta; e2e confere na tela 20.001.000 / 9.999.000 com "66,67%" e "33,33%" na mesma linha; screenshots 1280 e 400 |
| #3 nasce da medição e é editável | `loot-split.integration.test.ts` "a medição crua fica ao lado da presença editada (PE3)"; http "measuredPresenceBp: 10_000" com presenceBp 5000; e2e vê "medido 0%" ao lado do número digitado |
| #4 leva confirmada não muda | `loot-split.integration.test.ts` "presença editada depois NÃO muda a leva confirmada, e vale para a próxima (PE4)"; http "leva confirmada não muda quando a presença é editada depois"; e2e compara as linhas da leva 1 antes e depois e confere a leva 2 em 50/50 |
| #5 Buffunfa lê a presença editada, corte de 90% sobre ela | `event-attendance.test.ts` "o corte cai sobre a presença do fechamento, que o caller pode ter editado (PE5)" — sobe (40% medido, 100% editado, passa a receber) e desce (100% medido, 0% editado, deixa de receber) |
| #6 sem inscrição em 0, recebe se o caller der presença | `loot-split.integration.test.ts` "dar presença a quem apareceu sem inscrição o faz receber (PE6, AC#6)"; `settlement.test.ts` "deixa passar quem não se inscreveu" |
| #7 soma zero recusada, sem dividir por zero | `loot-split.test.ts` "soma de presenças zero é recusada"; integration e http com a frase inteira; e2e vê "ninguém com presença" e o botão travado antes de gastar requisição |

**Skills**: `emil-design-eng` (tela do acerto), `security-review` (sem achado com confiança >= 8), `marclou-review` (sem 🔴), `task-done-check`.

**Revisão visual**: screenshots do `presence-weight.spec.ts` em 1280 e 400 lidos pelo agent. O primeiro corte em 400px mostrou a prata e a fatia derivada cortadas na borda do card; corrigido no commit fde9ca4 (medição sai para debaixo do nome, campo encolhe, "da divisão" só a partir do sm) e reconferido.

Rebase sobre a main depois da TASK-085: o commit de correção da spec da loja foi **descartado** (`git rebase --skip`) porque a 085 subiu a mesma correção (`cc3f8e3`). Gate rodado de novo sobre a árvore rebaseada e check `summary` republicado em 849768d. PR #117, mergeable.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A participação do loot split deixou de ser digitada: o caller edita presença de 0 a 100% por pessoa, independente, e a prata sai de presença ÷ soma das presenças (PE1, PE2). A presença nasce da medição da call (PE3) e mora no evento, em event_presence_overrides, não na leva (PE4); a leva confirmada congela o que usou em loot_split_lines.presence_bp e não muda quando a presença é editada depois. A Buffunfa por presença passa a ler o mesmo número, com o corte de 90% sobre ele (PE5); quem apareceu sem inscrição nasce em 0 e só recebe por gesto do caller (PE6); soma de presenças zero é recusada com frase própria, sem dividir por zero. Taxa e sobra do arredondamento não mudaram. Verificado com gate completo verde (158 e2e, cobertura 87,25%), testes puros e de Postgres real por AC, e2e novo presence-weight.spec.ts, screenshots 1280 e 400 revisados e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
