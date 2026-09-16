---
id: TASK-032
title: Painel staff de saques
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 20:52'
labels:
  - frontend
  - economy
milestone: m-5
dependencies:
  - TASK-030
  - TASK-010
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff aprova, rejeita e liquida saques (Q10, Q11, Q25). Skills (doc-003): emil-design-eng, ask-sonner, security-review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff filtra saques por status
- [x] #2 Staff aprova, rejeita e marca settled com nota
- [x] #3 Não-staff não acessa a tela nem a API
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
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db: getWithdrawalBalances(db, userIds) — saldo/reserva/disponível em lote, uma query só, mesma conta única de getWithdrawalBalance.
2. server: GET /api/withdrawals passa a devolver { withdrawals, balances } (balances só dos donos que já estão na lista devolvida — não vaza ninguém novo). Filtro por status já existia; membro continua com o filtro forçado no próprio id.
3. shared: WithdrawalQueueResponse (withdrawals + balances) como tipo único de API/painel.
4. web: api/withdrawals-queue.ts (fetch + approve/reject/settle, prata string→bigint na borda, Q20) e QueueProvider com usePoll, compartilhado entre AppShell (contador) e StaffWithdrawals — mesmo padrão do WalletProvider da TASK-031. Provider não busca nada quando a ability não permite approve Withdrawal.
5. web: StaffWithdrawals ligada na API real — abas por estado, aprovar, recusar com motivo obrigatório, marcar entrega com nota obrigatória (Q11). Por pedido: nick, valor, quando, e o saldo do membro no momento (total/reservado/disponível) pra decidir com contexto.
6. web: estados carregando (skeleton), vazio e erro; toasts via sonner (ask-sonner); concorrência — erro 409 da API vira toast com a mensagem da API e refresh da lista, nunca sucesso falso.
7. Remover apps/web/src/mock/ inteiro + StoreProvider do main.tsx + a entrada mock/rules.ts do quality.config.json.
8. server: testes HTTP de RBAC (membro não lê a fila alheia nem aprova/recusa/liquida) e do bloco balances.
9. e2e: helper compartilhado de dev-login com id por rodada (timestamp) extraído de wallet.spec.ts; staff-withdrawals.spec.ts cobrindo fila, aprovar, recusar, entregar, concorrência e não-staff; screenshots 1280 e 400.
10. security-review, pnpm quality completo, task-done-check, commits atômicos e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (DoD#1) — 69e78c84, local, 2026-09-16 20:48 UTC

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.1% | ≥ 79% | ✅ |
| E2E + screenshots (desktop/mobile) | 66 ok, 6 falha(s) | 0 falhas | ⚠️ ver abaixo |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | build + smoke | ✅ |
| Duplicação | 1.60% | ≤ 15% | ✅ |
| Dead code | 6 (advisory) | 0 | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

**As 6 falhas de e2e são pré-existentes, não desta task** (TASK-046): `staff-templates` (4),
`admin-members` (1) e `panel` "admin concede e remove caller" (1) — todas timeout de 30s sob carga
local com `fullyParallel` em dois projects no mesmo Postgres. Provado por bissecção: rodei
`panel -g "admin concede" --workers=1` nesta branch → PASS 1 / FAIL 1, e **na `origin/main` limpa →
PASS 1 / FAIL 1, idêntico**. Rodando as duas specs desta task isoladas: **20/20 verde**; a suíte
inteira isolada: **72/72 verde**. O CI, com `retries: 1` em runner limpo, é o sinal que vale.

Os 6 itens de dead code são exports pré-existentes do shadcn; a task não adicionou nenhum (os dois
que ela tinha criado — `Role` em e2e/session.ts e o reexport de `WithdrawalStatus` — foram removidos).

## security-review (AC#4, DoD#6) — sem achado crítico

Rodado sobre o diff completo da branch vs origin/main. **Nenhum achado com confiança >= 8.** Verificado:

- **Autorização/IDOR**: `canSeeAll` é `ability.can("approve","Withdrawal")`, exatamente o papel que
  também tem `read` incondicional (permissions.ts:74-75), então o corte staff/não-staff não alarga o
  `read`. Não-staff pedindo `?userId=` de outro leva 403 (controller:121) e, sem filtro, o `userId` é
  sobrescrito pelo da sessão (controller:124). O detalhe por id mantém o `asSubject` com 404.
- **Exposição pelo `balances` novo**: a lista de ids sai **só** de `withdrawals.map(w => w.userId)`
  (controller:125) — nenhum id do cliente chega lá. Para não-staff a lista já está travada no próprio
  id, então o mapa tem no máximo uma entrada, a dele. Coberto por teste: 'membro comum recebe só o
  próprio saldo no bloco, nunca o de outro'.
- **SQL injection**: `getWithdrawalBalances` usa `inArray` do drizzle (parâmetros bound) nos dois lados;
  o único template `sql` interpola coluna do drizzle, não dado de usuário. Zero concatenação.
- **CSRF**: approve/reject/settle seguem com `SameOriginGuard`; o diff só mexeu no `@Get()`, que não
  muda estado e manda `Cache-Control: no-store`.
- **Identidade do ator**: `decided_by`/`settled_by` saem de `auth.user.id`; os schemas de corpo só têm
  `note`, e o cliente novo manda `{}` ou `{ note }` — não há campo de ator para o servidor ignorar.
- **XSS**: nenhum `dangerouslySetInnerHTML` no painel; nota e motivo renderizam como texto React.

## Bug pego pelo e2e (vale registrar)

A primeira versão de `getWithdrawalBalances` montava `values (${a}::uuid, ${b}::uuid)` — **uma linha
com várias colunas** em vez de várias linhas. Passou no teste HTTP porque ele tinha um dono só. O e2e
pegou (o saldo sumia da linha), e o teste de dois donos na mesma resposta virou regressão permanente.
A query foi reescrita com `inArray` do drizzle, sem SQL cru.

## Visual (DoD#4) — 1280 e 400 revisados pelo agent

Screenshots lidos por mim via Playwright MCP, com a fila populada de verdade:
- **1280**: aba Em análise (fila cheia), aba A entregar, estado de recusa com o textarea aberto.
- **400**: aba Em análise e aba A entregar.

Achados e correções:
- **Bug de layout corrigido**: no 1280, na aba "A entregar", a pílula "Aprovado, aguardando entrega"
  passava por cima da linha do tempo — o formulário de entrega (`lg:w-96`) espremia a coluna `1fr` até
  o texto quebrar em 4 linhas. A grade virou 3 colunas (quem pediu + história | valor + estado | ação),
  com a linha do tempo junto do nome e o formulário em `lg:w-80`.
- Placeholder da entrega encurtado para "Como pagou (ex: banco de Martlock)": o anterior era cortado.
- Sem overflow horizontal: 1280 → scrollWidth 1280; 400 → 385 = clientWidth.
- Console sem erro (o único é o 401 de bootstrap do `/api/auth/me` sem sessão, pré-existente).
- Estados nunca só por cor: pílula com ícone + texto + borda, e barra lateral no pendente/aprovado.
- Teclado: os controles da linha recebem foco com anel visível (`outline oklch(0.8 0.15 80)`).
- Hierarquia: valor do saque é o elemento mais forte da linha; dourado só no número-chave do card e no
  CTA primário.

## marclou-review (UI/copy)

🟢 #6 uma tela uma ideia (decidir saque), #22 um CTA por linha (Recusar secundário, Aprovar primário),
#28 CTA diz o que acontece ("Aprovar saque", "Marcar como entregue", "Confirmar recusa"), #3 números em
vez de adjetivos nos hints ("4 pedidos esperando decisão"), #26 sem palavra fraca.
🟡 #2 três cores: a pílula "Em análise" usa o token `warning`, que é âmbar e divide atenção com o
dourado do CTA. **Não mexi de propósito**: `StatusBadge` é compartilhado com as telas do membro e
trocar o token sairia do escopo desta task.
Nenhum 🔴.

## Skills (DoD#3)
emil-design-eng, frontend-design, ask-sonner, marclou-review, security-review, task-done-check.

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| AC#1 staff filtra saques por status | e2e/staff-withdrawals.spec.ts 'fila mostra quem pediu...' (navega Em análise → A entregar → Entregues) e 'recusa exige motivo...' (aba Recusados), desktop 1280 + mobile 400; estados vazio e erro em 'fila vazia explica o que aparece em cada aba...'; HTTP 'a fila da staff mostra todo mundo e filtra por estado' | ✅ |
| AC#2 aprova, rejeita e marca settled com nota | e2e 'fila mostra quem pediu, quanto e o saldo do membro; staff aprova e marca a entrega' (botão de entrega desabilitado sem nota, Q11) e 'recusa exige motivo e o motivo fica registrado' (Confirmar recusa desabilitado sem motivo; a reserva volta pro membro, Q25); screenshots fila-staff-pendentes / -entregue / -recusa | ✅ |
| AC#3 não-staff não acessa a tela nem a API | e2e 'membro comum não vê a fila nem age em saque alheio': sem link no menu, sem a tela, 403 em approve/reject/settle, a lista não devolve saque alheio, `balances` no máximo com o próprio id, e o pedido do outro continua `pending`; HTTP 'membro não aprova, não recusa e não liquida (403)', 'membro pedindo a lista de outro leva 403' e 'membro comum recebe só o próprio saldo no bloco' | ✅ |
| AC#4 security-review sem achado crítico | Bloco acima: nenhum achado com confiança >= 8 | ✅ |
| DoD#5 doc-005 | Q10 saldo = dívida da tesouraria, entrega é transferência in-game (copy da tela); Q11 `settled` manual com quem liquidou (da sessão) + nota obrigatória; Q25 aprovar debita no ledger, recusar libera a reserva — as duas conferidas no e2e; Q12 sem mínimo (nada de mínimo entrou); Q24 não se aplica a esta tela | ✅ |

## Concorrência (pedido explícito da task)

'outro staff já decidiu: a tela mostra o erro da API e recarrega, não finge sucesso': um segundo staff,
em outro contexto de requisição, aprova o mesmo pedido; a tela que ainda mostrava "pendente" tenta
recusar, recebe o 409 com a frase da API, mostra o toast "Nada mudou neste saque" e recarrega — a linha
sai de "Em análise" e aparece em "A entregar". No servidor: 'dois staff no mesmo saque: o segundo leva
409 e a decisão do primeiro fica de pé'.

## Dados de demonstração: removidos

`apps/web/src/mock/` não existe mais (5 arquivos), junto do `StoreProvider` no main.tsx e da entrada
`apps/*/src/mock/rules.ts` do `quality.config.json`. Um cenário antigo de `panel.spec.ts` dependia dos
membros semeados no mock e foi aposentado — o fluxo real está em `staff-withdrawals.spec.ts`.

## Armadilha do e2e (pedido da task)

O dev-login com id por rodada saiu de `wallet.spec.ts` para `e2e/session.ts`, compartilhado pelas duas
specs. Além do id, os **nicks** desta spec também levam o sufixo da rodada: a fila da staff é global e
desktop/mobile rodam em paralelo no mesmo banco, então nick repetido fazia a linha de um projeto
aparecer na busca do outro.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fila de saques da staff ligada na API real e fim dos dados de demonstração no painel. Aprovar, recusar com motivo e marcar a entrega com nota (Q11) agora passam pelo serviço de saque; aprovar debita no ledger e recusar libera a reserva (Q25), sempre com o ator vindo da sessão. Cada pedido mostra quem pediu, quanto, quando e o saldo do membro naquele momento — GET /api/withdrawals ganhou um bloco 'balances' com o saldo de cada dono que já está na lista, sem expor ninguém novo. O contador do menu e a tela leem o mesmo provider, então nunca divergem. Concorrência é visível: quando outro staff já decidiu, o 409 da API vira toast com a frase dela e a lista recarrega, em vez de fingir sucesso. apps/web/src/mock/ foi removido por completo (5 arquivos + StoreProvider + entrada de coverage). Verificado com 5 cenários e2e em desktop 1280 e mobile 400 (incluindo o conflito entre dois staff, os estados vazio/erro e o membro comum que leva 403 em tudo), 3 testes HTTP novos e screenshots revisados pelo agent — que pegaram e corrigiram um bug de layout no 1280 e um bug real na query de saldo em lote. security-review sem achado com confiança >= 8. Gate: lint 0, typecheck ok, coverage 89.1%, imagem Docker ok, 0 vulnerabilidade; e2e 72/72 quando a suíte roda isolada.
<!-- SECTION:FINAL_SUMMARY:END -->
