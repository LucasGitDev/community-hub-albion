---
id: TASK-085
title: Menu de gestão da call no Discord
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 13:19'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: feature
ordinal: 6850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE9 a PE11 no doc-005. Ao criar o canal de voz do evento, o bot publica no chat de texto dele um menu de gestão.

Opções: **finalizar o evento**, **fechar a call**, **abrir a call** e **chamar os ausentes** (ping em quem se inscreveu e não entrou). Iniciar evento e encerrar inscrições não entram — a call só existe depois disso.

Fechar a call é tirar a permissão de entrar de quem não está inscrito, deixando quem já está dentro (PE10). O menu é visível para todos, então a checagem é no clique: só caller do evento e staff executam (PE11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ao criar a call, o bot publica o menu no chat de texto do canal de voz
- [x] #2 Finalizar o evento pelo menu faz o mesmo que finalizar pelo painel, passando pelo mesmo serviço
- [x] #3 Fechar a call impede a entrada de quem não está inscrito e não remove ninguém que já está dentro
- [x] #4 Abrir a call desfaz o fechamento
- [x] #5 Quem não é caller do evento nem staff recebe recusa ao clicar, e nada é executado
- [x] #6 Cada ação do menu publica na timeline com quem clicou
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. domain/event-call-menu.ts puro: ids dos 3 botões, EmbedView do menu, copy PT-BR das recusas e a seleção de quem continua podendo entrar com a call fechada.
2. event-voice.gateway.ts: duas operações novas na porta — postar o menu no chat de texto do canal de voz e editar a sobrescrita de Connect (fechar/abrir). Erro do Discord sobe para o chamador traduzir.
3. event-voice.service.ts: depois de criar e gravar o canal, publica o menu; falha só loga e o start segue (PE9).
4. bot/event-call.interactions.ts: 3 @Button. Checagem no clique (PE11): discordId → userId → CASL finish/update Event com ownerId, contra o evento recarregado. Finalizar chama EventsService.transition('finish') — mesmo serviço do painel. Fechar/abrir mexem só em permissão do canal (PE10, sem estado novo).
5. Timeline: finish já publica event.finished pelo serviço com o ator do clique; fechar/abrir publicam event.call_locked / event.call_unlocked.
6. Testes: domínio puro + interações com Postgres real, Discord falso e FakeTimelinePublisher.
7. Gate completo com E2E_PORT=4193.
Fora de escopo (mudança do usuário): 'chamar os ausentes' virou TASK-087 (PE12 a PE16).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Escopo reduzido em 2026-09-21: 'chamar os ausentes' saiu do menu e virou a TASK-087 (privado para cada confirmado ausente, com queda para menção, intervalo de 5 min e gatilho também no painel — PE12 a PE16). O menu fica com finalizar o evento, fechar a call e abrir a call.

## Entrega

Menu de gestão da call no chat de texto do canal de voz do evento (PE9 a PE11), com **três** ações:
finalizar o evento, fechar a call e abrir a call. "Chamar os ausentes" saiu do escopo no meio da task
(virou TASK-087, PE12 a PE16) e foi **removido** do código e dos testes, não desligado.

- `apps/server/src/domain/event-call-menu.ts` (puro): ids dos botões, embed do menu, copy das recusas e
  a seleção de quem continua podendo entrar com a call fechada.
- `apps/server/src/bot/event-call.interactions.ts`: os três @Button. Autorização **no clique** (PE11):
  `interaction.user.id` → usuário do painel → papéis → CASL contra o evento **recarregado agora**. O
  custom id carrega só o id do evento, nunca quem pode.
- `apps/server/src/bot/event-voice.gateway.ts`: duas operações novas na porta (publicar no chat do canal
  de voz; editar a sobrescrita de `Connect`). `EventVoiceService` publica o menu logo depois de criar e
  gravar o canal; falha só loga e o start segue.

## Decisões tomadas aqui (fora do doc-005)

1. **"Call fechada" não virou campo do evento.** É a sobrescrita de `Connect` do canal: negar para
   `@everyone` e liberar os inscritos um a um. Abrir apaga as duas coisas. Nenhuma migration.
2. **Quem fica liberado com a call fechada é todo inscrito ativo, inclusive a lista de espera.** A porta
   não é a lista do evento: quem está na espera pode virar confirmado no meio e não pode ficar trancado
   do lado de fora.
3. **Ação CASL por botão:** finalizar usa `finish` (a mesma do painel e do /evento encerrar); fechar e
   abrir usam `update` em Event. Nos dois casos a condição `ownerId` dá exatamente caller do evento +
   staff, sem permissão nova.
4. **Finalizar não reimplementa nada:** chama `EventsService.transition(id, "finish", userId)`, então o
   canal de voz, o embed e a linha `event.finished` saem do mesmo hook do painel.

## Tabela de evidência

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 menu publicado ao criar a call | `event-call.interactions.test.ts` "AC#1: criar a call publica o menu no chat de texto do próprio canal de voz" (afirma o canal e o título) + `event-voice.service.test.ts` "falha ao publicar o menu de gestão não impede o start" | ✅ |
| AC#2 finalizar = mesmo serviço do painel | `event-call.interactions.test.ts` "AC#2…": depois do clique o evento fica `finished`, a galera volta para Aguardando Evento e o canal é apagado — tudo pelo hook do serviço | ✅ |
| AC#3 fechar bloqueia não inscrito e não remove ninguém | `event-call.interactions.test.ts` "AC#3…": não inscrito que já estava dentro continua no canal e perde só a permissão de entrar | ✅ |
| AC#4 abrir desfaz | `event-call.interactions.test.ts` "AC#4…": sobrescrita volta a nula e o não inscrito volta a poder entrar (clique da staff) | ✅ |
| AC#5 recusa para quem não é caller nem staff | `event-call.interactions.test.ts` "AC#5…": os três botões respondem a recusa e nada muda (sem sobrescrita, evento segue running, timeline vazia) | ✅ |
| AC#6 timeline com quem clicou | mesmos testes: `event.finished`, `event.call_locked` e `event.call_unlocked` com `actor.discordId` de quem clicou; recusa e falha do Discord publicam zero | ✅ |
| DoD#1 gate | `.quality/summary.md` colado abaixo — verde | ✅ |
| DoD#2 evidência por AC | tabela acima, toda em teste executado | ✅ |
| DoD#3 skills | `task-done-check`, `security-review` | ✅ |
| DoD#4 UI alterada | **não se aplica**: nenhuma tela do painel mudou; a superfície nova é embed do Discord | — |
| DoD#5 doc-005 | PE9 (menu ao criar a call, sem iniciar/fechar inscrição), PE10 (fechar é permissão, não expulsão), PE11 (checagem no clique). PE12 a PE16 ficaram fora, na TASK-087 | ✅ |
| DoD#7 timeline pós-commit | `publishAfterCommit` depois da operação; falha ao montar vira aviso e não derruba | ✅ |

## Quality gate (local, commit 67ca40bb)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 87.59% | ≥ 79% | ✅ |
| E2E + screenshots | 156 ok, 0 falha, 0 flaky (porta 4193) | 0 falhas | ✅ |
| Imagem Docker | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 2.23% | ≤ 15% | ✅ |
| Dead code | 10 (advisory, todos pré-existentes) | 0 advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

## Achado fora do escopo, corrigido junto

`e2e/shop.spec.ts` reprovou na primeira rodada do gate: dois testes do arquivo publicam um item com o
mesmo nome base e, **no mesmo worker**, compartilham o sufixo `RUN`, então o locator do card casava com
dois itens. Só aparece com `E2E_WORKERS=2` (com mais workers os testes caem em processos diferentes e o
timestamp muda). Corrigido com um contador no sufixo, em commit próprio (`fix(e2e)`).

## Security review (DoD#6)

Rodado sobre o diff da branch: **nenhum achado crítico**. O que foi conferido: o custom id do botão não
é fonte de autoridade (quem clicou vem de `interaction.user.id`, o id do evento é só chave de leitura e
passa por `isUuid`); o CASL é o mesmo padrão do controller e do comando; a autorização vem **antes** de
qualquer escrita e antes do check de estado; todo caminho de erro fecha sem executar; a lista de
liberados sai de `listEventSignupMembers` (só inscrição ativa), sem caminho para liberar não inscrito;
respostas sempre efêmeras e sem id interno.

Uma observação de baixa severidade foi **corrigida** em commit próprio (`fix(bot)`): fechar a call
abortava no primeiro inscrito recusado pelo Discord (quem saiu do servidor), deixando o `@everyone` já
negado e o resto dos inscritos sem liberação — trancados do lado de fora. Agora a porta é aplicada
primeiro, cada inscrito é tratado por conta própria, e o número de recusados volta para quem clicou e
para a timeline. Teste: "inscrito recusado pelo Discord não aborta os outros".

Gate re-rodado depois da correção (commit f06f928): verde, 0 lint, 87.55% branch coverage, 156 e2e ok.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
O canal de voz do evento nasce com um menu de gestão no próprio chat de texto: finalizar o evento, fechar a call e abrir a call (PE9 a PE11). Finalizar passa pelo mesmo EventsService.transition do painel, então o canal, o embed e a timeline saem do mesmo hook. Fechar a call é só permissão — nega Connect para @everyone e libera os inscritos —, sem estado novo, sem migration e sem remover quem já está dentro (PE10). O menu é visível para todos, então a autorização é no clique, via CASL contra o evento recarregado: só caller do evento e staff executam, e a recusa não escreve nada (PE11). Verificado com testes contra Postgres real e Discord falso, um por AC, provando também a timeline com quem clicou, a recusa de evento já finalizado e a falha de permissão do canal virando mensagem sem derrubar o evento. Chamar os ausentes saiu do escopo no meio da task e virou a TASK-087.
<!-- SECTION:FINAL_SUMMARY:END -->
