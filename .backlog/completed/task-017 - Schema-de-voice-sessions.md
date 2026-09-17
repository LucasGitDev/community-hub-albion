---
id: TASK-017
title: Schema de voice sessions
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:47'
labels:
  - db
  - voice
milestone: m-3
dependencies:
  - TASK-002
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tabela única de entrada/saída de voz (doc-002), base para presença em eventos e loot split.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration cria sessão com usuário, canal, início, fim opcional e último heartbeat
- [x] #2 Consulta retorna sessões abertas por usuário
- [x] #3 Um usuário não tem mais de uma sessão aberta simultânea
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
1. Tabela voice_sessions (discord_user_id sem FK, canal, início, fim, heartbeat) + check + índice único parcial + índices de overlap; migration via db:generate.
2. Helpers voice-repo.ts (open atômico fechando anterior, close, list open, touchHeartbeat, closeStale) + overlap puro.
3. Testes integração em db.integration.test.ts + unit do overlap.
4. Quality gate, backlog, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Quality gate (pnpm quality local, TEST_DATABASE_URL, commit 4ed4b57d): Lint 0, race 0, typecheck ok, coverage branch 98.31% (>=79), e2e 10 ok, image build+smoke ok, dup 0%, deadcode 0, audit 0 -> Passou.

AC -> evidência (packages/db/src/db.integration.test.ts, bloco 'voice sessions (TASK-017)', Postgres real):
- AC#1: migration 0002_voice_sessions; teste lê information_schema (discord_user_id/channel_id/started_at/last_heartbeat_at NOT NULL, ended_at nullable).
- AC#2: listOpenVoiceSessions(db, userId) retorna só a sessão aberta do usuário; sem userId retorna todas.
- AC#3: índice único parcial voice_sessions_one_open_per_user_idx (ended_at is null): insert direto de segunda aberta -> 23505; fechadas não contam; openVoiceSession fecha a anterior em 'at' na mesma transação.
- Extra: check ended_at>=started_at -> 23514; closeVoiceSession; touchHeartbeat (não retrocede); closeStaleSessionsAtHeartbeat fecha em last_heartbeat_at (Q30); overlapMs puro unit-testado (voice-overlap.test.ts, Q6/TASK-027).

Decisões:
- discord_user_id text sem FK para users: membros acumulam presença antes de logar no painel; join por users.discord_id.
- guild_id nullable; índices (discord_user_id, started_at) e (channel_id, started_at, ended_at) para overlap de presença.
- Check extra last_heartbeat_at >= started_at; helpers usam greatest() para nunca fechar antes do início nem retroceder heartbeat.
- Sem helpers em apps/** (TASK-018/019 consomem).
DoD#4 N/A (sem UI). DoD#6 N/A (não toca auth/ledger/prata/saque). Doc-005: Q6, Q30 respeitadas; Q5/Q7/Q29 fora do escopo (camadas superiores).
Skills: task-done-check (gate + evidências; visual N/A sem UI).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tabela voice_sessions (migration 0002) com índice único parcial garantindo uma sessão aberta por usuário, check de consistência temporal e helpers open/close/list/heartbeat/stale-close + overlapMs em packages/db. Verificado por testes de integração em Postgres real e pnpm quality verde (coverage 98.31%). Aguardando PR merge (DoD#8).
<!-- SECTION:FINAL_SUMMARY:END -->
