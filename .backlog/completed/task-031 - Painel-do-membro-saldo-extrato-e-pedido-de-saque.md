---
id: TASK-031
title: 'Painel do membro: saldo, extrato e pedido de saque'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 20:14'
labels:
  - frontend
  - economy
milestone: m-5
dependencies:
  - TASK-030
  - TASK-010
priority: medium
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Membro comum vê saldo, extrato e pede saque (Q3). Skills (doc-003): emil-design-eng, ask-sonner, security-review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Membro vê saldo, reserva pendente e extrato próprio
- [x] #2 Membro não acessa dados de outro membro
- [x] #3 Membro pede saque e acompanha status
- [x] #4 security-review executado sem achados críticos
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
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared: LedgerEntryDto + rótulos PT-BR das origens (split_payout, split_fee, withdrawal, reversal, adjustment) + schema de query do extrato.
2. server: GET /api/me/ledger (MyLedgerController) com userId sempre da sessão; testes http provando isolamento entre membros.
3. server: dev-login ganha campo opcional 'silver' (só com AUTH_DEV_LOGIN) pra e2e ter extrato real.
4. web: api/wallet.ts (fetch saldo+saques e extrato) e WalletProvider com usePoll; AppShell, Wallet, MyWithdrawals e WithdrawDialog passam a ler dados reais e param de usar @/mock nesses fluxos.
5. web: sem mínimo de saque (Q12); bloqueio por saldo negativo (Q24); mensagens PT-BR vindas da API; toasts via sonner.
6. Estados carregando/vazio/erro em Carteira e Meus saques; densidade e hierarquia (emil-design-eng/frontend-design).
7. e2e panel.spec cobrindo saldo/reserva/extrato/pedido/recusa + isolamento; screenshots 1280 e 400 revisados.
8. security-review + pnpm quality completo; notas, commits atômicos e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## security-review (AC#4) — sem achado crítico

Rodado sobre o diff completo da branch vs origin/main. Nenhum achado com confiança >= 8. Verificações registradas:
- **IDOR em GET /api/me/ledger**: o handler passa `auth.user.id` (my-ledger.controller.ts:44-46); `parseLedgerPageQuery` devolve só `limit`/`cursor`, então não há spread de chave da query no serviço. O repo filtra sempre por `eq(userId)` (ledger-repo.ts:145-159) — cursor forjado só estreita, nunca amplia. O DTO omite `userId` e `createdBy`.
- **/api/me/withdrawals**: dono continua vindo da sessão; `withdrawalRequestSchema` não tem campo de usuário.
- **dev-login `silver`**: inalcançável em produção por dois portões independentes — o controller só é registrado com `AUTH_DEV_LOGIN` (auth.module.ts:25) e o env recusa o boot com a flag em produção (env.ts:138-141). Os lançamentos vão pro id do próprio usuário recém-criado, com `kind` sem `reversal` e valor limitado por regex; segue append-only.
- **CSRF**: a rota nova é GET sem efeito; o POST do saque mantém `SameOriginGuard`.
- **Cache**: as duas rotas do membro mandam `Cache-Control: no-store`.
- **XSS**: nada de `dangerouslySetInnerHTML`; `memo`/notas renderizam como texto React.

## Quality gate (DoD#1) — c079f769, local, 2026-09-16 20:08 UTC

⚠️ Passou com avisos (nenhum bloqueante):

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.33% | ≥ 79% | ✅ |
| E2E + screenshots (desktop/mobile) | 64 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | build + smoke | ✅ |
| Duplicação | 1.64% | ≤ 15% | ✅ |
| Dead code | 6 (advisory) | 0 | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

Os 6 itens de dead code são exports de shadcn pré-existentes (buttonVariants, DialogOverlay/Portal, TableFooter/Caption, tabsListVariants) — nenhum veio desta task; a task, aliás, reduziu a lista de 8 para 6.

## Tabela de evidências

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 saldo, reserva e extrato | e2e/wallet.spec.ts 'membro vê saldo, reserva e extrato do ledger com a origem de cada lançamento' (desktop+mobile) + screenshots carteira-membro 1280/400 revisados; apps/server/.../my-ledger.http.test.ts 'devolve o extrato do dono da sessão…' | ✅ |
| AC#2 não acessa dado de outro | my-ledger.http.test.ts 'ignora ?userId= de outro membro' e 'sem sessão é 401'; e2e 'membro só enxerga a própria prata' confere a tela **e** a resposta crua de /api/me/ledger e /api/me/withdrawals | ✅ |
| AC#3 pede saque e acompanha | e2e 'pedido de saque sem mínimo: recusa acima do disponível e reserva o valor pedido' (erro PT-BR, toast, reserva, lista em Meus saques) + screenshots saque-erro e meus-saques | ✅ |
| AC#4 security-review | Ver bloco acima: nenhum achado >= confiança 8 | ✅ |
| DoD#2 evidência objetiva | Cada AC acima aponta teste/e2e/screenshot, nenhum é leitura de código | ✅ |
| DoD#4 visual 1280/400 | 12 screenshots do e2e lidos pelo agent + checagem ao vivo por Playwright MCP: sem overflow horizontal (1280→scrollWidth 1280; 400→385), console sem erro, Tab chega nos controles com foco visível, diálogo abre com foco no valor e fecha no Esc, estados com ícone+texto (não só cor) | ✅ |
| DoD#5 doc-005 | Q3 painel do membro; Q10 saldo = dívida da tesouraria; Q12 sem mínimo (o mínimo de 1M saiu até do mock); Q20 prata bigint, string só no transporte; Q24 saldo negativo permitido e bloqueando pedido; Q25 reserva = só `pending` | ✅ |

## Skills (DoD#3)
emil-design-eng, frontend-design (via emil-design-eng), ask-sonner, marclou-review, security-review, task-done-check.

marclou-review mudou duas coisas: um CTA só em Meus saques (tirei o botão 'Atualizar' do cabeçalho — o polling já atualiza — e o 'Pedir saque' do topo some quando a lista está vazia, porque o botão vive dentro do estado vazio, junto da explicação).

## Sobrou de demonstração (fora do escopo, não quebrado)
`apps/web/src/mock/` continua existindo **só** para a fila da staff (`StaffWithdrawals`, real na TASK-032): `allWithdrawals`, `balanceFor`, `decideWithdrawal`, `settleWithdrawal`, `nickOf`. O `AppShell` lê o saldo e os meus saques da API e usa o mock apenas para o contador da fila da staff. O `requestWithdrawal` e o `MIN_WITHDRAWAL` do mock foram removidos (contradiziam a Q12).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Carteira, extrato e saque do membro passaram a falar com a API real. Novo GET /api/me/ledger devolve o extrato do dono da sessão (prata em string, keyset por cursor); o painel ganhou um WalletProvider que compartilha saldo e saques entre o chip do header, a Carteira e Meus saques, então os números nunca divergem entre telas. Saldo, reserva (só saques pending, Q25), extrato com a origem de cada lançamento, pedido sem mínimo (Q12) e bloqueio por saldo negativo (Q24) — tudo em bigint, sem number no caminho do cálculo (Q20). Verificado com 5 cenários e2e em desktop 1280 e mobile 400 (12 screenshots revisados), 6 testes HTTP do endpoint (incluindo ?userId= forjado e 401 sem sessão), testes unitários no shared e no lib do painel, e security-review sem achado. pnpm quality completo: lint 0, typecheck ok, coverage 89.33%, e2e 64/64, imagem Docker ok, 0 vulnerabilidade.
<!-- SECTION:FINAL_SUMMARY:END -->
