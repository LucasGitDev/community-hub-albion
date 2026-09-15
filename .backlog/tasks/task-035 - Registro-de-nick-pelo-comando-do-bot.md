---
id: TASK-035
title: Registro de nick pelo comando do bot
status: In Progress
assignee: []
created_date: '2026-09-15 13:59'
updated_date: '2026-09-15 14:06'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-012
  - TASK-015
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mudança pedida pelo usuário (2026-09-15): membro registra ou troca o nick por slash command no Discord, sem precisar abrir o painel. Reusa o mesmo serviço do painel (doc-002), dispara o embed da staff (TASK-015) e a consulta Albion (TASK-016). O site continua funcionando como alternativa.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Comando PT-BR permite enviar nick sem login prévio no painel; usuário é criado a partir da conta Discord
- [x] #2 Solicitação criada pelo comando fica pending e publica o embed da staff
- [x] #3 Mesmas regras do painel: validação de nick, uma pendência por usuário, troca mantém nick vigente até aprovação
- [x] #4 Respostas do comando são efêmeras e informam o estado (enviado, corrigido, já aprovado, inválido)
- [x] #5 Comando só funciona na guild configurada
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
1. NickRegistrationService (members/): validação, 409 same nick, NickRequestService.request, warm-up Albion; controller refatorado
2. Domínio puro: textos PT-BR do comando (buildRegisterReply)
3. RegisterNickCommand /registrar nick: guild check, deferReply efêmero, upsertUser + rolesForLogin, serviço compartilhado
4. Testes: puros + Postgres real com interação falsa; painel x comando mesmo resultado
5. security-review, gate, notas
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (pnpm quality, commit eda26665): lint 0, race 0, typecheck ok, coverage branch 94.7% (>=79), e2e 28 ok/0 falha, imagem Docker build+smoke ok, duplicação 0%, dead code 0, audit high+ 0. Passou.

Design:
- Slash command /registrar com opção string obrigatória nick (min 3, max 16, PT-BR). Um comando só (sem alias /nick). Registrado só na GUILD_ID (development: [GUILD_ID], como /ping) e o handler recusa guildId diferente ou DM antes de tocar o banco.
- Fluxo: guild check -> deferReply efêmero (hooks do embed podem passar de 3 s) -> NickRegistrationService.registerFromDiscord: validateNick primeiro (inválido não cria usuário), upsertUserByDiscordId (id, username, globalName, avatar) + rolesForLogin (member; admin só para BOOTSTRAP_ADMIN_DISCORD_IDS, igual OAuth) -> mesma regra do painel.
- Refactor: NickRegistrationService (members/) é o caminho único; NickController (POST /api/me/nick) agora chama register() e só mapeia invalid->400, same_nick->409, requested->201/200. Warm-up Albion (sem await) movido pro serviço.
- Respostas puras em domain/register-nick.ts (buildRegisterReply): enviado para aprovação (+ o que muda ao aprovar ou, em troca, 'continua como X, com o mesmo acesso' Q31), pendente corrigido, já é seu nick atual, nick inválido com a regra, erro inesperado genérico, fora da guild.

AC -> evidência (apps/server/src/bot/register-nick.command.test.ts, Postgres real + interação falsa; domain/register-nick.test.ts):
- #1 'registra slash command registrar com opção string nick obrigatória 3–16' (metadados Necord) e 'usuário novo: criado da conta Discord com papel member...'.
- #2 mesmo teste: pedido pending + listener onRequested (hook do embed da staff) recebe created=true + consulta Albion disparada.
- #3 'segundo comando corrige a pendência sem duplicar', 'troca: nick vigente e papéis mantidos até aprovar', 'nick inválido: mostra a regra e não cria usuário nem pedido', 'painel e comando produzem o mesmo resultado no banco'. nick.http.test.ts segue verde após refactor.
- #4 respostas efêmeras (deferReply flags Ephemeral / reply Ephemeral) com textos testados em register-nick.test.ts.
- #5 'fora da guild configurada (outro servidor ou DM): recusa efêmera sem tocar o banco'.

Security-review: identidade vem da interação autenticada pelo gateway Discord; guild conferida; papéis só member/admin-bootstrap via rolesForLogin (teste 'id do BOOTSTRAP_ADMIN_DISCORD_IDS recebe admin...'); nick validado alfanumérico antes do banco; erro sem detalhe ao usuário. Sem achados HIGH/MEDIUM.

Verificação real no Discord (pendência do usuário):
1. pnpm dev com bot ligado; no servidor, digitar /registrar nick:Teste (resposta efêmera 'enviado para aprovação').
2. Conferir embed 'Novo pedido de nick' no canal da staff.
3. Rodar /registrar nick:Teste2 e ver 'pedido pendente foi corrigido' + embed atualizado.
4. Aprovar pelo botão; conferir apelido Teste2 e cargo Membro no membro.
5. /registrar nick:Teste2 de novo -> 'já é o seu nick atual'. /registrar em DM/outro servidor -> recusa.
Skills: security-review, task-done-check (checklist). DoD#4 N/A (sem UI).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Novo /registrar nick:<nick> no Discord: cria o usuário a partir da conta Discord (papéis iguais ao login), cria/corrige a pendência pelo mesmo NickRegistrationService do painel (embed da staff + consulta Albion), respostas efêmeras PT-BR, só na guild configurada. Controller do painel refatorado para o serviço. Pendente: merge e verificação real no Discord.
<!-- SECTION:FINAL_SUMMARY:END -->
