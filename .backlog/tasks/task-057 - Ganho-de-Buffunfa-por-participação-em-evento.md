---
id: TASK-057
title: Ganho de Buffunfa por participação em evento
status: To Do
assignee: []
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 17:09'
labels: []
milestone: m-6
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Primeira fonte de Buffunfa: comparecer a um evento. O valor é por role, dentro de uma faixa obrigatória do template, e o caller ajusta até o fechamento — serve para forçar o preenchimento de vaga escassa (faltam tanks, o caller sobe tank). A faixa é obrigatória, sem opção de deixar aberta, porque Buffunfa é criada do nada: caller generoso demais fura o sink e o ledger não volta atrás (F6-8).

Quem recebe é quem teve presença de pelo menos 90% do tempo de vida da call, no mesmo relógio que a prata já usa. A regra é binária: bateu os 90%, recebe o valor cheio. Proporcional em número de uma casa vira "2,7" e arredonda para nada — a prata é divisão de bolo, a Buffunfa é prêmio de comparecimento (F6-10).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O template de evento define uma faixa obrigatória de Buffunfa por role; não existe forma de deixá-la aberta
- [ ] #2 O caller ajusta o valor de uma role específica dentro da faixa, até o fechamento do evento
- [ ] #3 O valor vigente no fechamento vale para todos os participantes daquela role, inclusive quem se inscreveu antes de uma alteração
- [ ] #4 Recebe o valor cheio quem teve presença de 90% ou mais do tempo de vida do canal de voz; abaixo disso não recebe nada
- [ ] #5 Evento sem presence_channel_id não paga Buffunfa a ninguém, e a tela de fechamento avisa o caller disso antes de fechar
- [ ] #6 O pagamento gera lançamento de Buffunfa no ledger no fechamento, visível no extrato do membro
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
