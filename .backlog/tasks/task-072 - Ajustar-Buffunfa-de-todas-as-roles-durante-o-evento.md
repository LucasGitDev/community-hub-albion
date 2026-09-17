---
id: TASK-072
title: Ajustar Buffunfa de todas as roles durante o evento
status: To Do
assignee: []
created_date: '2026-09-17 19:59'
labels: []
milestone: m-12
dependencies: []
priority: high
type: feature
ordinal: 7020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje o valor de Buffunfa por role é editável durante todo o ciclo do evento (só trava depois de pago, `setEventRoleBuffunfa`), mas de dois jeitos inconvenientes: **uma role por vez** e **preso à faixa que o template definiu**.

O caso real que o usuário descreveu: no geral todas as roles ganham o mesmo X desde o início, e depois isso muda. Com o desenho atual, isso é uma edição por role, repetida, e impossível de levar acima do máximo do template — inclusive em template antigo, que veio com faixa 0 a 0 (F6-51) e por isso não paga nada.

O que muda: um ajuste em lote ("todas as roles recebem X") e a faixa do template deixando de ser teto rígido do evento, passando a ser **sugestão de partida**. O teto que continua valendo é o do sistema (`BUFFUNFA_ROLE_MAX`), que existe para evitar erro de digitação, não para limitar o caller.

Isto revisa as decisões F6-8 e F6-48 por pedido do usuário em 2026-09-17: a faixa obrigatória foi desenhada para conter inflação, mas na prática virou atrito para quem organiza o evento, que é quem sabe quanto o conteúdo vale naquele dia.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O caller define um valor de Buffunfa para todas as roles do evento de uma vez
- [ ] #2 O valor de uma role específica continua editável individualmente depois do ajuste em lote
- [ ] #3 O valor do evento aceita qualquer inteiro entre zero e o teto do sistema, independente da faixa do template
- [ ] #4 A faixa do template continua servindo de valor inicial do evento
- [ ] #5 Depois de pago, o valor segue congelado e o ajuste é recusado com motivo
- [ ] #6 Evento criado a partir de template antigo, com faixa zerada, consegue pagar Buffunfa
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
