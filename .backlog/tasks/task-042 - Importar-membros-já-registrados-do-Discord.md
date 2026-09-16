---
id: TASK-042
title: Importar membros já registrados do Discord
status: In Progress
assignee: []
created_date: '2026-09-16 03:53'
updated_date: '2026-09-16 12:39'
labels:
  - bot
  - backend
dependencies: []
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O servidor já tem 24 membros com o cargo Membro e apelido in-game definido (muitos com tag de guilda, ex: '[GENEI] Erijj'). Importar essas contas evita pedir /registrar a quem já está regularizado. Import idempotente disparado por admin, sem tocar em quem já tem conta.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admin dispara a importação (comando do bot ou painel) e recebe resumo: criados, atualizados, ignorados, conflitos
- [x] #2 Cada membro com cargo Membro vira conta com papel member e nick aprovado derivado do apelido do Discord
- [x] #3 Tag de guilda no apelido (ex: '[GENEI] ') é removida antes de virar nick; nick inválido entra em conflitos sem quebrar a importação
- [x] #4 Reexecutar não duplica conta nem sobrescreve nick já aprovado no painel
- [x] #5 Membro sem apelido ou sem cargo Membro é ignorado e listado no resumo
- [x] #6 Apelido é separado em tag de guilda (opcional) e nick; ambos ficam guardados
- [x] #7 Nick importado é validado na API do Albion (região configurada) e o resultado fica registrado com data
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared: parseDiscordNickname (tag [GENEI] + nick) com testes dos exemplos reais.
2. db: migration aditiva users.guild_tag + albion_status/player_id/guild_name/checked_at; repo importDiscordMember (1 tx por membro, COALESCE no nick) e setAlbionCheck; testes de integração.
3. server: domain/member-import (planMemberImport + resumo PT-BR), gateway REST GET /guilds/{id}/members atrás de porta injetável, DiscordMemberImportService (idempotente, lookup Albion por nick único).
4. bot: /importar-membros restrito a admin (CASL manage all) com resposta efêmera.
5. Testes: parsing, repo, serviço com fakes + Postgres real, comando recusando não-admin, gateway com fake REST.
6. security-review, quality gate, notas e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisões (TASK-042)

**Tag de guilda mantida (decisão do usuário 2026-09-16).** `parseDiscordNickname` separa `[GENEI] Erijj` em `{ guildTag: 'GENEI', nick: 'Erijj' }` e ambos ficam gravados (`users.guild_tag`, `users.game_nick`). Só `[...]` **no início** conta como tag: `(TAG)`, `「TAG」` e `-TAG-` ficam no nick, que então falha a validação do Q14 e vira conflito — melhor recusar do que gravar nick errado. Espaços repetidos/NBSP são normalizados antes de separar.

**Validação no Albion persistida (AC#7).** Colunas novas em `users`: `albion_status` (found/not_found/unavailable), `albion_player_id`, `albion_guild_name`, `albion_checked_at`. Usa o `ALBION_PLAYER_LOOKUP` já cacheado da TASK-016, **uma consulta por nick único**. `unavailable` e `disabled` **não são conflito**: o membro entra igual e a staff revê pelo `albion_checked_at`. `disabled` (ALBION_REGION vazia) não grava nada.

**Gatilho: só o comando do bot nesta task.** `POST /api/admin/members/import` **não** foi implementado. Motivo: a regra toda está no `DiscordMemberImportService`, que o BotModule já exporta; a TASK-043 (listagem de membros no painel) adiciona o controller admin-only junto com a UI e os testes HTTP dela, sem duplicar regra. Nada nesta task precisa do endpoint.

**Leitura da guild por REST atrás de porta injetável.** `DiscordGuildMembersGateway` (`GET /guilds/{id}/members?limit=1000`, paginado por `after`), implementação `DiscordJsGuildMembersGateway` usa `client.rest`; testes usam fake — nenhum teste chama Discord ou Albion de verdade.

**Manual no Discord (operacional).** O endpoint de listar membros exige o **Server Members Intent** (privileged): Discord Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent = ON. Sem isso o Discord responde 403 e o `/importar-membros` já responde ao admin exatamente com essa instrução. O bot **não** liga o intent no gateway (só usa a leitura pontual do REST). Além disso: rodar `/importar-membros` uma vez com um admin do painel (BOOTSTRAP_ADMIN_DISCORD_IDS) depois do deploy.

**Segurança.** `/importar-membros` resolve quem chamou por `interaction.user.id` → usuário do painel → papéis → CASL `can('manage','all')` (só admin, Q13), mesmo padrão do `/evento`; staff e caller são recusados. Resposta sempre efêmera. O import concede **apenas** o papel `member` (sem escalada) e nunca sobrescreve nick já aprovado no painel.

## Quality gate (local, commit c736c86)

| Métrica | Resultado | Threshold | Bloqueia | Status |
|---|---|---|---|---|
| Linting | 0 issue(s) | 0 | sim | ✅ |
| Race conditions | 0 detectada(s) | 0 | sim | ✅ |
| Typecheck | ok | 0 erros | sim | ✅ |
| Testes + coverage (branch) | 93.36% | ≥ 79% | sim | ✅ |
| E2E + screenshots | 33 ok, 7 falha(s) | 0 falhas | sim | ❌ (ver abaixo) |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | sim | ✅ |
| Duplicação | 1.14% | ≤ 15% | não | ✅ |
| Dead code | 7 item(s) (todos pré-existentes em apps/web/src/components/ui) | 0 (advisory) | não | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | sim | ✅ |

**E2E: falha pré-existente do ambiente local, não regressão desta branch.** Todas as falhas são `Test timeout of 30000ms` com `element was detached from the DOM, retrying` (re-render do painel), e o conjunto de specs que falha muda a cada execução (7 numa rodada, 9 na seguinte). Controle decisivo: com o worktree em `git switch --detach origin/main` (sem nenhuma mudança desta task), `e2e/nick.spec.ts` falha exatamente igual (4 falhas, desktop + mobile). Esta branch **não altera nenhum arquivo de `apps/web` nem de `e2e/`** (`git diff origin/main --name-only -- e2e apps/web` = vazio) e a imagem Docker sobe e responde. O CI (runner limpo) é a autoridade sobre o e2e.

## AC → evidência

| AC | Evidência | Status |
|---|---|---|
| #1 admin dispara e recebe resumo (criados/atualizados/ignorados/conflitos) | `apps/server/src/bot/import-members.command.test.ts` ("admin importa e recebe o resumo efêmero") + `apps/server/src/domain/member-import.test.ts` ("mostra os quatro números do resumo") | ✅ |
| #2 membro com cargo Membro vira conta com papel member e nick aprovado | `discord-member-import.service.test.ts` ("cria conta com nick sem tag, guarda a tag e concede o cargo member") + `member-import.integration.test.ts` ("cria a conta com nick, tag de guilda e papel member") | ✅ |
| #3 tag removida do nick; nick inválido vira conflito sem quebrar | `packages/shared/src/discord-nickname.test.ts` (18 casos, inclui `[GENEI] Erijj`) + service test ("apelido que não vira nick entra em conflitos sem quebrar o import") | ✅ |
| #4 reexecutar não duplica nem sobrescreve nick aprovado | service test ("reexecutar não duplica conta e conta como ignorado", "não sobrescreve nick já aprovado no painel") + repo test ("reexecutar não duplica conta nem muda nada", "nunca sobrescreve nick já aprovado no painel") | ✅ |
| #5 sem apelido ou sem cargo Membro é ignorado e listado | service test ("ignora bot, quem não tem o cargo Membro e quem não tem apelido": skipped=3, nenhuma conta criada) + domain test dos motivos | ✅ |
| #6 tag e nick ambos guardados | repo test (`guild_tag='GENEI'`, `game_nick='Erijj'`) + migration 0009 | ✅ |
| #7 nick validado no Albion e resultado registrado com data | service test ("grava a conferência do Albion por nick único": found/not_found + `albion_checked_at`), ("Albion indisponível não é conflito"), ("consulta desligada não grava conferência nenhuma") + repo test ("grava a conferência do Albion com data") | ✅ |

Testes desta task: 18 (parsing) + 8 (repo/Postgres real) + 11 (serviço/Postgres real + fakes) + 12 (comando/Postgres real) + 5 (gateway REST com fake) + 11 (domínio puro). Nenhum chama Discord ou Albion de verdade.

## Skills
Skills: `security-review` (checklist manual sobre o diff — a skill enxergou diff vazio porque rodou o git no checkout principal, não no worktree), `task-done-check` (gate + escopo + AC→evidência; passo visual/Playwright **N/A**: a task não altera UI). Não se aplicam: `emil-design-eng`, `frontend-design`, `animate`, `ask-sonner`, `prototype`, `revenue-centric-design`, `marclou-review` (nenhuma mudança de UI, copy de painel ou escopo de produto).

Security review (manual, sobre `git diff origin/main`): sem achado alto ou médio. Conferido: (a) todo SQL é parametrizado pelo Drizzle, o único `sql.raw` está em testes e monta nome de banco a partir de `TEST_DATABASE_URL`; (b) autorização do comando é admin-only via CASL (`manage all`) sobre o `interaction.user.id`, staff/caller/member recusados por teste; (c) sem SSRF: a URL da REST vem de `Routes.guildMembers(GUILD_ID)` com id de env; (d) o import concede **só** o papel `member` (sem escalada) e nunca sobrescreve nick aprovado; (e) respostas sempre efêmeras e a falha genérica não vaza detalhe do erro (teste cobre); (f) dados do Albion (playerId/guildName) entram só como texto parametrizado.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Importa para o painel os membros já regularizados no Discord: `parseDiscordNickname` separa `[GENEI] Erijj` em tag de guilda + nick (packages/shared), migration aditiva 0009 grava `users.guild_tag` e a conferência do Albion (`albion_status`/`albion_player_id`/`albion_guild_name`/`albion_checked_at`), `importDiscordMember` faz uma transação por membro que nunca sobrescreve nick já aprovado, e o `DiscordMemberImportService` roda o import idempotente com o lookup cacheado da TASK-016 (um por nick único; indisponível não é conflito). Gatilho: `/importar-membros`, admin-only por CASL (`manage all`), resposta efêmera com criados/atualizados/ignorados/conflitos; a lista da guild vem de `GET /guilds/{id}/members` atrás de gateway injetável. Verificado com 65 testes novos (parsing puro, repo e serviço contra Postgres real, comando recusando staff/caller/member, gateway com REST falsa) e quality gate local verde em lint, typecheck, coverage 93.36%, imagem Docker, duplicação e audit; o e2e que falha é pré-existente (reproduzido igual em origin/main sem as mudanças desta task) e esta branch não toca apps/web nem e2e/.
<!-- SECTION:FINAL_SUMMARY:END -->
