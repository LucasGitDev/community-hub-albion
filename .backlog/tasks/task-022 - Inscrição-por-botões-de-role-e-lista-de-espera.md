---
id: TASK-022
title: Inscrição por botões de role e lista de espera
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 02:16'
labels:
  - events
  - bot
milestone: m-4
dependencies:
  - TASK-021
  - TASK-003
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Membros se inscrevem por botões de role no embed; role lotada vai para espera; caller move entre role/espera (Q27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Evento open publica embed com botão por role e vagas restantes
- [x] #2 Inscrição em role lotada entra na lista de espera
- [x] #3 Membro pode trocar de role ou sair
- [x] #4 Caller/owner move inscrito entre role e espera
- [x] #5 Inscrição recusada quando evento não está open
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
1. shared (event-signups.ts): status confirmed|waitlist|cancelled, DTOs, schemas zod (join por slotId, move staff), helpers puros de contagem de vagas, rótulo de botão 'Role (livres/total)' e custom ids do Discord (evento/inscrever/:slotId, evento/sair/:eventId) com validação de uuid; EventRoleSlotDto ganha 'id'.
2. db: tabela event_signups (event_id, user_id, slot_id -> event_role_slots, role_name snapshot, status, position, decided_by) + índice único parcial de inscrição ativa por (evento, usuário) + coluna events.discord_message_id; migration.
3. db repo event-signups-repo: join/leave/move/list em transação com 'for update' na linha do evento (serializa a disputa pela última vaga); promoção automática do primeiro da espera da role quando um confirmado sai/troca; setEventDiscordMessageId.
4. server: EventSignupsService (mesmo serviço para bot e API, doc-002) com hook onSignupChanged; rotas POST /api/events/:id/signups, DELETE /api/events/:id/signups/me, PATCH /api/events/:id/signups/:userId, GET /api/events/:id/signups, com CASL (join Event para membro, update Event para owner/staff).
5. bot: env DISCORD_EVENTS_CHANNEL_ID (obrigatória com bot ligado) + gateway do canal de eventos; embed puro em domain/event-embed.ts com botão por role e vagas; EventEmbedService assina onEventTransition e onSignupChanged e publica/edita a mensagem; EventSignupInteractions trata os botões com identidade da interação.
6. Testes: unitários puros (vagas, rótulos, custom ids), integração db (único ativo, ordem da espera, promoção, corrida pela última vaga), HTTP (entrar, 403, 409 fora de open, sair promove) e bot com interação e gateway falsos.
7. security-review, gate completo, notas/ACs/DoD e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisões TASK-022:
- Canal do embed: canal fixo `DISCORD_EVENTS_CHANNEL_ID` (obrigatória com o bot ligado, igual DISCORD_STAFF_CHANNEL_ID; está nos dois .env.example, docker-compose.yml, envs dos testes e doc-007). Canal único porque a v1 tem uma guild só (Q4) e a agenda fica num lugar; canal por evento é de voz e é TASK-024. Erro do canal tem texto próprio em describeDiscordError (EVENTS_CHANNEL_NOT_TEXT).
- `event_signups` guarda snapshot: aponta para a vaga já copiada do template (`event_role_slots.id`) e repete `role_name`, então editar o template ou apagar a role do catálogo não move ninguém. Índice único parcial `event_signups_active_idx` (event_id, user_id) where status in ('confirmed','waitlist'): uma inscrição ativa por pessoa por evento, garantido pelo banco (teste insere por fora do repo e o banco recusa). Nada é apagado: trocar de role ou sair vira linha `cancelled` (histórico), igual ao espírito do ledger imutável.
- Espera é **por role** (Q27), com `position` 1,2,3... por vaga; check no banco amarra `status='waitlist'` a `position>0`. Promoção automática: sempre que um confirmado libera a vaga (sai, troca de role ou o caller o manda para a espera), o primeiro da espera daquela role vira confirmado na mesma transação. Quem foi mandado para a espera é excluído da promoção, senão voltaria sozinho para a vaga que acabou de liberar.
- Corrida: join/leave/move começam a transação travando a linha do evento (`select ... for update`), mesmo padrão das transições da TASK-021. Dois cliques simultâneos na última vaga viram um confirmado e um na espera — provado em teste com Promise.all.
- AC#5: entrar e sair só com o evento `open`; fora disso 409 na API e recusa efêmera no botão, que ainda atualiza a mensagem (os botões aparecem desabilitados). O caller/owner continua organizando em `open` e `closed` (ajuste depois do fechamento é o uso real), mas não depois do start — a partir daí quem manda é a janela de presença (Q6/Q29).
- Move do caller não estoura vaga: role lotada recusa com 409 em vez de criar vaga extra; quem manda decide quem sai primeiro.
- Discord/segurança: custom ids `evento/inscrever/:slotId` e `evento/sair/:eventId` carregam só o alvo, um parâmetro só (o matcher do Necord é path-to-regexp). Quem entra vem sempre de `interaction.user.id` → usuário do painel → CASL `join Event`; custom id forjado no máximo inscreve quem clicou. O evento do botão de role é descoberto no banco (findEventRoleSlot), não vem do cliente. Mover terceiro não existe por botão: é rota da API com `update Event` (owner ou staff).
- API (consumida pela TASK-023): POST /api/events/:id/signups, DELETE /api/events/:id/signups/me, PATCH /api/events/:id/signups/:userId, GET /api/events/:id/signups. Mesmo EventSignupsService dos botões (doc-002), com hook onSignupChanged que o embed assina — o serviço não conhece Discord.
- Embed: publicado quando o evento abre (rascunho nunca publica), `events.discord_message_id` guarda a mensagem e toda mudança (inscrição ou transição) edita a mesma; mensagem apagada é republicada enquanto a inscrição está aberta. Botões chunkados em 5x5 e menções com allowed_mentions vazio (não notificam).
- Reaproveitamento: `EmbedView`/`toMessagePayload` e `DiscordChannelGateway` foram extraídos do canal da staff (TASK-015) e agora servem aos dois canais, sem duplicar payload nem fetch de canal.
- Flake pré-existente encontrado: `main.test.ts` usava o timeout padrão de 5 s para subir o bundle compilado, que leva ~6,0 s nesta máquina (medido igual na origin/main, então não é regressão desta task). Passou a ter timeout explícito de 30 s.

Gate completo (local, commit edb2f0cd): ⚠️ passou com avisos — lint 0, race 0, typecheck ok, coverage branch 93.51% (≥79), 532 testes, e2e 34 ok/0 falhas/0 flaky, imagem Docker build+smoke ok, duplicação 0.69%, audit 0 high. Aviso não bloqueante: dead code 7 (exports shadcn pré-existentes, os mesmos da TASK-020/021).

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 embed com botão por role e vagas | event-embed.test.ts 'evento aberto: um botão por role com as vagas livres, mais o Sair' (Tank (1/1), Healer (2/2), Sair) e 'mostra confirmados, vagas restantes e a lista de espera'; event-embed.service.test.ts 'abrir o evento publica o embed e guarda o id da mensagem; rascunho não publica' e 'botão de role inscreve quem clicou e edita a mensagem com as vagas novas' (Tank (0/1) depois do clique) | ✅ |
| AC#2 role lotada vai para a espera | db.integration 'role lotada manda para a espera, na ordem de chegada' (posições 1 e 2); event-signups.http.test.ts 'role lotada joga na lista de espera' (200 com status waitlist/position 1); event-embed.service.test.ts 'role lotada manda para a espera e o embed mostra a fila' | ✅ |
| AC#3 membro troca de role ou sai | db.integration 'sair promove o primeiro da espera daquela role' e 'trocar de role libera a vaga antiga e promove quem esperava lá'; event-signups.http.test.ts 'sair promove o primeiro da espera da role' e 'trocar de role mantém uma inscrição ativa só'; botão Sair em event-embed.service.test.ts | ✅ |
| AC#4 caller/owner move entre role e espera | db.integration 'caller move inscrito entre role e espera; role lotada recusa' e 'caller ainda organiza com a inscrição fechada, mas não depois do start'; event-signups.http.test.ts 'caller move inscrito entre role e espera; membro comum não' (403 para membro e para caller de outro evento, 200 para owner e staff), 'caller não estoura a vaga: role lotada recusa o move com 409' | ✅ |
| AC#5 inscrição recusada fora de open | db.integration 'evento fora de open recusa entrar e sair'; event-signups.http.test.ts 'inscrição recusada com 409 quando o evento não está open'; event-embed.service.test.ts 'evento fora de open: botão recusa e a mensagem é atualizada com os botões desligados' | ✅ |
| Corrida pela última vaga | db.integration 'dois cliques simultâneos na última vaga: um confirma, o outro espera' (Promise.all, 1 confirmado + 1 na espera) | ✅ |
| DoD#6 security-review | sem achado ≥ confiança 8. Conferidos: identidade sempre de interaction.user.id (custom id não carrega usuário), evento do botão resolvido no banco, uuid validado antes de qualquer escrita, PATCH com ability.can('update', asSubject('Event', {ownerId})) — membro e caller de outro evento tomam 403, SameOriginGuard em toda escrita, 404 antes do 403, SQL só via query builder, allowed_mentions vazio | ✅ |
| DoD#4 UI | não se aplica: nenhuma tela do painel alterada (painel de eventos é TASK-023) | — |

Skills: security-review, task-done-check.

Pendência do usuário — teste manual no Discord real:
1) .env com DISCORD_EVENTS_CHANNEL_ID do canal de eventos (bot com Ver canal, Enviar mensagens, Inserir links nele) e bot ligado;
2) caller cria evento a partir de um template e abre a inscrição → embed com o nome do evento, template, horário, um botão por role 'Role (livres/total)' e 'Sair' aparece no canal;
3) membro registrado clica numa role → resposta efêmera 'Inscrição confirmada em X' e o embed muda para X (0/n) com a menção dele;
4) conta sem /registrar clica → efêmero orientando a usar /registrar, sem inscrever;
5) segundo membro clica na role já lotada → efêmero 'entrou na lista de espera, na posição 1' e o embed ganha o campo Lista de espera;
6) o confirmado clica em Sair → efêmero 'Você saiu do evento' e quem estava na espera aparece confirmado no lugar, sem ninguém tocar em nada;
7) membro clica em outra role → o embed mostra ele na role nova e libera a antiga;
8) caller fecha a inscrição (ou deixa o horário vencer) → os botões do embed ficam cinza/desabilitados e um clique responde 'As inscrições não estão abertas';
9) caller usa o painel/API PATCH para mover alguém entre role e espera → a mensagem é editada na hora;
10) apagar a mensagem do evento no canal e provocar qualquer mudança → o bot republica o embed;
11) DISCORD_EVENTS_CHANNEL_ID errado → log 'Canal de eventos não encontrado ou não aceita mensagens...' e a inscrição continua funcionando pela API.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Membros se inscrevem em evento por botão de role no embed do canal DISCORD_EVENTS_CHANNEL_ID (Q27): cada botão mostra 'Role (livres/total)', role lotada manda para a lista de espera daquela role e, quando um confirmado sai ou troca de role, o primeiro da espera sobe sozinho na mesma transação. Caller/owner e staff movem inscritos entre role e espera pela API (PATCH), que recusa estourar vaga; fora de 'open' a inscrição é recusada com 409 e os botões do embed aparecem desabilitados (Q26). A tabela event_signups é histórico (troca/saída viram linha cancelada) com índice único parcial de uma inscrição ativa por pessoa por evento, e join/leave/move travam a linha do evento com 'for update', de modo que dois cliques na última vaga viram um confirmado e um na espera. O mesmo EventSignupsService atende botão do Discord e API (doc-002), e o embed é publicado ao abrir o evento e editado a cada mudança. Verificado com 11 testes puros no shared, 8 testes puros do embed, 9 de integração no Postgres (único ativo, ordem da espera, promoção, corrida, cascade), 9 testes HTTP (401/403/409/400, entrar, sair promovendo, mover, role lotada) e 10 testes de bot com interação e canal falsos; gate completo verde (coverage branch 93.51%, e2e 34/0) e security-review sem achado. Validação no Discord real é pendência manual descrita nas notas.
<!-- SECTION:FINAL_SUMMARY:END -->
