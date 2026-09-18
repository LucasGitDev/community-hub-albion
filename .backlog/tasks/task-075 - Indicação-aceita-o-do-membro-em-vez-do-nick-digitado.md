---
id: TASK-075
title: Indicação aceita o @ do membro em vez do nick digitado
status: To Do
assignee: []
created_date: '2026-09-18 03:01'
labels: []
milestone: m-11
dependencies: []
priority: high
type: enhancement
ordinal: 7016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pedido do usuário: o comando de indicação tem que aceitar o @ do membro, para facilitar escrever.

No Discord, uma opção de slash command do tipo **usuário** abre o seletor de membros ao digitar @ — a pessoa escolhe da lista, não digita. Isso resolve de quebra o ponto fraco que o desenho da TASK-074 tinha assumido: com a chave digitada, nick errado virava indicação perdida. Com o seletor, o indicador é identificado pelo ID do Discord, que não tem grafia.

Vale para os dois caminhos: a opção do /registrar e o /indicacao.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O /indicacao recebe o indicador pelo seletor de membros do Discord (@)
- [ ] #2 A opção de indicação do /registrar também usa o seletor de membros
- [ ] #3 Indicar alguém que ainda não tem conta no painel é recusado dizendo que essa pessoa precisa entrar no painel primeiro
- [ ] #4 Autoindicação pelo @ continua recusada
- [ ] #5 As demais regras da TASK-074 (write-once, pagamento, teto) seguem iguais
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
