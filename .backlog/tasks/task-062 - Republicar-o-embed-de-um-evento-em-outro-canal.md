---
id: TASK-062
title: Republicar o embed de um evento em outro canal
status: To Do
assignee: []
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 17:09'
labels:
  - eventos
  - discord
  - bot
milestone: m-12
dependencies:
  - TASK-061
priority: medium
type: feature
ordinal: 7300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje o embed de evento vive num canal só, fixo em `DISCORD_EVENTS_CHANNEL_ID` (TASK-022). O caller precisa chamar gente que acompanha outros canais (conteúdo específico, aliados, canal de avisos) sem mandar todo mundo para o canal de eventos.

Comando do bot que publica o embed de um evento existente em outro canal. A cópia não é um print: é a mesma mensagem viva — botões de role funcionam e a lista se atualiza junto com a original a cada mudança de inscrição.

Depende do código visual do evento (TASK-061): com o mesmo evento em dois canais, quem lê precisa ver que é o mesmo evento.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Comando do bot publica o embed de um evento existente num canal informado, identificando o evento pelo código curto
- [ ] #2 Os botões de role da cópia funcionam igual aos da original: inscrever, trocar de role e sair
- [ ] #3 Qualquer mudança na lista (join, leave, move, promoção da espera) atualiza todas as publicações daquele evento, não só a primeira
- [ ] #4 Mudança de estado do evento (fechar, iniciar, finalizar, cancelar) reflete em todas as publicações
- [ ] #5 Republicar no mesmo canal duas vezes não cria duas mensagens: edita a que já existe
- [ ] #6 Canal inválido, sem permissão do bot, ou evento inexistente devolve recusa clara e não deixa publicação órfã no banco
- [ ] #7 Só quem já pode mexer no evento (caller/owner/staff) pode republicar
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
