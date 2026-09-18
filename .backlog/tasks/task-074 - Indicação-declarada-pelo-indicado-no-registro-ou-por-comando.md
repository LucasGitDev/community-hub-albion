---
id: TASK-074
title: 'Indicação declarada pelo indicado, no registro ou por comando'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 22:17'
updated_date: '2026-09-17 23:01'
labels: []
milestone: m-11
dependencies: []
priority: medium
type: feature
ordinal: 8100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parte da F11, com o desenho revisto pelo usuário em 2026-09-17: **sem link de convite**. O indicado declara quem o indicou, por dois caminhos que gravam a mesma coisa — campo opcional no comando de registro de nick, e um comando próprio para quem já se registrou e esqueceu.

O link único saiu porque obriga o jogador novo a chegar por um caminho específico; quem entra pelo convite normal do servidor perde a atribuição. Declarar é o gesto que a pessoa já está fazendo de qualquer jeito, e não cria tela no site — atrito para o jogador comum.

A troca tem um custo a tratar: a chave passa a ser digitada, não clicada. Nick que não existe, nick de quem saiu da guilda, e autoindicação viram casos de verdade em vez de impossíveis por construção.

Escopo: só a indicação. O giveaway é a outra metade da F11 e vai em task própria.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 O comando de registro aceita, opcionalmente, quem indicou; registrar sem isso continua funcionando igual
- [ ] #2 Existe comando próprio para declarar quem indicou depois do registro
- [ ] #3 Cada pessoa declara indicador uma vez só: a segunda tentativa é recusada com o que já está gravado
- [ ] #4 Autoindicação é recusada
- [ ] #5 Indicar quem não tem conta no painel é recusado com mensagem que diz o que fazer
- [ ] #6 O bônus é creditado ao indicador quando o nick do indicado é aprovado, não no instante da declaração
- [ ] #7 A partir da décima primeira indicação recompensada no mês, a indicação é registrada sem pagar
- [ ] #8 A staff enxerga as indicações de um membro e consegue estornar uma paga por engano
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Retomada (o que FALTA; db/shared/serviço/bot já escritos no resgate 3695d74):
1. Conferir compilação do que existe: build do shared, typecheck do db e do server; nick controller do painel (POST /api/me/nick) continua chamando register() e não muda.
2. Painel (AC#8): apps/web/src/api/referrals.ts + MemberReferralsDialog (quem indicou este membro, quem ele indicou, teto do mês, estorno com motivo) e botão na linha de /admin/membros gated por ability.can('read','Referral'); estorno só com can('reverse','Referral'). O MemberLedgerDialog fica como está — ele é declaradamente só leitura.
3. Testes de banco (referral-repo.test.ts): duas declarações simultâneas (uma grava), declaração no instante da aprovação (um pagamento só), 11ª do mês (indicado recebe, indicador não), indicador banido/fora, e UPDATE direto trocando referred_by falhando NO BANCO pela trigger.
4. Testes de serviço/bot: recusas (autoindicação, já declarou, indicador sem conta), /registrar sem indicação continua igual, /registrar com indicação declara, /indicacao declara depois.
5. Testes do controller de estorno (403/motivo obrigatório/estorno dobrado) e e2e do painel com E2E_PORT=4175 + screenshots 1280 e 400.
6. Commits atômicos (db, shared, server/bot, web, testes), skills task-done-check + emil-design-eng + security-review, pnpm quality completo, PR citando TASK-074.
<!-- SECTION:PLAN:END -->
