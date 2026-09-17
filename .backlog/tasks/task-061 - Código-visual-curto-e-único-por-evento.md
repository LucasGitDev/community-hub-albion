---
id: TASK-061
title: Código visual curto e único por evento
status: To Do
assignee: []
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 17:08'
labels:
  - eventos
  - discord
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
type: feature
ordinal: 7200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje um evento só é identificável pelo nome do template e pelo horário. Quando a mesma mensagem de evento passa a aparecer em mais de um canal do Discord (ver task de republicar embed), e quando dois eventos do mesmo conteúdo acontecem no mesmo dia, ninguém consegue dizer de qual evento se está falando — no canal, no ticket da staff ou na conversa em voz.

Cada evento ganha um código curto, único e legível em voz alta (ex.: `#A7K2`), gerado na criação e imutável. Ele aparece no título/rodapé do embed, na tela de eventos do painel e é aceito como identificador nos comandos do bot no lugar do UUID.

Pré-requisito prático da task de republicar o embed em outro canal: sem código, a mesma mensagem em dois canais vira dois eventos aos olhos de quem lê.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Todo evento criado recebe um código curto único, gerado uma vez e nunca alterado depois
- [ ] #2 O código é legível em voz alta: sem caracteres ambíguos entre si (0/O, 1/I/l) e sem gerar palavrão
- [ ] #3 Eventos já existentes na base recebem código na migration, sem colisão
- [ ] #4 O código aparece no embed do Discord e na tela de eventos do painel (lista e detalhe)
- [ ] #5 Os comandos do bot que hoje pedem identificador de evento aceitam o código, com e sem o `#`, sem diferenciar maiúsculas
- [ ] #6 Código inexistente devolve recusa clara, não erro genérico
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
