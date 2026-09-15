---
id: TASK-014
title: Bot aplica apelido e cargo Membro na aprovação
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:15'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-013
  - TASK-003
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Aprovado, o bot muda apelido no Discord e dá cargo Membro (Q31); troca de nick só altera apelido após aprovação.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Após aprovação, apelido no Discord passa a ser o nick aprovado
- [x] #2 Primeira aprovação concede o cargo Membro configurado
- [x] #3 Falha de permissão no Discord é registrada e não desfaz a aprovação
- [x] #4 Rejeição não altera apelido nem cargos
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
1. env DISCORD_MEMBER_ROLE_ID (snowflake, obrigatório com bot ligado) + .env.example/compose/smoke.
2. domain planDiscordMemberSync(event) puro → ações (setNickname, addRole) + describeDiscordError 10007/owner.
3. bot: DiscordGuildGateway (porta, impl discord.js) + DiscordMemberSync assina NickDecisionService.onDecided no init; erros logados sem lançar.
4. testes unit (plano, gateway, sync com fake) + integração Postgres (decisão intacta com gateway falhando).
5. quality, backlog notes, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, pós-rebase em origin/main, commit 8ae5a5e7): lint 0, race 0, typecheck ok, coverage branch 92.62% (>=79), e2e 28 ok/0 falha/0 flaky, imagem Docker build+smoke ok, duplicação 0%, dead code 0, vulns high+ 0.

Decisões:
- Env DISCORD_MEMBER_ROLE_ID (snowflake): obrigatória quando DISCORD_BOT_ENABLED=true (refine no zod + guarda em BotModule.register); opcional com bot desligado (smoke da imagem e e2e seguem sem ela). Adicionada em apps/server/.env.example, .env.example e docker-compose.yml (passthrough, default vazio → falha clara no boot com bot ligado).
- Regra pura apps/server/src/domain/member-sync.ts planMemberSync: recusa → nenhuma ação; aprovação → setNickname; previousGameNick null (primeira aprovação) → também addRole (Q31: troca posterior só apelido).
- Porta DiscordGuildGateway (apps/server/src/bot/discord-guild.gateway.ts; token DISCORD_GUILD_GATEWAY) com impl DiscordJsGuildGateway sobre o Client do Necord: guilds.fetch(GUILD_ID) → members.fetch(discordId) (REST, sem intent privilegiado) → setNickname/roles.add com audit reason. Dono da guild: Discord proíbe bot alterar apelido → erro GUILD_OWNER_NICKNAME sem chamar a API, logado com orientação de ajuste manual.
- DiscordMemberSync (só no BotModule, bot ligado) assina NickDecisionService.onDecided no onModuleInit e remove no onModuleDestroy. Busca discordId via novo findDiscordIdByUserId (packages/db auth-repo, fora do nick-repo p/ não conflitar com TASK-016). Cada ação isolada em try/catch: apelido falhar não impede cargo; erro logado com describeDiscordError (ganhou 10007 membro fora da guild e owner; 50013 agora cita Gerenciar Apelidos/Cargos e hierarquia). Nunca lança; decisão já commitada fica (AC#3). Listener é aguardado (resposta do approve espera o Discord; REST do discord.js tem timeout próprio).
- Registro de falha: log estruturado (pedido, discordId, ação, causa). Persistir discord_sync_error visível à staff fica como follow-up (exigiria migration + UI).

AC → evidência:
- AC#1: apps/server/src/bot/discord-member-sync.service.test.ts 'primeira aprovação aplica apelido...' e 'troca de nick aprovada só altera o apelido' (Postgres real + gateway falso, via NickDecisionService.approve); discord-guild.gateway.test.ts setNickname com client falso; domain/member-sync.test.ts.
- AC#2: mesmo teste de integração (addRole com DISCORD_MEMBER_ROLE_ID na primeira; não chamado na troca); member-sync.test.ts.
- AC#3: 'falha de permissão é logada, não lança e a aprovação fica gravada' (50013 no apelido + 10007 no cargo: approve ok, status approved no banco, game_nick gravado, logs com 'Bot sem permissão'/'Membro não está na guild'); usuário inexistente/erro de banco logados; discord-errors.test.ts; env.test.ts 'cargo Membro (TASK-014)'.
- AC#4: 'recusa não altera apelido nem cargos' (com e sem nick vigente: gateway nunca chamado, nick vigente mantido); member-sync.test.ts recusa → [].

Teste manual no Discord (pendência do usuário): 1) .env com DISCORD_MEMBER_ROLE_ID=1547413631627698327 e bot ligado; 2) reconvidar o bot com escopos bot + applications.commands e permissões Gerenciar Apelidos + Gerenciar Cargos; 3) em Configurações do servidor > Cargos, arrastar o cargo do bot acima de Membro e acima dos cargos de quem vai testar; 4) com uma conta que NÃO é dona da guild, pedir nick em /nick; staff aprova em /staff/membros → apelido vira o nick e cargo Membro aparece; 5) pedir outro nick e aprovar → só o apelido muda; 6) pedir e recusar → nada muda; 7) mover cargo do bot abaixo do membro e aprovar → log 'Sync Discord falhou ... Bot sem permissão' e aprovação continua no painel; 8) aprovar nick do dono → log de limitação do Discord.

Skills: task-done-check (checklist; sem UI, visual Playwright N/A). security-review N/A (não toca auth/ledger/prata/saque; só escreve apelido/cargo configurado).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Na aprovação de nick o bot aplica o apelido e, na primeira aprovação, o cargo Membro (DISCORD_MEMBER_ROLE_ID, obrigatória com bot ligado); troca posterior só muda apelido e recusa não mexe em nada (Q31). DiscordMemberSync assina o hook onDecided do NickDecisionService e fala com o Discord por uma porta DiscordGuildGateway; falhas (50013, 10007, dono da guild) são logadas sem desfazer a aprovação. Verificado com testes unitários, integração Postgres com gateway falso e pnpm quality completo verde; validação real no Discord é pendência manual.
<!-- SECTION:FINAL_SUMMARY:END -->
