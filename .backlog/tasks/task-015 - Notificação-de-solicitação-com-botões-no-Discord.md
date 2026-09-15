---
id: TASK-015
title: Notificação de solicitação com botões no Discord
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:34'
labels:
  - bot
milestone: m-2
dependencies:
  - TASK-014
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff pode aprovar/rejeitar direto por embed com botões (doc-004 F2), usando o mesmo serviço do painel (doc-002).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Nova solicitação publica embed em canal staff configurado
- [x] #2 Botões aprovar/rejeitar produzem o mesmo resultado do painel
- [x] #3 Clique de quem não é staff é recusado com resposta efêmera PT-BR
- [x] #4 Embed é atualizado com o resultado após decisão
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
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
1. Env DISCORD_STAFF_CHANNEL_ID (obrigatória com bot ligado) + .env.example/compose/test envs.
2. Migration nick_requests.discord_message_id + repo (set message id, dados do embed, achar usuário por discord id).
3. NickRequestService (members) com hook onRequested pós-commit; NickController usa o serviço.
4. Domínio puro nick-embed.ts: view do embed PT-BR (pendente/aprovado/recusado), customIds e parse.
5. Porta StaffChannelGateway (post/edit) + impl discord.js; NickStaffEmbedService assina onRequested/onDecided, grava message id, loga falhas com describeDiscordError.
6. NickEmbedInteractions: @Button approve/reject, @Modal reject com motivo; auth discordId→user→roles→CASL approve MemberRequest; recusa efêmera PT-BR; conflito efêmero + refresh.
7. Testes puros + Postgres real com gateway/interação falsos; security review; pnpm quality; PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, origin/main atual, TASK-016 ainda não mergeada): lint 0, race 0, typecheck ok, coverage branch 93.62% (>=79), e2e 28 ok/0 falha/0 flaky, imagem Docker build+smoke ok, duplicação 0%, dead code 0 (após remover 3 exports), vulns high+ 0.

Decisões:
- Env DISCORD_STAFF_CHANNEL_ID (snowflake): obrigatória com DISCORD_BOT_ENABLED=true (refine zod + guarda em BotModule.register), igual DISCORD_MEMBER_ROLE_ID; nos dois .env.example, docker-compose.yml e envs dos testes.
- Hook onRequested: novo NickRequestService (members, global) encapsula requestNick; NickController chama o serviço; listeners pós-commit, erro logado. ListenerSet compartilhado com NickDecisionService.onDecided (mesma semântica).
- Migration 0004: nick_requests.discord_message_id (nullable). Repo: setNickRequestDiscordMessageId, getNickRequestEmbedData (pedido + discordId de quem pediu/decidiu), findUserIdByDiscordId.
- NickStaffEmbedService (bot) assina onRequested e onDecided e só faz sync(requestId) do estado do banco: sem mensagem e pendente → publica e grava id; com mensagem → edita (correção de nick, decisão pelo painel ou botão); edição com 10008 (apagada) e pendente → republica; decidido sem mensagem → não publica. Falhas logadas com describeDiscordError (ganhou 10003/canal não-texto e 10008), nunca lança.
- Porta StaffChannelGateway (postNickRequest/editNickRequest) + DiscordJsStaffChannelGateway (client.channels.fetch → send/messages.edit), payload JSON cru com allowedMentions vazio (menções não notificam).
- Domínio puro apps/server/src/domain/nick-embed.ts: buildNickEmbed (PT-BR: 'Novo pedido de nick', Membro, Nick atual → pedido / Primeiro nick, Pedido em <t:..:f>, Status; aprovado/recusado muda título+cor, 'Aprovado por @x em ...' / 'Recusado por @x em ...' + Motivo, sem botões), customIds, buildRejectModal, respostas efêmeras.
- customIds nick/approve/:id, nick/reject/:id, nick/reject-modal/:id. Achado: com 'nick:approve/:id' o path-to-regexp do Necord lê ':approve' como parâmetro e o botão Recusar cairia no handler de aprovar; teste usa MessageComponentDiscovery/ModalDiscovery reais do Necord para provar o roteamento.
- NickEmbedInteractions: auth por clique = Discord id (interaction.user.id, assinado pelo Discord) → usuário do painel → listRoles → defineAbilityFor.can('approve','MemberRequest'); sem conta ou sem permissão → reply efêmero PT-BR antes de qualquer escrita. uuid validado. Aprovar: deferReply efêmero (hooks podem passar de 3 s) → NickDecisionService.approve(decisor app user). Recusar: abre modal (primeira resposta, sem defer) com TextInput paragraph obrigatório 1–300; submit revalida permissão e validateRejectionNote → reject. Já decidido → efêmero + sync do embed. Erro inesperado → efêmero genérico.
- TASK-016: não mergeada no momento do rebase. Ponto de extensão: NickLookupView/NickEmbedInput.lookup (campo 'API do Albion') e NickStaffEmbedService.lookupFor(data) retornando null; quando TASK-016 entrar, preencher lookupFor com o status de lookup do pedido (completa TASK-016 AC#3).

AC → evidência:
- AC#1: apps/server/src/bot/nick-staff-embed.service.test.ts 'pedido novo publica embed no canal e guarda o message id; correção edita a mesma mensagem'; staff-channel.gateway.test.ts (publica no canal configurado, payload); nick.http.test.ts hook onRequested; env.test.ts canal da staff; domain/nick-embed.test.ts pendente.
- AC#2: 'aprovar pelo botão = painel: nick vigente, auditoria, hook de decisão...' e 'recusar abre modal; envio com motivo recusa igual ao painel...' (Postgres real: status, decided_by, decided_at, decision_note, users.game_nick, evento onDecided como o DiscordMemberSync recebe); roteamento Necord.
- AC#3: 'clique de quem não é staff ou não tem conta é recusado efêmero, sem mudar nada' (member, member+caller e Discord id sem conta; approve/reject/modal; flags Ephemeral; banco pending; sem modal/defer).
- AC#4: testes de aprovação/recusa via botão e 'decisão pelo painel (serviço) edita o embed; clique depois responde já decidido e atualiza a mensagem'; 'falha do Discord não quebra pedido nem decisão; mensagem apagada é republicada'; nick-embed.test.ts aprovado/recusado sem botões.

Security review (skill security-review rodou com diff vazio no checkout principal; checklist manual em git diff origin/main...HEAD): autorização a cada clique e no submit do modal com o mesmo CASL do painel (papel revogado vale na hora); identidade vem do Discord, não do customId; customId só carrega uuid validado; nenhuma escrita antes da checagem; roteamento sem colisão entre aprovar/recusar (bug corrigido e testado); motivo validado 1–300; Drizzle parametrizado; allowedMentions vazio (motivo com @everyone não pinga); respostas efêmeras não expõem dados. Sem achado crítico. Observação: como no painel, staff pode decidir o próprio pedido.

Teste manual no Discord (pendência do usuário): 1) .env com DISCORD_STAFF_CHANNEL_ID=1549401951924650025 (e DISCORD_MEMBER_ROLE_ID), bot ligado; 2) bot com Ver canal, Enviar mensagens, Inserir links no canal da staff; 3) membro pede nick em /nick → embed 'Novo pedido de nick' com Aprovar nick/Recusar aparece no canal; 4) membro corrige o nick → mesma mensagem é editada; 5) conta sem staff clica → mensagem efêmera 'Só a staff pode...'; conta sem login no painel → orientação de entrar no painel; 6) staff clica Aprovar → efêmero 'Nick X aprovado.', embed verde 'Aprovado por @staff em ...' sem botões, apelido/cargo aplicados (TASK-014); 7) novo pedido, Recusar → modal 'Motivo da recusa', enviar → embed vermelho com motivo; membro vê o motivo em /nick; 8) novo pedido decidido no painel /staff/membros → embed atualizado; 9) apagar a mensagem de um pedido pendente e corrigir o nick → embed republicado; 10) DISCORD_STAFF_CHANNEL_ID errado → log 'Canal da staff não encontrado...' e pedido segue no painel.

Skills: task-done-check (checklist; sem UI web → visual Playwright N/A; copy Discord PT-BR revisada), security-review (checklist manual).

Rebase sobre TASK-016 (PR #23): conflitos em members.module.ts (mantidos NickRequestService e ALBION_PLAYER_LOOKUP nos providers/exports), nick.controller.ts (pedido via NickRequestService.request + pré-aquecimento Albion sem await), nick.http.test.ts (imports de ambos; discord id do teste de hook colidia com teste da TASK-016 → id único). Sem colisão de migration (0004 continua única). lookupFor implementado (campo 'Albion' via describeAlbionLookup; disabled omite; erro logado sem bloquear) — completa TASK-016 AC#3. Gate pós-rebase: lint 0, race 0, typecheck ok, coverage branch 94.58%, e2e 28/0/0, imagem ok, dup 0%, dead code 0, vulns 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pedido de nick novo publica embed PT-BR com botões Aprovar nick/Recusar no canal DISCORD_STAFF_CHANNEL_ID; correção edita a mesma mensagem (message id em nick_requests). Botões e modal de motivo chamam o NickDecisionService (mesmo resultado do painel), com autorização por Discord id → usuário → CASL e recusa efêmera para não-staff; decisão pelo painel ou botão atualiza o embed sem botões. Discord atrás de porta; falhas logadas sem quebrar fluxo. Verificado com testes puros, Postgres real + Discord falso, roteamento Necord real e pnpm quality completo; validação no Discord real é pendência manual. Extensão para lookup da TASK-016 pronta (lookupFor).
<!-- SECTION:FINAL_SUMMARY:END -->
