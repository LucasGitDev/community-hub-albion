---
id: TASK-071
title: Buffunfa com ícone no painel e identidade visual do servidor
status: To Do
assignee: []
created_date: '2026-09-17 19:59'
labels: []
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-009 - Identidade-Toca-da-Turma-e-Buffunfa.md
priority: high
type: feature
ordinal: 7010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Os assets versionados em `assets/` foram entregues pelo usuário para o site e para o Discord, mas só o emoji do Discord os usa (`BUFFUNFA_EMOJI_FILE`). No painel, a Buffunfa aparece apenas como o texto ` BUF`, e o doc-009 diz o contrário: "no painel, o PNG como ícone inline junto do número".

Além disso o painel ainda não é a Toca da Turma: o favicon é um SVG genérico embutido no `index.html` e o `<title>` é "albion-hub".

Escopo: usar `assets/buffunfa_simples_512.png` como ícone da moeda no painel, junto de todo valor em Buffunfa, e vestir a identidade do servidor (favicon e título). O helper de formatação já existe em `packages/shared/src/currency.ts` e o componente único de valor é `<Amount>` — o ícone entra lá, num lugar só, não espalhado por tela.

Cuidado com o peso: 318 KB para um ícone de 16px é desperdício. Gerar versões pequenas a partir do PNG de origem, ou converter para um formato adequado ao tamanho de uso.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Todo valor em Buffunfa no painel aparece com o ícone da moeda ao lado do número
- [ ] #2 O ícone vem dos assets versionados, em tamanho adequado ao uso (não o PNG de 512 px cru)
- [ ] #3 O favicon e o título do painel são os da Toca da Turma, não o placeholder
- [ ] #4 Prata continua sem ícone e neutra: a distinção entre as moedas não depende só da cor
- [ ] #5 Revisão visual por screenshot em 1280 e 400 nas telas com saldo, extrato e loja
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
