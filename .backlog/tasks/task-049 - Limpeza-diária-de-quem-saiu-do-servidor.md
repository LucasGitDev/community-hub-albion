---
id: TASK-049
title: Limpeza diária de quem saiu do servidor
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 02:19'
updated_date: '2026-09-17 04:07'
labels:
  - backend
  - discord
dependencies: []
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Job agendado no Nest (madrugada, diário) que verifica quem não está mais no servidor do Discord: derruba as sessões, remove os papéis e marca a conta como inativa na lista de membros, com data. Saldo e ledger NUNCA são tocados: prata é dívida com a pessoa, mesmo que ela saia. Pode ser disparado sob demanda pelo namespace de manutenção (TASK-048).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Job roda diário de madrugada e é idempotente
- [x] #2 Quem saiu do servidor perde sessões e papéis e fica marcado como inativo com data
- [x] #3 Quem continua no servidor não é afetado
- [x] #4 Saldo, lançamentos do ledger e saques existentes ficam intactos
- [x] #5 Falha na API do Discord não derruba ninguém por engano nem quebra o job
- [x] #6 security-review sem achados críticos
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
1. Schema/migration aditiva: users.left_guild_at (timestamptz). Ban e ledger intocados.
2. packages/shared/guild-cleanup.ts: guarda pura (circuit breaker) assessGuildCleanup — aborta com lista vazia ou volume de ausentes suspeito (resposta parcial do Discord); + nextCleanupRunAt para o horario diario.
3. packages/db/guild-cleanup-repo.ts: runGuildCleanup(db,{presentDiscordIds, now}) numa transacao — marca left_guild_at, apaga sessions, apaga user_roles dos ausentes; limpa a marca de quem voltou; protege o ultimo admin ativo; NUNCA toca ledger/withdrawals/ban.
4. apps/server/src/cleanup/: GuildCleanupService (implementa MaintenanceCleanup.run()) + GuildCleanupScheduler (setInterval, padrao TASK-019/EventSignupsCloseService, dispara 04:00). Nota system autoria 'Limpeza automatica'. Modulo global exportando MAINTENANCE_CLEANUP; ligado quando o bot esta ligado (precisa do gateway da guild).
5. UI: selo 'Saiu do servidor' com data na lista de membros do admin (mesmo padrao do selo de banido, independente dele).
6. Testes: unit da guarda, integracao do repo (idempotencia, saldo/ledger intactos, banido preservado), unit do servico (falha do Discord nao altera ninguem), http do cleanup.
7. security-review + quality gate + PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação (TASK-049)

Job diário no próprio processo Nest (padrão do heartbeat de voz da TASK-019, sem cron externo): setInterval curto compara o relógio com o próximo horário (04h local). Registra o provider MAINTENANCE_CLEANUP num módulo global (CleanupModule), então POST /api/maintenance/cleanup passa a funcionar sem tocar no namespace da TASK-048.

Camadas:
- packages/shared/src/guild-cleanup.ts — disjuntor puro (assessGuildCleanup), agenda (nextGuildCleanupRun) e o texto da nota de autoria.
- packages/db/src/guild-cleanup-repo.ts — runGuildCleanup numa transação: marca left_guild_at, apaga sessions e user_roles de quem saiu, limpa a marca de quem voltou. Não toca ledger, saques nem banimento; preserva o último admin ativo.
- apps/server/src/cleanup/ — GuildCleanupService (implementa MaintenanceCleanup) + GuildCleanupScheduler.
- Migration aditiva 0017_quiet_ezekiel.sql (users.left_guild_at).
- UI: selo 'Saiu do servidor' (pílula warning + LogOut) na lista de membros, com data e 'limpeza automática', independente do selo de banido.

## Quality gate (local, commit 85cd4029 + refeito após fd8ad04)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 90% | ≥ 79% | ✅ |
| E2E desktop 1280 / mobile 400 | 94 ok, 0 falha, 0 flaky (porta 4196) | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | ok | ok | ✅ |
| Duplicação | 1.75% | ≤ 15% | ✅ |
| Dead code | 6 (pré-existentes, shadcn) | advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

## Evidência por AC

| AC | Evidência |
|---|---|
| #1 job diário e idempotente | apps/server/src/cleanup/guild-cleanup.scheduler.test.ts (3 testes: não roda ao subir, roda uma vez na madrugada, reagenda); packages/shared/src/guild-cleanup.test.ts (nextGuildCleanupRun); packages/db 'rodar duas vezes seguidas não muda nada na segunda'; service 'segunda passada não duplica nota' |
| #2 sessões, papéis e marca com data | packages/db 'quem saiu perde sessões e papéis e fica marcado com a data'; apps/server 'desativa quem saiu, deixa a nota assinada...'; e2e/guild-cleanup.spec.ts + screenshots 1280/400 |
| #3 quem ficou não é afetado | packages/db 'quem continua no servidor não é afetado'; e2e (linha do ativo sem selo) |
| #4 saldo/ledger/saques intactos | packages/db 'saldo, lançamentos e saque pendente ficam exatamente como estavam'; service confere saldo 750.000 após a passada; grep no diff: nenhuma escrita em ledger_entries/withdrawals |
| #5 falha do Discord não derruba ninguém | apps/server 'consulta que falha aborta a passada sem alterar ninguém' (handle de banco que explode ao primeiro toque); packages/db 'lista vazia aborta' e 'resposta parcial aborta'; packages/shared (disjuntor) |
| #6 security-review | sem achados acima de 80% de confiança; verificado ledger intocado, banimento preservado, disjuntor antes de qualquer escrita, trava do último admin, semente leftGuild só com AUTH_DEV_LOGIN (proibido em produção) |

DoD#4: e2e/guild-cleanup.spec.ts cobre o fluxo nos dois projetos; screenshots desktop 1280 e mobile 400 revisados pelo agent (a linha de data/autoria foi trocada de truncate para break-words depois de ver o corte no mobile).
DoD#5: confere com doc-005 G6 (sessões e papéis caem, conta vira inativa, saldo e ledger nunca tocados) e G9 (banimento é marca independente, não é apagado nem sobrescrito).

Skills: security-review, emil-design-eng, task-done-check. (marclou-review não se aplica: a mudança de UI é um selo numa tela interna de gestão, sem copy de conversão.)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Limpeza diária de quem saiu do servidor: job agendado no próprio processo Nest (04h, padrão do heartbeat da TASK-019) que pergunta ao Discord quem continua na guild e, para as contas ausentes, derruba as sessões, remove os papéis e marca left_guild_at — nunca tocando saldo, ledger ou saques (G6), nem o banimento (G9). Resiliência é o centro: falha na leitura do Discord aborta antes de qualquer consulta ao banco, e um disjuntor puro recusa a passada quando a lista vem vazia ou pequena demais; os dois casos têm teste. O provider de MAINTENANCE_CLEANUP fecha o encaixe deixado pela TASK-048, então POST /api/maintenance/cleanup passa a funcionar. A lista de membros do admin ganhou o selo 'Saiu do servidor' com data e autoria da limpeza automática. Gate verde (94 e2e, coverage 90%), security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
