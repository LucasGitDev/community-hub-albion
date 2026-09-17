---
id: TASK-018
title: 'Rastreamento de join, leave e move em voz'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:57'
labels:
  - bot
  - voice
milestone: m-3
dependencies:
  - TASK-017
  - TASK-003
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Persistir sessões a partir de eventos de voz do Discord (doc-004 F3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Entrar em canal abre sessão
- [x] #2 Sair fecha a sessão com horário de fim
- [x] #3 Mover de canal fecha a sessão anterior e abre nova no canal destino
- [x] #4 Testes cobrem join, leave e move
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
1. domain/voice.ts classifyVoiceUpdate pura + testes
2. VoiceTrackingService (DB_HANDLE + voice-repo, clock injetável, erros logados)
3. VoiceListener @On voiceStateUpdate filtrando guild/bots; intent GuildVoiceStates
4. Testes integração Postgres isolado + listener fake
5. Gate, rebase, PR
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality com TEST_DATABASE_URL, commit 5e851975): lint 0, race 0, typecheck ok, coverage branch 98.47% (>=79), e2e 10 ok, imagem build+smoke ok, duplicação 0%, dead code 0, vulns 0. ✅ Passou.

AC→evidência:
- #1 join: voice-tracking.service.test.ts 'join abre sessão' (Postgres real, banco isolado albion_hub_server_voice).
- #2 leave: 'leave fecha a sessão com horário de fim' (ended_at = relógio injetado).
- #3 move: 'move fecha a anterior e abre no destino' + 'cadeia rápida de moves mantém exatamente uma sessão aberta'.
- #4 testes: domain/voice.test.ts (classify join/leave/move/noop, filtro guild/bot), voice.listener.test.ts (VoiceState falso: encaminha ações, ignora outra guild e bots), service integração (+ leave sem sessão no-op, mute mesmo canal no-op, usuários independentes, erro de banco logado sem lançar). 18 testes ok.

Decisões:
- Intent GuildVoiceStates adicionado; VoiceListener @On('voiceStateUpdate') ignora guild != GUILD_ID (Q4) e bots.
- Regra pura em domain/voice.ts (classifyVoiceUpdate, shouldTrackVoiceMember); mesmo canal (mute/deafen/stream) = noop.
- VoiceTrackingService: relógio injetável (VOICE_CLOCK); join/move → openVoiceSession (fecha anterior atomicamente), leave → closeVoiceSession; erros logados, nunca rejeita.
- AFK: todos os canais de voz da guild são rastreados; filtro por canal do evento é da presença (Q6).
- TASK-019 pronto para plugar: heartbeat via touchHeartbeat e boot com closeStaleSessionsAtHeartbeat + reabrir pelo estado atual (Q30) chamando VoiceTrackingService.apply com join.

DoD#4 N/A (sem UI). DoD#6 N/A (não toca auth/ledger/prata/saque). Skills: task-done-check.
Pendência usuário (sem token): entrar/mover/sair de canal de voz na guild e conferir select * from voice_sessions order by started_at.
<!-- SECTION:NOTES:END -->
