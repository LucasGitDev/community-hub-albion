---
id: TASK-053
title: Banimento de jogador no painel
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 02:23'
updated_date: '2026-09-17 03:21'
labels:
  - backend
  - frontend
  - security
dependencies: []
priority: high
type: feature
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff e admin podem banir um jogador pelo painel (lista de membros do admin), com motivo obrigatório. O banimento corta o acesso na hora, remove o cargo Membro no Discord, recusa inscrição em evento (embed e painel) e congela o saldo. É soft delete: a conta continua na lista marcada como banida, com motivo, autor e data, e pode ser desbanida restaurando o acesso.

Fora de escopo (decisão do usuário): kick/ban no servidor do Discord — continua sendo feito manualmente no Discord. Nick continua ocupado. Ledger intacto, sem estorno automático.

Origem: grelha de decisões de 2026-09-16 (G9). Relacionado a doc-005 Q13 (papéis), Q24/Q25 (saque e saldo), Q31 (cargo Membro).

Nota: o pedido original referenciava TASK-050, que não existe no backlog; a task foi criada como TASK-053.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff ou admin bane um membro pela lista de membros do admin informando motivo; motivo em branco é recusado pela API (400) e pela UI
- [x] #2 Membro e caller recebem 403 ao tentar banir ou desbanir
- [x] #3 Ninguém pode banir a si mesmo; a API recusa com 400 e a UI não oferece a ação na própria linha
- [x] #4 Banir o último admin ativo é recusado (mesma proteção de revokeRoleGuarded)
- [x] #5 Ao banir, todas as sessões do usuário são revogadas na hora: a próxima requisição autenticada dele responde 401
- [x] #6 Banido não consegue logar de novo: o login por Discord OAuth recusa e mostra motivo do banimento
- [x] #7 Ao banir, o cargo Membro é removido no Discord; o usuário NÃO é expulso nem banido da guild
- [x] #8 Banido não consegue se inscrever em evento pelo embed do bot (mensagem efêmera) nem pelo painel (403)
- [x] #9 Banido não consegue pedir saque (403) e saque pendente dele não pode ser aprovado enquanto o banimento durar (409/400 com motivo claro)
- [x] #10 Saldo e ledger do banido ficam intactos: nenhum lançamento novo é criado ao banir ou desbanir
- [x] #11 A conta banida continua listada na lista de membros com selo de banido, motivo, autor e data; o nick continua ocupado (não pode ser registrado por outra pessoa)
- [x] #12 Desbanir por staff/admin restaura o acesso: o usuário volta a logar, inscrever-se e pedir saque
- [x] #13 A UI de banimento deixa explícito o que acontece (acesso cortado, cargo Membro removido, saldo congelado) e o que não acontece (não sai do Discord, saldo não some), e exige confirmação com o motivo digitado
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
1. shared: acao `ban` + subject `Ban` em permissions.ts (staff/admin manage Ban); DTOs e zod (`banUserSchema` com motivo obrigatorio 5..500).
2. db: colunas aditivas em `users` (`banned_at`, `banned_by`, `ban_reason`) + migration 0016; repo `admin-bans-repo.ts` com `banUserGuarded` (tx + FOR UPDATE nas linhas de admin, recusa auto-ban e ultimo admin, apaga todas as sessoes do usuario) e `unbanUser`.
3. auth: `AuthorizeGuard` recusa 403 quando `user.bannedAt`; callback do Discord OAuth recusa login de banido antes de criar sessao (`loginErrorPath`).
4. eventos: `EventSignupsService.join` recusa banido (cobre painel e bot); `event-signup.interactions.authorize` checa banimento antes de `ensureFromDiscord` (nao cria conta pra banido) e responde efemera.
5. economia: pedido de saque recusado pra banido; aprovacao de saque pendente de banido recusada (409) — ledger intacto, sem estorno.
6. discord: `removeRole` no `DiscordGuildGateway` + impl; ao banir remove o cargo Membro. Nao expulsa nem bane da guild.
7. web: acao Banir/Desbanir na lista de membros do admin (AdminMembers), dialogo destrutivo com motivo digitado obrigatorio, lista do que acontece e do que NAO acontece, selo de banido + motivo/autor/data na linha; toasts via sonner.
8. testes: unit no repo e no dominio, http tests dos endpoints, e2e do fluxo banir/desbanir com screenshots 1280 e 400.
9. security-review, pnpm quality completo, task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, commit 94d65163)
Passou com avisos: lint 0, race conditions 0, typecheck ok, coverage branch **89,95%** (>= 79%),
e2e **92 ok / 0 falhas** (desktop 1280 + mobile 400, porta 4194), imagem Docker build + smoke ok,
duplicação 1,74%, `pnpm audit --prod` 0 high/critical. Aviso: 6 itens de dead code, todos exports
de componentes shadcn pré-existentes (button/dialog/table/tabs), nenhum deste diff.

## AC -> evidência
| AC | Evidência | Status |
|---|---|---|
| 1 staff/admin banem com motivo obrigatório | `member-ban.http.test.ts` "sem sessão 401..." e "motivo é obrigatório"; `ban.test.ts`; e2e "admin bane com motivo" (botão desligado sem motivo válido) | ok |
| 2 member e caller 403 | `member-ban.http.test.ts`; e2e "member e caller não veem a tela nem passam pela API" | ok |
| 3 ninguém bane a si mesmo | `bans.integration.test.ts` "banir a si mesmo"; e2e "ninguém bane a si mesmo" (ação some na própria linha, API 400) | ok |
| 4 último admin protegido | `bans.integration.test.ts` "o último admin ativo..." + "dois banimentos simultâneos"; `member-ban.http.test.ts` 409 | ok |
| 5 sessões revogadas na hora | `bans.integration.test.ts` (2 sessões apagadas na mesma transação); `member-ban.http.test.ts` (`/auth/me` 200 -> 401); e2e | ok |
| 6 banido não loga | `auth.http.test.ts` "banido é recusado no login com código banido"; `dev-login` 403 no e2e | ok |
| 7 cargo Membro removido, sem kick/ban de guild | `member-ban.service.test.ts` (só `removeRole`, e a porta não expõe kick/ban); `discord-guild.gateway.test.ts` "removeRole tira o cargo... sem expulsar" | ok |
| 8 sem inscrição em evento (embed e painel) | `event-signup.interactions.test.ts` (recusa pelo snowflake, antes de criar conta); `event-signups.http.test.ts` "banido não se inscreve em evento pelo painel" | ok |
| 9 saque: pedido recusado e pendente não aprovável | `member-ban.http.test.ts` "saldo congelado..." (409 na aprovação, 401 no pedido novo); e2e "banido perde o acesso..." | ok |
| 10 ledger intacto | `bans.integration.test.ts` "não mexe no ledger"; saldo idêntico antes/depois no http test | ok |
| 11 conta continua listada, nick ocupado | `member-ban.http.test.ts` (linha na lista com motivo/autor; PATCH do nick do banido por outro = 409); `bans.integration.test.ts` (filtro banidos) | ok |
| 12 desbanir restaura o acesso | `member-ban.http.test.ts` "banir de novo é 409..."; e2e (desbanir -> aprovação do saque volta a 200) | ok |
| 13 UI explica e exige o motivo digitado | e2e "admin bane com motivo" confere as duas listas; screenshots `ban-dialogo` 1280/400; teclado + Esc | ok |

## DoD
1 gate sem falha bloqueante (resumo acima). 2 cada AC com evidência objetiva. 3 skills listadas abaixo.
4 e2e `e2e/member-ban.spec.ts` (12 cenários, desktop 1280 + mobile 400) com `snap()` em 9 estados,
todos lidos pelo agent: hierarquia ok, estado banido com ícone + texto + borda (não só cor), sem
overflow horizontal da página, console sem erro, foco por teclado e Esc, copy PT-BR.
5 doc-005: Q13 (papéis), Q24/Q25 (reserva e ledger), Q31 (cargo Membro). Sem escopo extra.
6 `security-review` rodado: 1 ALTO, 1 MÉDIO e 1 BAIXO, todos corrigidos no commit `fix(security)`.
7/8 commits Conventional atômicos sem co-autor; PR aberto.

## security-review
- ALTO (corrigido): a guarda do último admin travava `user_roles`, mas o predicado protegido é
  `users.banned_at` — dois banimentos simultâneos podiam zerar os admins. Lock passou a incluir `users`.
- MÉDIO (corrigido): staff podia banir staff e admin e neutralizar quem reagiria. Agora só admin bane
  staff/admin (`protected_target` -> 403), com a ação escondida na UI também.
- BAIXO (corrigido): checagem de banimento na aprovação de saque estava fora da transação; passou para
  dentro de `approveWithdrawal`, com a linha do dono já travada.
- Verificado sem achado: widening do `GET /admin/members` (member e caller seguem 403, nenhuma escrita
  de admin mudou), ausência de caminho alternativo de desbanimento, SQL injection, IDOR, exposição de dados.

Skills: emil-design-eng, frontend-design, ask-sonner, marclou-review, security-review, task-done-check.
<!-- SECTION:NOTES:END -->
