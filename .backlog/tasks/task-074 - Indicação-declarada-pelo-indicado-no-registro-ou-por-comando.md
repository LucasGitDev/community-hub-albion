---
id: TASK-074
title: 'Indicação declarada pelo indicado, no registro ou por comando'
status: To Do
assignee: []
created_date: '2026-09-17 22:17'
updated_date: '2026-09-17 22:22'
labels: []
milestone: m-11
dependencies: []
priority: high
type: feature
ordinal: 7015
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parte da F11, com o desenho definido pelo usuário em 2026-09-17: **sem link de convite**.

Cada usuário tem um campo dizendo quem o indicou. Preenchido uma vez, nunca troca. Dois caminhos gravam esse mesmo campo: uma opção no comando de registro de nick, e um comando próprio para quem já se registrou. Como o campo é do usuário e não da sessão de entrada, **indicação retroativa é o caso normal, não exceção** — não existe prazo para declarar.

O link único saiu porque obriga o jogador novo a chegar por um caminho específico. Quem entra pelo convite normal do servidor — a maioria — nunca passa pelo link, e a indicação deixa de existir mesmo tendo acontecido. Declarar registra o que de fato ocorreu, e não cria tela nenhuma no site: atrito para o jogador comum.

O custo da troca, que os critérios cobrem: a chave passa a ser **digitada**, não clicada. Nick que não existe, autoindicação e indicador que já saiu viram casos reais em vez de impossíveis por construção.

**Por que dá para fazer agora:** a única dependência era a moeda existir, e a Buffunfa entrou na F6. O giveaway continua sendo a outra metade da F11, em task própria.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O usuário tem um campo de quem o indicou, gravado uma vez e imutável depois
- [ ] #2 O comando de registro aceita, opcionalmente, quem indicou; registrar sem isso continua funcionando igual
- [ ] #3 Existe comando próprio para declarar quem indicou depois do registro, sem prazo para usar
- [ ] #4 Segunda tentativa de declarar é recusada, dizendo quem já está gravado
- [ ] #5 Autoindicação é recusada
- [ ] #6 Indicar quem não tem conta no painel é recusado com mensagem que diz o que fazer
- [ ] #7 O bônus é creditado quando a declaração e o nick aprovado do indicado existirem: o que acontecer por último dispara o pagamento
- [ ] #8 Declaração retroativa de quem já tem nick aprovado paga na hora
- [ ] #9 A partir da décima primeira indicação recompensada no mês, a indicação é registrada sem pagar
- [ ] #10 Indicador banido ou que saiu do servidor não recebe; a indicação fica registrada
- [ ] #11 A staff enxerga as indicações de um membro e consegue estornar uma paga por engano
- [ ] #12 O indicador recebe 10 BUF e o indicado recebe 2 BUF, no mesmo evento de pagamento
- [ ] #13 O teto mensal vale para o indicador; o indicado recebe os 2 BUF dele mesmo quando o indicador já estourou o teto
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
