---
id: TASK-003
title: Server NestJS com bot Necord e comando /ping
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:37'
labels:
  - backend
  - bot
milestone: m-0
dependencies:
  - TASK-001
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Processo único (doc-002) começa com Nest + Necord conectando ao Discord single-guild (Q4, GUILD_ID em env). UI e respostas do bot em PT-BR (Q18).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bot fica online na guild configurada por GUILD_ID
- [x] #2 /ping responde em PT-BR
- [x] #3 API expõe endpoint de health que responde 200
- [x] #4 Config inválida ou ausente (token, GUILD_ID) impede boot com erro claro
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
1. Deps: @nestjs/core/common/platform-express 12, necord 7, discord.js, zod, reflect-metadata; unplugin-swc no vitest.
2. config/env.ts: schema zod + parseEnv (DISCORD_TOKEN, GUILD_ID snowflake, PORT, NODE_ENV) + formatação de erro.
3. domain/ping.ts: texto PT-BR do /ping.
4. AppModule com prefixo /api, HealthController (GET /api/health com status do bot), BotModule Necord (guild commands em GUILD_ID).
5. main.ts: valida env antes do Nest; exit 1 com mensagem clara.
6. Testes: env, ping, health HTTP sem Discord, spawn do build sem env.
7. Verificação real: build + curl health + boot sem env. Gate completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Retomado pelo lead após agent travar (Docker/OrbStack travado no host; reiniciado).
Gate local completo: lint 0, race 0, typecheck ok, coverage 98.27% (61 testes, inclusive Postgres real), e2e 8/8, dup 0%, dead code 0, vulns 0.
Evidências:
- AC#3: app.module.test 'GET /api/health 200 banco up / 503 banco down'; boot real do dist com DISCORD_BOT_ENABLED=false: curl /api/health -> {"status":"ok","db":"up","bot":"offline"} HTTP 200; /health -> 404.
- AC#4: main.test (spawn do dist) + execução manual sem env -> exit 1 listando DISCORD_TOKEN, GUILD_ID, DATABASE_URL obrigatórias; teste garante que token não vaza no log.
- AC#1 e AC#2: pendentes de verificação real no Discord pelo usuário (token não disponível). /ping tem teste unitário da resposta PT-BR (domain/ping.test.ts); comandos registrados só na GUILD_ID (development: [GUILD_ID]).
Decisões: prefixo global /api; health 200/503 depende do banco, bot só informativo; token inválido derruba o boot (fail fast); DISCORD_BOT_ENABLED=false sobe só API; SWC só no projeto vitest do server; lógica pura testável em src/config e src/domain (coverage include).
Também entrega TASK-002 AC#2 (DbModule + health com ping real).
Skills: task-done-check.

Verificação real (2026-09-15, .env do usuário): 'Bot online como Javali da Turma#3896' e /api/health {status:ok, db:up, bot:online} → AC#1 ok. Registro dos slash commands falhou com DiscordAPIError 50001 Missing Access (bot sem escopo applications.commands/sem acesso à guild) e o erro não tratado derrubava o processo: corrigido com listener de 'error' + mensagem acionável. AC#2 (/ping) pendente de reconvite do bot com applications.commands e teste do usuário.

Verificação real pelo usuário (2026-09-15): /ping respondeu no Discord.
<!-- SECTION:NOTES:END -->
