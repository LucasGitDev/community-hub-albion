---
id: TASK-087
title: Chamar no privado quem se inscreveu e não entrou na call
status: To Do
assignee: []
created_date: '2026-09-21 13:02'
labels: []
milestone: m-12
dependencies:
  - TASK-085
priority: medium
type: feature
ordinal: 6845
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE12 a PE16 no doc-005. Ao iniciar o evento, quem está na sala de espera é movido para a call (já acontece). Quem se inscreveu como **confirmado** e não está na call recebe **mensagem no privado** pedindo para entrar.

Quem está na lista de espera não recebe (PE13). Privado fechado cai para menção no chat da call, com a lista de quem não pôde ser avisado (PE14).

O mesmo chamado é acionável pelo menu do evento no painel e pelo menu da call no Discord, com intervalo de 5 minutos por pessoa (PE15). **Substitui** o "chamar os ausentes" da TASK-085, que era menção no chat (PE16).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Iniciar o evento envia privado a cada confirmado que não está na call
- [ ] #2 Quem está na lista de espera não recebe privado
- [ ] #3 Quem está com o privado fechado é mencionado no chat da call, numa mensagem só, com a lista
- [ ] #4 O caller aciona o mesmo chamado pelo menu do evento no painel
- [ ] #5 O caller aciona o mesmo chamado pelo menu da call no Discord
- [ ] #6 Chamar a mesma pessoa de novo em menos de 5 minutos não envia privado repetido
- [ ] #7 Falha de envio no privado nunca derruba o início do evento
- [ ] #8 Cada chamado publica na timeline com quem acionou e quantos foram avisados
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
