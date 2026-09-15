---
id: TASK-019
title: Heartbeat de sessões e reconciliação no boot
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 06:14'
labels:
  - bot
  - voice
milestone: m-3
dependencies:
  - TASK-018
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tolerância a quedas (Q30): heartbeat 1 min; no boot fecha abertas no último heartbeat e reabre pelo estado atual de voz.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sessões abertas têm heartbeat atualizado a cada 1 minuto
- [x] #2 No boot, sessões abertas são fechadas com fim igual ao último heartbeat
- [x] #3 No boot, quem está em voz recebe sessão nova
- [x] #4 Testes simulam queda e reinício
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
1. domain/voice.ts: membersInVoice pura (plain objects) + testes
2. VoiceTrackingService.reconcile: closeStaleSessionsAtHeartbeat + abre sessão para quem está em voz; apply aguarda reconciliação em curso (sem duplicatas/ordem)
3. VoiceHeartbeatService: setInterval 60s configurável, touchHeartbeat, erros logados, stop em OnApplicationShutdown
4. VoiceBootListener @Once clientReady: snapshot da guild -> reconcile -> heartbeat.start
5. Testes Postgres isolado simulando queda/reinício + fake timers
6. Gate, rebase, PR
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality com TEST_DATABASE_URL, commit f2e9fe78, após rebase em origin/main): lint 0, race 0, typecheck ok, coverage branch 98.65% (>=79), e2e 16 ok, imagem build+smoke ok, duplicação 0%, dead code 0, vulns 0. ✅ Passou.

AC→evidência:
- #1 heartbeat 1 min: voice-heartbeat.service.test.ts (fake timers: nada em 59.999s, touch em 60s com relógio, 3 toques em 3 min, zero após onApplicationShutdown; erro logado e timer segue; não empilha batimento lento) + integração 'heartbeat atualiza last_heartbeat_at das abertas'.
- #2 fecha no último heartbeat: voice-tracking.service.test.ts 'reboot fecha abertas no último heartbeat...' (abertas T0, heartbeats T0+1m/T0+2m, queda; reboot T0+10m → ended_at = T0+2m para as 3) + 'sessão sem heartbeat fecha no início'.
- #3 quem está em voz recebe sessão nova: mesmo teste (USER reaberto em c1 e U3 em c3 com started_at T0+10m; U2 que saiu na queda não reabre) + voice-boot.listener.test.ts (snapshot da guild filtra bots/sem canal, reconcile antes de heartbeat.start) + domain/voice.test.ts membersInVoice.
- #4 queda e reinício: testes acima em Postgres real (banco isolado albion_hub_server_voice, relógio injetado) + 'evento de voz durante a reconciliação espera e não duplica'.

Decisões:
- Evento: Necord @Once('clientReady') (discord.js 14 / Necord 7, igual ReadyListener). VoiceBootListener: snapshot guild.voiceStates.cache → membersInVoice (pura, domain) → VoiceTrackingService.reconcile → só então VoiceHeartbeatService.start.
- reconcile: closeStaleSessionsAtHeartbeat e openVoiceSession em now para cada membro; erros logados, nunca lança.
- Corrida: apply() aguarda a promise da reconciliação em curso, então eventos que chegam durante o boot são aplicados depois do snapshot, na ordem. Se o cache já refletia o evento (join), o apply reabre via openVoiceSession que fecha a anterior atomicamente → no máximo uma aberta (pode sobrar sessão de duração ~0, inofensiva para overlap). Leave refletido no cache: usuário não entra no snapshot e o leave vira no-op.
- Heartbeat: setInterval 60s (VOICE_HEARTBEAT_INTERVAL_MS injetável), unref, start idempotente, flag inFlight evita empilhar, stop em OnApplicationShutdown; void this.beat() com try/catch interno (sem promise flutuante com rejeição).
- Member ausente no cache é tratado como humano (mesma regra do listener).

DoD#4 N/A (sem UI). DoD#6 N/A (não toca auth/ledger/prata/saque). Skills: task-done-check.
Pendência usuário (precisa token): com gente em voz, derrubar o processo, esperar >2 min, subir; conferir select * from voice_sessions order by started_at (antigas com ended_at = last_heartbeat_at, novas abertas no boot) e que last_heartbeat_at avança a cada minuto.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Heartbeat de 1 min das sessões de voz e reconciliação no boot (Q30): no clientReady fecha abertas no último heartbeat, reabre para quem está em voz e só então liga o heartbeat; eventos durante o boot aguardam a reconciliação. Testes simulam queda/reinício em Postgres real e timer com fake timers. Gate completo verde.
<!-- SECTION:FINAL_SUMMARY:END -->
