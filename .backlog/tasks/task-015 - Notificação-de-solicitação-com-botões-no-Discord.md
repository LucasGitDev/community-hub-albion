---
id: TASK-015
title: Notificação de solicitação com botões no Discord
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:19'
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
- [ ] #1 Nova solicitação publica embed em canal staff configurado
- [ ] #2 Botões aprovar/rejeitar produzem o mesmo resultado do painel
- [ ] #3 Clique de quem não é staff é recusado com resposta efêmera PT-BR
- [ ] #4 Embed é atualizado com o resultado após decisão
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
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
