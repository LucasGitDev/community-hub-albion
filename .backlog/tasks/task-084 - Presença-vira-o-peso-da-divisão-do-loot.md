---
id: TASK-084
title: Presença vira o peso da divisão do loot
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 13:23'
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
- [ ] #1 O fechamento pede presença de 0 a 100% por pessoa, sem exigir que some 100%
- [ ] #2 A prata de cada um é calculada como presença dividida pela soma das presenças, e a tela mostra os dois números
- [ ] #3 A presença de cada participante nasce do tempo medido na call e pode ser editada
- [ ] #4 A presença vive no evento: leva de split já confirmada não muda ao editar a presença depois
- [ ] #5 A Buffunfa por presença usa a presença editada, com o corte de 90% sobre ela
- [ ] #6 Quem esteve na call sem inscrição aparece com presença 0 e só recebe se o caller der presença
- [ ] #7 Soma de presenças zero é recusada com mensagem clara, sem dividir por zero
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
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
<!-- SECTION:NOTES:END -->
