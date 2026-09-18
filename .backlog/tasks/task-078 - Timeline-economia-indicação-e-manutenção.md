---
id: TASK-078
title: 'Timeline: economia, indicação e manutenção'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-18 03:22'
updated_date: '2026-09-18 03:47'
labels: []
milestone: m-12
dependencies:
  - TASK-076
priority: medium
type: feature
ordinal: 6920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instrumenta na timeline (TASK-076) as operações que movem dinheiro. Decisões T1 a T14 no doc-005.

Loot split confirmado; saque pedido, aprovado, recusado e entregue; taxa de entrada cobrada e devolvida; Buffunfa por presença paga; indicação declarada, paga e estornada; ajustes de prata e de Buffunfa pela manutenção, revalidação de nick e limpeza sob demanda.

As rotas de manutenção aparecem **sempre**, com o ator "manutenção" (T9): elas criam prata em produção, e é justamente o que o canal de auditoria precisa ver. Valores em prata aparecem por inteiro — o canal é só de admins (T2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cada operação listada publica na timeline depois do commit, com ator, alvo, valor na moeda certa e ID
- [x] #2 Ajuste pela rota de manutenção publica com ator "manutenção" e o motivo informado
- [x] #3 Pagamento em lote (Buffunfa por presença, loot split) publica um registro por pessoa ou um consolidado legível, sem estourar o limite do Discord
- [x] #4 Cada operação instrumentada tem teste provando o que publicou, usando o publicador falso
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
1. Repo: listTimelinePeople (nick + discordId por id) para ator/alvo sem SQL no serviço.
2. Helper server publishAfterCommit: monta o registro depois do commit, engole e loga erro de lookup (falha nunca derruba a operação).
3. Economia: WithdrawalService (pedido, aprovado, recusado, entregue), LootSplitService (confirmado + estornado, consolidado em list), EventAttendanceService (Buffunfa por presença, consolidado em list).
4. Taxa de entrada: EventSignupsService (cobrada no join, devolvida no leave); devolução em lote no cancelamento/início por listener de transição no módulo de economia, lendo os estornos do evento (sem tocar events.service da TASK-077).
5. Indicação: ReferralService (declarada, paga com os dois lados, estornada).
6. Manutenção: controller publica ajuste de prata/Buffunfa, revalidação e limpeza com ator manutenção e motivo em details; nada do token.
7. Testes com FakeTimelinePublisher nos http tests (AppModule.register timeline: fake), incluindo recusa sem publicação.
8. security-review, task-done-check, pnpm quality, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate completo (pós-rebase sobre TASK-079, banco recriado, E2E_PORT=4182): lint 0, race 0, typecheck ok, coverage branch 87.62% (>=79), E2E 146 ok/0 falha, imagem ok, duplicação 2.28%, audit 0; dead code advisory 10 (pré-existentes, nenhum desta task).

Evidência por AC:
- AC#1: withdrawals.http.test 'timeline do saque' (pedido/aprovado/recusado/entregue: ator, alvo, prata, recordId); loot-split.http.test 'timeline do loot split' (confirmado + estornado); event-attendance.http.test 'fechamento'; event-signups.http.test (taxa cobrada, devolvida no leave, em lote no cancel e no start); referral.service.test 'timeline da indicação' (declarada, paga 2+10 BUF, teto mensal, estornada). Todos afirmam só depois de a operação resolver.
- AC#2: maintenance.http.test 'timeline (TASK-078, T9)': ajuste de prata e de Buffunfa com actor maintenance e details Motivo; revalidação e limpeza; dump dos registros não contém o token.
- AC#3: loot split, Buffunfa por presença e devolução em lote publicam UM registro com list (uma linha por pessoa e valor); o render do TASK-076 corta a lista no orçamento do Discord.
- AC#4: cada operação acima tem teste com FakeTimelinePublisher, incluindo recusa sem registro (entries vazio) e idempotência (segunda confirmação/pagamento/estorno não publica).
- DoD#7: after-commit.test prova que falha ao montar o registro (lookup de nome) vira aviso e não derruba a operação.

Decisões fora do doc-005: (1) estorno de loot split também publica (economy.loot_split_reversed) — T7 cobre tudo que altera dinheiro; (2) devolução em lote no cancel/start sai de um listener pós-commit de transição (EntryFeeTimelineService) que lê os estornos pelo memo, para não tocar events.service/events-repo (área da TASK-077); (3) revalidação de nick pelo painel do admin não publica aqui (conta, TASK-077) — só a porta de manutenção; (4) pagamento da indicação tem ator system 'pagamento da indicação' (quem dispara é a declaração ou a aprovação do nick).

Skills: security-review (sem achado: nenhum header/token entra no registro, nomes passam pelo escape do embed e menções saem com allowed_mentions vazio, nenhuma rota/permissão nova), task-done-check. Sem UI alterada: DoD#4 não se aplica.
<!-- SECTION:NOTES:END -->
