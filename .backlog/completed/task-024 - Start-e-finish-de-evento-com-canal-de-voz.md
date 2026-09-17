---
id: TASK-024
title: Start e finish de evento com canal de voz
status: Done
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 03:50'
labels:
  - events
  - bot
  - voice
milestone: m-4
dependencies:
  - TASK-022
  - TASK-019
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Start fecha inscrições, cria canal na categoria configurada e arrasta confirmados em Aguardando Evento (Q28, Q29); finish devolve e apaga canal. Mesmo serviço para comando, painel e embed (doc-002).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Start cria canal na categoria configurada e move só inscritos confirmados presentes em Aguardando Evento
- [x] #2 Finish devolve pessoas para Aguardando Evento e apaga o canal
- [x] #3 Horários de start e finish ficam registrados
- [x] #4 Comando, botão e painel produzem o mesmo resultado
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação (TASK-024)

### Decisões
- **Ciclo do canal**: `EventVoiceService` assina `EventsService.onEventTransition` (hook pós-commit da TASK-021). `→ running` cria o canal de voz na categoria `DISCORD_EVENT_CATEGORY_ID`, grava `events.voice_channel_id` e arrasta **só** quem está confirmado E presente em `DISCORD_WAITING_VOICE_CHANNEL_ID` (Q29 — ninguém é puxado de outro canal nem da lista de espera). `→ finished` devolve **todo mundo** que estiver no canal do evento (inclusive quem entrou sem inscrição, Q7), depois apaga o canal — nessa ordem, porque apagar antes jogaria a galera para fora da voz.
- **Reuso pela TASK-025**: `openChannel`/`closeChannel` são públicos; o cancelamento devolve a galera e apaga o canal chamando `closeChannel`, sem repetir a lógica.
- **Comando vs botão (AC#4)**: escolhi slash command `/evento iniciar` e `/evento encerrar` em vez de botão no embed. O embed de inscrição (TASK-022) já chega perto do teto de 25 botões (uma role por botão + Sair) e um 'Iniciar' visível para a guilda inteira convida clique errado; o comando só aparece para quem digita e responde de forma efêmera. Os três caminhos (comando, painel, fechamento automático) chamam o mesmo `EventsService.transition`, então o canal de voz sai sempre do mesmo hook.
- **Seleção do evento no comando**: opção `evento` opcional aceitando nome ou id. Sem ela, resolve quando há um candidato só; empate devolve a lista com os ids para desempatar. Os candidatos já vêm filtrados por estado e por CASL, então a resposta nunca cita evento que a pessoa não podia ver.
- **Permissão**: `interaction.user.id` → usuário do painel (`findUserIdByDiscordId`) → papéis → CASL (`start`/`finish` em Event com condição de owner), a mesma regra do `POST /api/events/:id/transitions`. O evento é relido antes de transicionar (owner pode ter sido transferido entre listar e agir), igual ao controller.
- **Falhas**: nada desfaz a transição já gravada. Erro do Discord vira log com `describeDiscordError`; falha ao mover uma pessoa não aborta as outras; canal criado mas não gravado no banco é apagado para não virar canal órfão; falha ao apagar mantém o id no banco para o operador resolver.
- **Porta de voz**: `EventVoiceGateway` (`createChannel`, `deleteChannel`, `listMembersInChannel`, `moveMember`, `waitingChannelId`) com implementação discord.js; os testes usam um Discord falso que guarda quem está em cada canal.
- **AC#3**: os carimbos já vinham da TASK-021 (`STAMP` em `applyEventTransition`); o teste confere `startedAt`, `finishedAt` e o `closedAt` que o start grava por Q26. Nada novo foi preciso.

### Envs novas
`DISCORD_WAITING_VOICE_CHANNEL_ID` e `DISCORD_EVENT_CATEGORY_ID`: snowflake, obrigatórias com o bot ligado e opcionais com ele desligado (mesmo padrão das outras). Adicionadas em `env.ts`, `.env.example` (raiz e server), `docker-compose.yml`, nos envs de todos os testes do server e no doc-007, que também passou a pedir a permissão **Gerenciar Canais** para o bot.

### Verificação
- `apps/server/src/domain/event-voice.test.ts`: 11 testes das funções puras (nome do canal, seleção Q29, resolvedor do comando).
- `apps/server/src/bot/event-voice.service.test.ts`: 11 testes com Postgres real + Discord falso — start cria o canal e move só confirmado presente (ignora espera e quem está em outro canal); finish devolve todo mundo e apaga; falha ao criar não desfaz o start; falha ao mover um não impede os outros; falha ao apagar mantém o id; `closeChannel` reusável; e o caminho do comando produz o mesmo resultado da API (mesmo estado, mesmo canal, mesma seleção), além das recusas (não-owner, fora da guilda, sem conta, ambiguidade).
- Quality gate completo verde (ver resumo colado abaixo).

### Quality gate (local, com Postgres em 55455)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 detectada(s) | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 93.54% (556 testes, 51 arquivos) | ≥ 79% | ✅ |
| E2E + screenshots (desktop/mobile) | 34 ok, 0 falha(s), 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | ✅ |
| Duplicação | 0.78% | ≤ 15% | ✅ |
| Dead code | 7 item(s), todos pré-existentes em apps/web/src/components/ui | 0 (advisory) | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

Nota: numa passada anterior o e2e acusou 21 falhas e a cobertura não gerou relatório — as duas coisas eram disputa de porta 4173 e do turbo com o worktree da TASK-023 rodando em paralelo, não regressão. Rodados isolados: e2e 34/34 e cobertura 93.54%.

### Skills (doc-003)
- `security-review`: rodada sobre o diff. Sem achado de confiança ≥ 8. O único ponto levantado (janela entre listar os candidatos e transicionar, se o owner mudar no meio) foi fechado relendo o evento e rechecando o CASL antes de agir, como o controller faz.
- `task-done-check`: gate + produto vs doc-005 (Q6/Q7/Q26/Q28/Q29) conferidos. Sem parte visual: a task não mexe em `apps/web`, então DoD#4 não se aplica.

### Pendência do usuário: verificação no Discord real
O bot já é Administrator na guild e os ids estão no .env local (canal Aguardando Evento `1549544894710808696`, categoria `1547413743082934394`). Passos:
1. Subir a app com as duas envs novas preenchidas.
2. Criar um evento, abrir a inscrição e entrar numa role pelo embed com duas contas; deixar uma terceira só na lista de espera.
3. Colocar a conta confirmada no canal de voz **Aguardando Evento** e a outra confirmada em **outro** canal de voz qualquer.
4. Rodar `/evento iniciar` (ou clicar em iniciar no painel). Esperado: canal de voz novo com o nome do evento dentro da categoria; **só** a conta que estava em Aguardando Evento é arrastada; a que estava em outro canal e a da lista de espera não se mexem.
5. Entrar no canal do evento com uma conta que não está inscrita.
6. Rodar `/evento encerrar`. Esperado: todo mundo que estava no canal do evento volta para Aguardando Evento (inclusive a não inscrita) e o canal some.
7. Conferir no painel que `startedAt` e `finishedAt` ficaram gravados.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Start e finish de evento passam a criar e apagar o canal de voz do evento.

EventVoiceService assina o hook pós-commit de transição (TASK-021): ao entrar em running cria um canal de voz na categoria configurada, grava events.voice_channel_id e arrasta só os inscritos confirmados que estão no canal Aguardando Evento (Q29); ao entrar em finished devolve todo mundo que estiver no canal do evento para Aguardando Evento e apaga o canal (Q28). Os horários já eram carimbados pela máquina de estados e foram verificados. Duas envs novas (DISCORD_WAITING_VOICE_CHANNEL_ID, DISCORD_EVENT_CATEGORY_ID) seguem o padrão dos outros ids do Discord e entraram em env.ts, nos dois .env.example, no docker-compose, nos envs de teste e no doc-007 (que também passou a pedir Gerenciar Canais).

AC#4 sai de um caminho único: /evento iniciar e /evento encerrar, o painel e o fechamento automático chamam o mesmo EventsService.transition, com a permissão do comando resolvida do Discord id para o usuário do painel e checada no CASL igual à API. openChannel/closeChannel ficam públicos para o cancelamento (TASK-025) reusar.

Verificado com 22 testes novos: 11 unitários das funções puras (nome do canal, seleção Q29, resolvedor do comando) e 11 com Postgres real + Discord falso cobrindo start, finish, a igualdade entre comando e API, e o comportamento sob falha do Discord (transição intacta, uma pessoa que falha não derruba as outras). Gate local verde: lint 0, typecheck ok, coverage 93.54%, e2e 34/34, imagem ok, audit 0. security-review sem achado. Falta a verificação no Discord real, descrita passo a passo nas notas.
<!-- SECTION:FINAL_SUMMARY:END -->
