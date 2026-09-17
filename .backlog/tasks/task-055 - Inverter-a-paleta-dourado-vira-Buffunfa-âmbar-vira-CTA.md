---
id: TASK-055
title: 'Inverter a paleta: dourado vira Buffunfa, âmbar vira CTA'
status: To Do
assignee: []
created_date: '2026-09-17 17:03'
updated_date: '2026-09-17 17:08'
labels: []
milestone: m-6
dependencies: []
documentation:
  - .backlog/docs/doc-009 - Identidade-Toca-da-Turma-e-Buffunfa.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje o token --brand é o dourado e serve de CTA primário e número-chave (TASK-036), enquanto --warning é âmbar. A identidade decidida no doc "Identidade: Toca da Turma e Buffunfa" inverte isso: dourado passa a significar Buffunfa, o destaque de ação migra para âmbar, e a prata deixa de usar dourado e passa a cinza/prateado. É a primeira task da F6 de propósito (decisão F6-29): as telas novas da fase nascem com a paleta certa, e o diff isolado é revisável por screenshot — o que um diff misturado com feature nova não seria. Não toca lógica nenhuma, então roda em paralelo com o resto da fase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O token --brand passa a representar Buffunfa (dourado) e o CTA primário usa âmbar, em tema claro e escuro
- [ ] #2 Todo valor em prata é renderizado em cinza/prateado, sem dourado em nenhuma tela
- [ ] #3 O tipo Tone de apps/web/src/components/display.tsx reflete o novo mapeamento e continua sendo o ponto único de cor semântica
- [ ] #4 Nenhum componente ou texto novo é introduzido: o diff é só de cor
- [ ] #5 Revisão visual por screenshot (1280 e 400) nas telas que usam brand ou warning, no papel afetado, conforme a decisão N7
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
