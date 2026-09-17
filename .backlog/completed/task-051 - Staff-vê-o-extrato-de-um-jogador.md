---
id: TASK-051
title: Staff vê o extrato de um jogador
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 02:19'
updated_date: '2026-09-17 04:25'
labels:
  - admin
  - web
  - economy
dependencies: []
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff e admin conseguem abrir o ledger de um jogador específico a partir da lista de membros: saldo disponível, reservado e o extrato com origem, data, valor, autor e motivo de cada lançamento. Leitura apenas — ajuste de prata só existe no namespace de manutenção (TASK-048). Serve para responder 'cadê minha prata' sem abrir o banco.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff e admin leem o extrato de qualquer jogador a partir da lista de membros
- [x] #2 Extrato mostra origem, data, valor, autor e motivo, com paginação
- [x] #3 Membro comum não lê extrato alheio (API e UI)
- [x] #4 Valores em PT-BR; nenhum valor passa por number
- [x] #5 security-review sem achados críticos
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
1. packages/db: listLedgerEntriesWithAuthor(userId, keyset) — mesmo keyset de listLedgerEntries, com leftJoin users em created_by para o nome do autor (memberNick).
2. packages/shared: MemberLedgerEntryDto = LedgerEntryDto + author {id,name}|null; reaproveita encodeLedgerCursor/parseLedgerPageQuery/LEDGER_ENTRY_KIND_LABELS.
3. apps/server: MemberLedgerController GET /api/admin/members/:userId/ledger — saldo (getWithdrawalBalance, reserva = só pending) + extrato paginado. Permissão: @Authorize('read','Wallet') no tipo + checagem de condição no handler com asSubject('Wallet',{userId: alvo}) — member e caller têm a regra condicionada ao próprio id e levam 403; staff/admin têm read Wallet sem condição. Prata sai string.
4. apps/web: extrai a tabela de extrato do Wallet.tsx para components/ledger.tsx (kindMeta + LedgerTable) e reusa nos dois; novo MemberLedgerDialog aberto pela linha de AdminMembers (ação 'Ver extrato'), com saldo/reservado/disponível, coluna Autor+motivo, 'Carregar mais' por cursor, estados vazio/carregando/erro. BigInt na borda.
5. Testes: http test do controller (staff/admin 200, member/caller/estranho 403, paginação, autor, manual/maintenance), unit do repo, e2e admin-members-ledger.spec.ts com screenshots 1280/400.
6. security-review + task-done-check + pnpm quality.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (pnpm quality completo, porta e2e 4197)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 88.99% | ≥ 79% | ✅ |
| E2E + screenshots (desktop/mobile) | 100 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.75% | ≤ 15% | ✅ |
| Dead code | 6 (todos exports pré-existentes de shadcn/ui) | advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

Resultado: **Passou com avisos** — nenhum item bloqueante.

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| AC#1 Staff e admin leem o extrato de qualquer jogador a partir da lista de membros | e2e `member-ledger.spec.ts` "staff abre o extrato de um jogador pela lista de membros…" (desktop+mobile); http test "staff lê o extrato de qualquer jogador…" e "admin também lê"; screenshot `extrato-do-jogador` 1280 e 400 | ✅ |
| AC#2 Extrato mostra origem, data, valor, autor e motivo, com paginação | http test valida `author`, `kind`, `referenceType/Id`, `memo`, `createdAt` e o keyset ("pagina por cursor sem repetir nem pular"); e2e "paginação: carrega mais…" (25 → 30, sem trocar o que já estava); screenshots mostram as colunas Data/Lançamento/Origem/Autor/Valor | ✅ |
| AC#3 Membro comum não lê extrato alheio (API e UI) | http tests "membro comum pedindo extrato alheio é 403", "caller pedindo extrato alheio também é 403" (regressão da TASK-027) e "sem sessão é 401"; e2e "membro comum não lê extrato alheio": sem a tela (Acesso negado) e 403 na API, sem vazar um dígito; screenshot `extrato-membro-sem-acesso` | ✅ |
| AC#4 Valores em PT-BR; nenhum valor passa por number | http test afirma `typeof amount === 'string'` na API; `BigInt()` na borda em `api/member-ledger.ts`; grep no diff sem `Number(`/`parseFloat` sobre prata; e2e confere 2.600.000 e −50.000 formatados; screenshots | ✅ |
| AC#5 security-review sem achados críticos | security-review sobre o diff da branch: **nenhum achado** (HIGH/MEDIUM). Traçou o caminho de autorização por papel e verificou SQLi (drizzle com bind), IDOR pelo cursor (ANDado com userId), conteúdo da resposta e ausência de caminho de escrita | ✅ |

## Decisão de segurança (o ponto sensível da task)

O guard `Authorize(action, subject)` só checa por **tipo**. Member e caller também têm `read Wallet`, mas **condicionada ao próprio id** — gatear só pelo tipo repetiria o vazamento da TASK-027. Por isso o handler refaz a pergunta com a condição: `ability.can('read', asSubject('Wallet', { userId: alvo }))`. Alvo vem da rota, ator sempre da sessão. Staff e admin passam (regra sem condição / `manage all`); member e caller levam 403, provado por teste.

Observação do security-review, abaixo do limiar de achado: um membro que chame a rota com o **próprio** id vê o `author` dos lançamentos, que `/api/me/ledger` não expõe. É o próprio dado dele e não vaza nada de terceiro; mantido assim. Se a intenção de produto for que autoria seja só da staff, é um ajuste de uma linha.

## Decisões de produto conferidas (doc-005)
- **G10**: staff e admin leem o extrato de qualquer jogador; ajuste de prata só pelo namespace de manutenção — a tela não tem nenhum caminho de escrita no ledger.
- **G5**: o ajuste da manutenção aparece com origem `manual/maintenance`, motivo e sem autor, rotulado como "Ajuste da manutenção" / autor "Manutenção" — provado por e2e contra o namespace real, não por mock.
- **Q25**: reserva conta só saque `pending` (`RESERVING_WITHDRAWAL_STATUSES`); `approved` já debitou no ledger. Teste http dedicado.
- **Q20**: prata em string na API, bigint na borda do painel.
- **G13**: a janela mostra disponível **e** reservado (mais o saldo total).

## Visual (DoD#4)
Screenshots desktop 1280 e mobile 400 revisadas pelo agent nesta task, em três estados: extrato com lançamentos, extrato vazio e membro sem acesso. Duas correções vieram dessa revisão: o motivo do lançamento passou a quebrar em duas linhas em vez de cortar (é a linha que alguém vai questionar) e a dica de "Reservado" encurtou para caber em 400px.

## Reuso
A tabela do extrato saiu de `Wallet.tsx` para `components/ledger.tsx` e agora é **uma só** para a carteira do membro e para o extrato da staff — a diferença é a coluna Autor. A paginação, o cursor e os rótulos PT-BR são os mesmos da TASK-031.

## Skills
Skills: emil-design-eng, frontend-design, ask-sonner, security-review, task-done-check.
`ask-sonner` levou à decisão de **não** usar toast: erro de carregamento nesta janela é inline com "Tentar de novo", porque toast some e é justamente aqui que a pessoa fica lendo. Toast continua sendo para resultado de ação (import, conferir nick), como o resto da tela já faz.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Staff e admin abrem o extrato de qualquer jogador pela lista de membros: saldo disponível, reservado e total, e cada lançamento com data, origem, autor, motivo e valor, paginado por cursor. Leitura apenas — ajuste de prata continua só no namespace de manutenção (G5), e o ajuste feito por lá aparece rotulado como 'Ajuste da manutenção' com o motivo. A permissão é a parte sensível: o guard só checa por tipo e member/caller também têm 'read Wallet' condicionada ao próprio id, então o handler refaz a pergunta com a condição (asSubject Wallet userId), o que fecha a classe de erro da TASK-027; member e caller levam 403, provado por teste http e por e2e. A tabela do extrato passou a ser uma só, compartilhada com a carteira do membro. Verificado com pnpm quality completo (lint 0, typecheck ok, cobertura 88.99%, 100 e2e, Docker smoke ok), security-review sem achados, e screenshots desktop 1280 e mobile 400 revisadas em três estados.
<!-- SECTION:FINAL_SUMMARY:END -->
