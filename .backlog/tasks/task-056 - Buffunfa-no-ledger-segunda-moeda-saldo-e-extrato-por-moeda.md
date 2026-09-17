---
id: TASK-056
title: 'Buffunfa no ledger: segunda moeda, saldo e extrato por moeda'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 17:30'
labels: []
milestone: m-6
dependencies:
  - TASK-055
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduz a Buffunfa como segunda moeda do ledger, sem nenhuma fonte ou sink ainda — é a base das tasks seguintes da F6. A moeda entra na mesma tabela ledger_entries com uma coluna currency (decisão F6-1); tabela separada duplicaria triggers, estorno e telas. O risco assumido é query que esqueça o filtro e some moedas diferentes, e é por isso que saldo e extrato passam a exigir moeda explícita na assinatura.

Detalhe que não é preferência e sim restrição do banco: as triggers append-only vivem em packages/db/migrations/0011_nosy_leopardon.sql:25-33 e recusam UPDATE, então backfill é impossível. A coluna precisa nascer NOT NULL DEFAULT silver (o Postgres preenche sem UPDATE) e o default cai na mesma migration, devolvendo a proteção contra insert sem moeda (F6-2).

Buffunfa não tem saque, mas tem ajuste da staff pela rota de manutenção (F6-6): sem ele, erro de taxa ou de pagamento não tem conserto nenhum, porque o ledger é append-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ledger_entries ganha a coluna currency (silver | buffunfa), NOT NULL, criada com default silver e com o default removido na mesma migration
- [ ] #2 Existe índice de extrato com currency antes de created_at; a leitura de uma moeda não varre a outra
- [ ] #3 getLedgerBalance e as leituras de extrato exigem a moeda na assinatura: não há caminho que devolva saldo somando as duas
- [ ] #4 formatSilver e o componente <Silver> viram genéricos por moeda (formatAmount / <Amount currency>), com todas as chamadas migradas
- [ ] #5 Buffunfa nunca é abreviada na exibição (340 BUF, nunca 0,3K); prata continua abreviando
- [ ] #6 Débito que deixaria o saldo de Buffunfa negativo é recusado na transação, com trava no saldo; ajuste da staff pode deixar negativo
- [ ] #7 POST /api/maintenance/buffunfa credita e debita com motivo obrigatório, atrás do mesmo guard de header da rota de prata
- [ ] #8 O extrato é uma página só, com filtro por moeda (default todas), cada linha marcando a moeda e o cabeçalho trazendo os dois saldos separados, nunca somados
- [ ] #9 O chip do header mostra as duas moedas, com a Buffunfa em destaque
- [ ] #10 O emoji do Discord é criado pelo bot no boot a partir do PNG versionado; falha de permissão ou de slot loga aviso e cai para o texto puro, sem derrubar o bot. Precedência: env > descoberto > texto puro
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
1. shared/currency.ts: CURRENCIES ['silver','buffunfa'], Currency, CURRENCY_LABELS/ABBREV ('BUF'), alias 'bufunfa' só na entrada; formatAmount/formatAmountShort/parseAmount por moeda (F6-4/F6-5: buffunfa nunca abrevia). silver.ts vira re-export fino ou some, com todas as chamadas migradas.
2. packages/db: schema ledgerEntries ganha currency (enum ledger_currency); migration 0018 escrita à mão a partir do drizzle-kit generate — coluna NOT NULL DEFAULT 'silver' e DROP DEFAULT na MESMA migration (F6-2, triggers append-only recusam UPDATE); índice de extrato passa a (user_id, currency, created_at, id) (F6-3).
3. ledger-repo: LedgerEntry/LedgerEntryInput com currency obrigatória; getLedgerBalance(db,userId,currency) e getLedgerBalancesByCurrency (dois saldos separados, nunca somados); listLedgerEntries/WithAuthor com filtro de moeda explícito ('all' só na leitura de extrato). withdrawals-repo filtra currency='silver' em toda soma.
4. Trava de negativo (F6-7/AC#6): spendCurrency em transação com lockUser + releitura do saldo dentro dela; ajuste/estorno da staff passa por fora e pode cravar negativo.
5. server: LedgerService por moeda; /api/me/ledger com ?currency= e dois saldos no cabeçalho; POST /api/maintenance/buffunfa irmã da de prata, mesmo guard/rate limit/motivo obrigatório (F6-6).
6. web: <Amount value currency> substitui <Silver> em todas as telas (brand = Buffunfa, foreground = prata); extrato único com filtro de moeda default 'todas' e moeda por linha (F6-27); chip do header com as duas moedas, Buffunfa em destaque (F6-26).
7. bot: BuffunfaEmojiService no boot — precedência env > emoji descoberto por nome > texto puro; cria a partir de assets/buffunfa_emoji_simples_128.png e loga aviso em falha de permissão/slot, sem derrubar o bot (F6-28).
8. Testes: unit (formatAmount/parseAmount), integração de banco (default+drop, índice, saldo por moeda, trava de negativo), http (maintenance/buffunfa, me/ledger), e2e do extrato e do chip; screenshots 1280/400.
<!-- SECTION:PLAN:END -->
