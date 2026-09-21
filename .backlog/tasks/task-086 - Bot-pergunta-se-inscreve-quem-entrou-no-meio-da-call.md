---
id: TASK-086
title: Bot pergunta se inscreve quem entrou no meio da call
status: In Progress
assignee: []
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 16:40'
labels: []
milestone: m-12
dependencies:
  - TASK-084
  - TASK-085
priority: medium
type: feature
ordinal: 6840
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE7 e PE8 no doc-005. Alguém entra na call do evento sem estar inscrito; o bot pergunta **no chat de texto do próprio canal de voz** se deve inscrever, com botões *Inscrever* e *Ignorar*.

Sem resposta, nada acontece: silêncio não vira inscrição (PE7). A contagem de presença dessa pessoa **começa no aceite** (PE8), não em quando ela entrou na call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Entrada de alguém não inscrito na call do evento gera a pergunta no chat do canal de voz
- [ ] #2 Inscrever coloca a pessoa no evento, com escolha de role quando há vaga
- [ ] #3 Ignorar encerra a pergunta sem inscrever
- [ ] #4 Sem resposta, a pessoa continua sem inscrição e sem presença contada
- [ ] #5 A presença de quem foi aceito conta a partir do aceite, não da entrada na call
- [ ] #6 Só caller do evento e staff conseguem responder; outros recebem recusa
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
