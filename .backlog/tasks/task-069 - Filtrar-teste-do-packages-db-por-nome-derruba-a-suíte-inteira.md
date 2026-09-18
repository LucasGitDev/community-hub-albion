---
id: TASK-069
title: Filtrar teste do packages/db por nome derruba a suíte inteira
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:53'
updated_date: '2026-09-18 13:55'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: bug
ordinal: 7090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado na TASK-065. Nos testes de integração do `packages/db`, quem aplica as migrations é o **primeiro teste do arquivo**, enquanto o `beforeAll` derruba e recria o schema. Rodar com `vitest -t "<nome>"` pula esse primeiro teste, as migrations nunca rodam, e todos os outros falham em cascata com erro de tabela inexistente.

O efeito prático é que o loop rápido de quem está depurando um teste específico não funciona: filtrar por nome é a primeira coisa que qualquer um tenta, e o erro que aparece não aponta para a causa. Perde-se tempo procurando um defeito que não existe.

As migrations deveriam ser aplicadas no `beforeAll`, junto da recriação do schema, e não depender da ordem de execução.

Relacionado, do mesmo achado: os testes de integração não isolam nomes por execução (usam nomes fixos) e só sobrevivem porque o `beforeAll` recria tudo. Encostar nisso junto é razoável, mas não é obrigatório.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rodar um único teste do packages/db por nome funciona, com as migrations aplicadas
- [x] #2 A suíte completa continua verde e não fica mais lenta de forma perceptível
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Diagnóstico: só packages/db/src/db.integration.test.ts aplica migrations dentro do 1º it(); os outros 11 arquivos do db e todos os testes de banco do apps/server já migram no beforeAll (conferido).
2. RED: vitest -t com testes do meio do db.integration (dois describes diferentes) falha com relation does not exist.
3. Mover runMigrations para o beforeAll após recriar o schema; o 1º teste passa a provar só a idempotência (continua do zero, pois o beforeAll parte de schema vazio).
4. GREEN com os mesmos comandos; comparar tempo da suíte do db antes/depois.
5. task-done-check, pnpm quality, PR com a prova.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reincidente: apareceu de novo na TASK-066 (2026-09-17), agora com o sintoma 'relation users does not exist' num banco novo. Terceira vez que custa tempo de quem está depurando — dois agents diferentes caíram nela. Sobe de prioridade se acontecer mais uma vez.

Diagnóstico: só packages/db/src/db.integration.test.ts migrava dentro do 1º it(). Os outros 11 arquivos *.integration.test.ts do db e todos os testes de banco do apps/server já migram no beforeAll (conferido por grep/awk); nada a extrair, a correção é num único arquivo. Por isso o RED só reproduz ali; ledger.integration filtrado já passava antes.

RED (antes):
$ pnpm exec vitest run src/db.integration.test.ts -t "upsert por discord_id atualiza o mesmo usuário"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
Caused by: PostgresError: relation "users" does not exist
 Test Files  1 failed (1)
      Tests  1 failed | 69 skipped (70)

$ pnpm exec vitest run src/db.integration.test.ts -t "cria e edita role"
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
Caused by: PostgresError: relation "event_roles" does not exist
 Test Files  1 failed (1)
      Tests  1 failed | 69 skipped (70)

$ pnpm exec vitest run src/ledger.integration.test.ts -t "TRUNCATE é rejeitado pelo banco"
 Test Files  1 passed (1)
      Tests  1 passed | 22 skipped (23)

GREEN (depois):
$ pnpm exec vitest run src/db.integration.test.ts -t "upsert por discord_id atualiza o mesmo usuário"
 Test Files  1 passed (1)
      Tests  1 passed | 69 skipped (70)

$ pnpm exec vitest run src/db.integration.test.ts -t "cria e edita role"
 Test Files  1 passed (1)
      Tests  1 passed | 69 skipped (70)

$ pnpm exec vitest run src/db.integration.test.ts -t "conecta e executa consultas"
 Test Files  1 passed (1)
      Tests  1 passed | 69 skipped (70)

Tempo da suíte do packages/db (261 testes): antes 3.32/3.44/3.62/4.47/5.17/4.36s, depois 3.45/3.87/3.46/3.56s (uma rodada de 41s coincidiu com load 9, descartada).

Gate (pnpm quality, commit 4a3be90): ⚠️ passou com avisos. Lint 0, race 0, typecheck ok, coverage branch 87.52%, e2e 146 ok na porta 4184, Docker ok, duplicação 2.27%, vulns 0; dead code 10 itens advisory pré-existentes, nenhum tocado aqui.
Skills: task-done-check. Sem UI (DoD#4 n/a), sem auth/ledger/prata/saque (DoD#6 n/a); nenhuma Q do doc-005 envolvida.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrations do db.integration.test.ts passam a rodar no beforeAll, depois de recriar o schema; o primeiro teste só prova idempotência. vitest -t com qualquer teste do arquivo agora funciona (RED/GREEN nas notas), suíte completa verde sem ganho de tempo perceptível.
<!-- SECTION:FINAL_SUMMARY:END -->
