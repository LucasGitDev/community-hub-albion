---
id: TASK-006
title: 'CI no GitHub Actions: lint, typecheck, test e build da imagem'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 05:40'
labels:
  - ci
  - infra
milestone: m-0
dependencies:
  - TASK-005
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repositório GitHub privado com Actions desde F0 (Q17), garantindo qualidade contínua.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PRs e pushes na branch principal disparam lint, typecheck, test e build da imagem
- [x] #2 Falha em qualquer etapa deixa o check vermelho
- [x] #3 Pipeline verde na branch principal
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
1. Check image no quality-gate.mjs: docker build + container smoke (SPA, /api 404 JSON, health). 2. Job image no workflow, summary depende dele. 3. Teste negativo local. 4. PR e verificar pipeline no PR e na main.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Check local image: pass ('build ok, SPA 200, /api 404 JSON, health ok'). Teste negativo: CMD quebrado no Dockerfile -> check image status fail, exit 1 (summary do CI falha em qualquer bloqueante).
Pipeline: PR/push na main disparam lint, typecheck, coverage (testes), e2e, audit, duplication, deadcode e image; job summary falha se algum bloqueante falhar.
Skills: task-done-check.

AC#3: pipeline da main verde após merge (run 34933388612: lint, typecheck, coverage, e2e, image, audit, duplication, deadcode, summary = success).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Quality gate do CI agora builda a imagem Docker e faz smoke no container; PR e push na main disparam todas as etapas e qualquer bloqueante deixa o summary vermelho. Verificado com teste negativo local e pipeline verde na main.
<!-- SECTION:FINAL_SUMMARY:END -->
