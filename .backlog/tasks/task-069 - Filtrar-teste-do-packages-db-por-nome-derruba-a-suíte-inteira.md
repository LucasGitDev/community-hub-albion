---
id: TASK-069
title: Filtrar teste do packages/db por nome derruba a suíte inteira
status: To Do
assignee: []
created_date: '2026-09-17 17:53'
updated_date: '2026-09-17 23:05'
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
- [ ] #1 Rodar um único teste do packages/db por nome funciona, com as migrations aplicadas
- [ ] #2 A suíte completa continua verde e não fica mais lenta de forma perceptível
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reincidente: apareceu de novo na TASK-066 (2026-09-17), agora com o sintoma 'relation users does not exist' num banco novo. Terceira vez que custa tempo de quem está depurando — dois agents diferentes caíram nela. Sobe de prioridade se acontecer mais uma vez.
<!-- SECTION:NOTES:END -->
