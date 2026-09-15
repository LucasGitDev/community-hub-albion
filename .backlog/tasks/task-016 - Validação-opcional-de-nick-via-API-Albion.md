---
id: TASK-016
title: Validação opcional de nick via API Albion
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:18'
labels:
  - backend
milestone: m-2
dependencies:
  - TASK-013
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ajuda ao staff, não bloqueio (Q14): consulta nick na API Albion da ALBION_REGION (Q15, pendente de confirmação).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Solicitação mostra ao staff se o nick foi encontrado na região configurada
- [x] #2 Indisponibilidade da API Albion ou região ausente não impede registro nem aprovação
- [ ] #3 Resultado é exibido tanto no painel quanto no embed quando disponível
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
1. Pesquisar API gameinfo (hosts por região, shape). 2. packages/shared/src/albion.ts: regiões, tipo AlbionLookupResult, matchPlayer exato sem caixa (puro, testado). 3. apps/server: env ALBION_REGION opcional; AlbionPlayerLookup (fetch, timeout 3s, cache TTL, sem retry) + AlbionNickCheckService exportado (reuso TASK-015). 4. Consulta lazy na leitura da fila staff (paralela, cache) + pré-aquecimento fire-and-forget após POST /api/me/nick; sem coluna nova. 5. GET /api/staff/nick-requests ganha albion; UI mostra status. 6. Testes unit/HTTP com lookup fake; e2e com lookup desligado. 7. Env docs/compose. 8. Visual 1280/400, security-review, gate, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, rebase em origin/main): lint 0, race 0, typecheck ok, coverage branch 94.4% (>=79), e2e 28 ok/0 falha/0 flaky, imagem Docker build+smoke ok, duplicação 0%, dead code 0, vulns high+ 0.

API Albion (curl/node reais em 2026-09-15): GET https://gameinfo.albiononline.com (Americas) | gameinfo-ams (Europe) | gameinfo-sgp (Asia) /api/gameinfo/search?q=<nick> → 200 {guilds:[...], players:[{Id, Name, GuildId, GuildName, AllianceName, ...}]}. Busca é por prefixo (q=Albion traz Albion0, albion00), então match exato sem caixa em Name. Inexistente → players []. Latência variável: 60ms a 2.5s, e um pico >15s visto; por isso timeout 5s, sem retry.

Decisões:
- Tipos/regra pura em packages/shared/src/albion.ts: ALBION_REGIONS, hosts fixos por região, albionSearchUrl (host do mapa + encodeURIComponent), matchAlbionPlayer, describeAlbionLookup (texto PT-BR p/ painel e embed). Resultado: found{playerId,name,guildName,region,checkedAt} | not_found | unavailable | disabled.
- apps/server/src/domain/albion-lookup.ts FetchAlbionPlayerLookup: timeout 5s, redirect error, sem retry, cache em memória por nick sem caixa (found/not_found 10 min, unavailable 1 min contra tempestade), dedupe de consultas simultâneas, limite 1000 entradas, nunca lança; motivo de indisponibilidade logado (warn).
- Quando consulta: na leitura da fila staff (Promise.all, cache) + pré-aquecimento fire-and-forget após POST /api/me/nick (sem await; nunca atrasa nem derruba o pedido). Sem coluna nova: resultado muda com o tempo (personagem criado depois) e evita migration; decisões (approve/reject) não consultam a API.
- Env ALBION_REGION opcional (americas|europe|asia; vazio/ausente = disabled). Documentado em .env.example, apps/server/.env.example e passthrough no docker-compose.yml.
- TASK-015 (embed): injetar token ALBION_PLAYER_LOOKUP (exportado pelo MembersModule global), chamar lookup(request.nick) e usar describeAlbionLookup(result) (null = não mostrar). GET /api/staff/nick-requests já devolve albion por solicitação.
- UI /staff/membros: selo com ícone + texto + borda: 'Encontrado no Albion (Americas), guilda X' / ', sem guilda', 'Não encontrado no Albion (Americas)', 'API do Albion indisponível agora'; nada quando desligado. Botões não dependem do resultado.

AC → evidência:
- AC#1: staff-nick-requests.http.test.ts 'fila mostra se o nick foi encontrado no Albion da região' (lookup fake: found/not_found no GET); albion-lookup.test.ts (found, parciais → not_found); albion.test.ts. Visual com API real (ALBION_REGION=americas, server compilado :4179): .playwright-mcp/task016-staff-albion-1280.png e task016-staff-albion-400.png (na raiz do checkout onde o MCP salva) mostram found com guilda, found sem guilda, not_found; scrollWidth 385<=400; console sem erro.
- AC#2: nick.http.test.ts 'API Albion travada não atrasa o pedido de nick' (lookup que nunca resolve → POST 201 dentro de 2s); staff HTTP 'staff aprova: API Albion indisponível não impede'; albion-lookup.test.ts timeout/HTTP 500/JSON inválido/rede → unavailable, sem região → disabled sem fetch; env.test ALBION_REGION; e2e staff-members.spec.ts com consulta desligada (default) sem selo e aprovação ok.
- AC#3: parte do painel provada (acima); parte do embed só exposta (serviço + describeAlbionLookup) p/ TASK-015. AC#3 fica desmarcado até o embed existir.
- Nenhum teste automatizado chama a API real (fetch mockado / provider sobrescrito / região ausente).

Security review: a skill security-review rodou contra o checkout principal e viu diff vazio; checklist manual feito no diff: URL de saída só do mapa fixo de hosts via env enum + encodeURIComponent (sem SSRF por host/protocolo), redirect:'error', timeout, JSON tratado como unknown e validado; resultado renderizado como texto no React; endpoint mantém @Authorize approve MemberRequest; log sem corpo da resposta nem segredo. Sem achado crítico.

Skills: emil-design-eng (selo estático sem animação na fila, estado com ícone+texto+borda, tokens verdigris/oxblood/muted), security-review (checklist manual), task-done-check (checklist).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Conferência opcional do nick pedido na API gameinfo do Albion (ALBION_REGION americas|europe|asia; ausente = desligada). Consulta com timeout 5s, cache e sem retry na leitura da fila staff + pré-aquecimento sem await após o pedido; GET /api/staff/nick-requests e /staff/membros mostram encontrado/guilda, não encontrado ou API indisponível. Registro e aprovação nunca dependem da API. Serviço (token ALBION_PLAYER_LOOKUP + describeAlbionLookup) fica exposto pro embed da TASK-015. Verificado com testes unitários/HTTP com lookup fake, e2e, screenshots 1280/400 com a API real e pnpm quality completo verde.
<!-- SECTION:FINAL_SUMMARY:END -->
