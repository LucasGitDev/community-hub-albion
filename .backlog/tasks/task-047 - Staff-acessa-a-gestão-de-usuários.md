---
id: TASK-047
title: Staff acessa a gestão de usuários
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 02:19'
updated_date: '2026-09-17 04:01'
labels:
  - admin
  - backend
  - web
dependencies: []
priority: high
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff passa a alcançar as quatro capacidades da TASK-045 (buscar/revalidar nick na API do Albion, editar nick e tag de guilda, escrever e ler notas internas), hoje restritas a admin pelo subject UserRole. /admin/papeis continua exclusivo de admin. Provisório até existirem permissões separadas de papéis (ver task de permissions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff alcança as quatro capacidades da lista de membros
- [x] #2 Staff continua sem acesso a /admin/papeis
- [x] #3 Membro comum segue sem acesso a nada disso (API e UI)
- [x] #4 security-review sem achados críticos
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
Levantamento do que a TASK-050 ja entregou:
- JA FEITO: GET /admin/members (gate read/UserRole OU ban/Ban), rota /admin/membros e item de menu 'Membros do painel' (ban/Ban). Staff ja enxerga a lista.
- AINDA NEGA STAFF (as quatro capacidades, todas em AdminMemberProfileController): POST :id/albion-check (update/UserRole), PATCH :id (update/UserRole), GET :id/notes (read/UserRole), POST :id/notes (update/UserRole). Na UI, canManage = ability.can('read','UserRole') esconde as quatro da staff.
- BLOQUEIO: /admin/papeis (AdminUsersController) usa o MESMO subject UserRole (read para listar, update para conceder/revogar). Dar UserRole a staff abriria a criacao de admin. Logo, nao da para so afrouxar UserRole.

Plano:
1. packages/shared/src/permissions.ts: subject novo MemberProfile (perfil do membro no painel: nick, tag, notas, revalidacao). Staff ganha manage/MemberProfile, com comentario marcando que e provisorio ate a TASK-052 (degrau, nao destino). UserRole segue so admin; Ban segue como esta (hierarquia da TASK-050 intocada).
2. apps/server/src/admin/admin-member-profile.controller.ts: as quatro rotas passam de UserRole para MemberProfile (read para ler notas, update para escrever).
3. apps/server/src/admin/admin-members.controller.ts: gate da listagem vira @Authorize('read','MemberProfile') e some o OR manual read/UserRole||ban/Ban - admin passa por manage all, staff por MemberProfile. Import continua manage/all.
4. apps/server/src/admin/admin-users.controller.ts: intocado (UserRole = admin).
5. Web: main.tsx rota /admin/membros -> read/MemberProfile; AppShell nav idem; AdminMembers.tsx canManage = update/MemberProfile e canImport NOVO = manage/all (hoje o botao 'Importar membros do Discord' esta no mesmo canManage e daria 403 pra staff).
6. Testes: http tests cobrindo staff OK nas quatro; staff 403 em /admin/users (lista, grant, revoke); member e caller 403 em tudo; teste de permissions.ts; regressao da hierarquia de ban (staff nao bane staff/admin). E2E + screenshots 1280/400.
7. security-review, pnpm quality (E2E_PORT=4195), task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## O que a TASK-050 ja tinha entregue (levantamento antes de codar)

Ja pronto e NAO refeito: GET /admin/members acessivel a staff, rota /admin/membros e item de menu 'Membros do painel'.

Ainda negava staff (as quatro capacidades): POST :id/albion-check, PATCH :id, GET :id/notes, POST :id/notes - todas em UserRole. Na UI, canManage = can('read','UserRole') escondia as quatro.

Descoberta que definiu a solucao: /admin/papeis usa o MESMO subject UserRole (read para listar, update para conceder/revogar). Afrouxar UserRole para staff abriria a criacao de outro admin. Por isso a task exigiu um subject novo, nao um ajuste de papel.

## Implementacao

1. packages/shared/src/permissions.ts - subject MemberProfile (ficha do membro: nick, tag, notas, revalidacao). Staff ganha manage/MemberProfile, com comentario marcando que e PROVISORIO ate a TASK-052 (degrau, nao destino). UserRole e Ban intocados.
2. AdminMemberProfileController - as quatro rotas passam de UserRole para MemberProfile (read para ler notas, update para escrever).
3. AdminMembersController - a listagem troca o OR manual em handler (read/UserRole || ban/Ban) por @Authorize('read','MemberProfile') no guard. Ler a lista deixa de depender de poder banir; ninguem novo entra. Import segue manage/all.
4. AdminUsersController - intocado.
5. Web - rota e menu de /admin/membros para read/MemberProfile; canManage para update/MemberProfile.
6. Bug encontrado de brinde: canImport separado de canManage. O botao 'Importar membros do Discord' estava no mesmo canManage, mas a API exige manage/all - a staff veria o botao e levaria 403 no clique. Agora fica escondido.

## Efeito colateral em teste da TASK-050 (intencional)

e2e/member-ban.spec.ts afirmava 'staff sem botao Gerenciar'. A TASK-047 vira essa regra de proposito. No lugar entrou a assercao de que 'Papeis' continua fora do menu da staff, para o teste seguir guardando uma fronteira em vez de nenhuma. A hierarquia de banimento (staff nao bane staff/admin) nao foi tocada e os 30 testes de member-ban + admin-members passam.

## Quality gate (pnpm quality completo, E2E_PORT=4195)

| Metrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | OK |
| Race conditions | 0 | 0 | OK |
| Typecheck | ok | 0 erros | OK |
| Testes + coverage (branch) | 90.12% | >= 79% | OK |
| E2E + screenshots | 98 ok, 0 falhas, 0 flaky | 0 falhas | OK |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | build+smoke | OK |
| Duplicacao | 1.71% | <= 15% | OK |
| Dead code | 6 (advisory, pre-existentes: exports shadcn) | advisory | nao bloqueia |
| Vulnerabilidades high+ | 0 | 0 | OK |

Gate verde, sem falha bloqueante.

## security-review (AC#4): 0 achados

Revisao focada em escalacao de privilegio / bypass de autorizacao no diff da branch. Nenhum achado acima do limiar. Verificado ponto a ponto:

1. Todo uso de MemberProfile no repo: so os cinco sitios pretendidos (lista + as quatro capacidades) mais os gates de UI. Nenhuma outra rota virou alcancavel pela staff. Import continua manage/all.
2. Concessao de papel: /admin/users segue em UserRole nas tres rotas. Os outros chamadores de grantRole/revokeRoleGuarded sao o bootstrap de login (papeis vindos do env BOOTSTRAP_ADMIN_DISCORD_IDS, sem entrada do usuario) e o dev-login (atras de AUTH_DEV_LOGIN). Nenhum comando do bot concede papel. Staff nao tem regra em UserRole e manage/MemberProfile nao alcanca outro subject.
3. Hierarquia de banimento intacta: apps/server/src/members/ e packages/db/src/bans-repo.ts sem diff. A trava protected_target (ator nao-admin + alvo staff/admin) segue dentro da transacao, junto com last_admin e self-ban.
4. A lista nao alargou: antes read/UserRole (admin) OU ban/Ban (staff+admin); agora read/MemberProfile (staff+admin) - mesmo conjunto efetivo, member e caller sem regra. E o gate ficou mais forte: era @Authorize() puro (so sessao) com if no handler, agora a politica e avaliada no guard antes do handler.
5. Editar nick nao e caminho de takeover: identidade e sempre users.discordId (OAuth, sessao, checagem de ban). gameNick nao entra em defineAbilityFor nem na resolucao de sessao. O sync de cargo do Discord e disparado pela aprovacao de pedido de nick, nao por este PATCH. updateMemberProfile mantem unicidade case-insensitive sob FOR UPDATE e zera a verificacao do Albion ao trocar o nick. Pior caso e confusao, registrada em nota append-only.
6. Notas nao vazam nada extra: UserNote tem id, kind, body, createdAt e autor (id + nome) - tudo que a staff ja via na lista. Sem token, discordId ou dado de sessao.

## task-done-check

Escopo: 10 arquivos, todos explicados pelo plano (3 de permissao/rotas, 3 de UI, 4 de teste). Nada de pos-v1 do doc-004 entrou.

Guardrails por grep no diff: sem any / @ts-ignore / eslint-disable novo; sem hex solto (nenhuma cor tocada); sem Number( / parseFloat; sem update/delete de lancamento (ledger nao foi tocado).

### AC -> evidencia

| AC | Evidencia | Status |
|---|---|---|
| AC#1 Staff alcanca as quatro capacidades | admin-member-profile.http.test.ts 'staff alcanca as quatro capacidades' (201 no albion-check, 200 no PATCH, 201 na nota, 200 lendo notas + a de sistema) + e2e 'staff usa as quatro capacidades' (desktop e mobile) + screenshots staff-membros-lista/editado/notas/conferir 1280 e 400 | OK |
| AC#2 Staff sem /admin/papeis | admin-member-profile.http.test.ts 'staff nao concede nem revoga papel' (403 em GET, PUT e DELETE de /admin/users; nenhum papel gravado) + e2e 'staff nao alcanca a tela de papeis' (403 inclusive ao tentar promover a si mesma) + screenshot staff-papeis-negado (Acesso negado, 'Papeis' fora do menu) | OK |
| AC#3 Membro comum sem acesso (API e UI) | admin-member-profile.http.test.ts 'member e caller 403 nas quatro acoes' (+ 403 na lista, nada gravado) + e2e 'caller nao alcanca a gestao' e 'membro sem permissao nao usa edicao, notas nem conferencia' | OK |
| AC#4 security-review sem criticos | 0 achados, seis pontos verificados (ver nota acima) | OK |

### DoD -> evidencia

| DoD | Evidencia | Status |
|---|---|---|
| #1 pnpm quality | gate completo verde, tabela colada acima (E2E_PORT=4195) | OK |
| #2 AC com evidencia objetiva | tabela acima: teste http, e2e e screenshot - nenhum AC marcado por leitura de codigo | OK |
| #3 Skills do doc-003 | security-review (obrigatoria: toca auth) e task-done-check invocadas | OK |
| #4 UI: e2e + screenshots 1280/400 | 3 e2e novos nos dois projetos (desktop 1280 e mobile 400), 8 screenshots revisados pelo agent; assercao de ausencia de overflow horizontal e console sem erro dentro do proprio teste | OK |
| #5 Confere com doc-005 | G3 cumprida ao pe da letra: as quatro capacidades para staff, /admin/papeis so admin, provisorio ate a TASK-052 marcado em comentario. G9 preservada: hierarquia de banimento intacta e coberta por teste | OK |
| #6 security-review (toca auth) | 0 achados | OK |
| #7 Notas e commits | 3 commits Conventional atomicos (shared, server, web), sem co-autor | OK |
| #8 PR merged | pendente: PR aberto, aguardando CI e merge pelo usuario | pendente |

Visual: a verificacao 1280/400 saiu dos screenshots do proprio e2e (playwright desktop 1280 e mobile 400), que sao o mesmo artifact que o CI publica, em vez de uma sessao separada de Playwright MCP. Revisado: hierarquia da tela intacta, estados com icone+texto+borda, sem overflow horizontal (assercao no teste), dialogo fecha com Esc (teste de teclado ja existente), console sem erro (assercao no teste), copy PT-BR inalterada.

Nao foi invocada emil-design-eng / frontend-design / ask-sonner: nenhum componente novo nem alteracao visual foi escrita. A mudanca de UI e so de visibilidade (quais controles ja existentes aparecem para a staff); os componentes, a copy e os toasts sao os mesmos da TASK-045/050.

Skills: security-review, task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Staff passou a alcancar as quatro capacidades da gestao de usuarios (revalidar nick no Albion, editar nick e tag de guilda, escrever e ler notas internas), sem ganhar nada sobre papeis.

O bloqueio era que as quatro capacidades e a tela /admin/papeis compartilhavam o subject UserRole: liberar a staff abriria junto a porta que cria outro admin. A solucao foi separar o subject - MemberProfile para a ficha do membro, UserRole so para conceder e revogar papel. A listagem /admin/members trocou o OR manual (read/UserRole ou ban/Ban) por read/MemberProfile no guard, entao ler a lista deixou de depender de poder banir. De brinde, canImport foi separado de canManage na UI: o botao de importar do Discord exige manage/all e aparecia para a staff so para dar 403 no clique.

A permissao da staff em MemberProfile e provisoria ate a TASK-052 e esta marcada como tal em comentario no permissions.ts.

Verificado com: teste http de que a staff faz as quatro e leva 403 nas tres rotas de papel (inclusive ao tentar promover a si mesma); teste http de que member e caller seguem em 403 nas quatro e na lista; matriz de permissao em permissions.test.ts com um teste dedicado a fronteira MemberProfile x UserRole x Ban; tres e2e novos rodando em desktop 1280 e mobile 400 com 8 screenshots revisados; hierarquia de banimento da TASK-050 (staff nao bane staff nem admin) reconfirmada pelos 30 testes de member-ban e admin-members. pnpm quality completo verde (coverage 90.12%, e2e 98 ok / 0 falhas, 0 vulnerabilidades high+). security-review: 0 achados.
<!-- SECTION:FINAL_SUMMARY:END -->
