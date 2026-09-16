---
id: TASK-025
title: Cancelamento de evento
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 03:41'
labels:
  - events
  - bot
milestone: m-4
dependencies:
  - TASK-024
priority: medium
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cancelar antes de running marca inscrições; em running devolve pessoas, apaga canal e fecha sessões; cancelado não aceita split (Q26).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cancelar antes de running marca inscrições como canceladas
- [x] #2 Cancelar em running devolve pessoas, apaga canal e fecha sessões no canal
- [x] #3 Evento finished não pode ser cancelado
- [x] #4 Membros veem o evento como cancelado no embed e painel
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared: eventCancelSchema (motivo opcional, 1–300 chars) + EventDto.cancelReason + copy do cancelamento; testes puros. Confirmar que finished→cancelled já é recusado pela máquina (AC#3).
2. db: coluna events.cancel_reason (migration) + applyEventTransition passa a receber o motivo e, quando to='cancelled', cancela TODA inscrição ativa (confirmed+waitlist) na MESMA transação da mudança de estado (AC#1). Novo closeOpenVoiceSessionsInChannel(db, channelId, at) no voice-repo (AC#2).
3. server: POST /api/events/:id/transitions/cancel aceita body opcional { reason }; EventsService.transition repassa. finished→cancelled continua 409 PT-BR (AC#3).
4. bot: EventVoiceService passa a tratar 'cancelled' reusando closeChannel (devolve todo mundo para Aguardando Evento + apaga o canal) e, logo depois, fecha as sessões de voz abertas naquele canal — sem duplicar a lógica do finish (AC#2). Embed: estado cancelado vira 'Evento cancelado' com o motivo, sem botões (AC#4).
5. bot: /evento cancelar com opção motivo, no mesmo caminho genérico de /evento iniciar|encerrar (mesmo serviço, mesma checagem CASL).
6. web: diálogo de cancelamento ganha campo de motivo; painel do membro e da staff mostram o evento cancelado com o motivo (AC#4).
7. Testes: db integration (inscrições canceladas, sessões fechadas, sem sessão órfã), HTTP (owner/staff cancelam por estado, membro 403, finished 409, efeito por estado draft/open/closed/running), bot com gateway falso (canal devolvido e apagado, falha logada sem desfazer), e2e desktop+mobile (caller cancela evento aberto, membro vê cancelado e não entra).
8. security-review, visual 1280/400 nos dois temas, gate completo, notas/ACs/DoD e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação (TASK-025)

### Decisões
- **Inscrições caem com o evento, na mesma transação** (AC#1): `applyEventTransition` passou a cancelar toda inscrição ativa (`confirmed` + `waitlist`) dentro da transação que muda o estado. Fora dela, um erro no meio deixaria metade da lista viva num evento que não existe mais — e o evento nunca aparece cancelado com gente ainda marcada como confirmada, nem por um instante. Nada é apagado: a linha vira `cancelled`, igual ao espírito do ledger (TASK-022).
- **Canal de voz: reuso, não cópia** (AC#2): `EventVoiceService` passou a tratar `→ cancelled` chamando o mesmo `closeChannel` do finish (devolve todo mundo para Aguardando Evento, inclusive quem entrou sem inscrição — Q7 — e só então apaga o canal). Depois disso, `closeOpenVoiceSessionsInChannel` fecha as sessões que sobraram abertas naquele canal: quem o Discord não conseguiu mover não gera sessão nova em Aguardando Evento e ficaria aberto para sempre num canal apagado, sujando a presença do próximo evento (Q6). O hook escuta `cancelled` sem olhar o estado anterior — `closeChannel` sai na hora quando não há canal, então cancelar um rascunho não toca em Discord nenhum.
- **AC#3 já vinha da máquina**: `finished` é terminal desde a TASK-021; a task só acrescentou o teste que diz isso com todas as letras e o 409 PT-BR conferido no HTTP ('O evento está finalizado e não pode ir para cancelado. Esse é um estado final.').
- **Motivo do cancelamento (opcional, decidido a favor)**: coluna `events.cancel_reason` (1–300 caracteres, mesmo limite da nota de recusa de nick), validada no shared e com check no banco amarrando o motivo ao estado cancelado. Sem ele o evento só sumia da lista e cada inscrito inventava uma explicação. A frase mora num lugar só (`eventCancelledText`), então embed e painel contam a mesma história. Só a rota `cancel` lê o corpo; as outras transições continuam ignorando corpo (em vez de virar 400 por um campo que não existe ali).
- **`/evento cancelar` (decidido a favor)**: saiu barato porque `/evento iniciar|encerrar` (TASK-024) já é um caminho genérico — bastou somar os estados candidatos, a ação CASL e a copy, mais a opção `motivo`. Mesma resolução de evento, mesma releitura antes de agir e mesma checagem CASL; nenhum botão novo no embed (ele já está perto do teto de 25 botões e um 'Cancelar' visível para a guilda convida clique errado).
- **Embed cancelado sem botão** (AC#4): é o único estado que perde os botões e a lista. Botão cinza faria a mensagem parecer um evento ainda de pé, e não há lista para conferir — as inscrições já caíram. Fica o aviso com o motivo.
- **Q26, o que ficou de fora**: 'cancelado não aceita split' e 'split confirmado impede cancelar' dependem do ledger/distribuição (F5, TASK-027+). Não há split no código hoje, então não havia o que impedir; a guarda entra junto com a distribuição.

### Verificação
| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 inscrições canceladas | db.integration 'cancelar o evento cancela toda inscrição ativa na mesma transação, com o motivo guardado' (confirmado + espera viram cancelled, embed/painel/ocupação zeram); events.http.test.ts 'cancelar marca todas as inscrições ativas como canceladas' (mySignups do membro esvazia e nova inscrição vira 409); event-voice.service.test.ts 'cancelar antes do start não mexe em canal nenhum, mas cancela as inscrições' | ✅ |
| AC#2 running devolve, apaga canal e fecha sessões | event-voice.service.test.ts 'cancelar em running devolve a galera, apaga o canal e fecha as sessões daquele canal' (2 pessoas de volta em Aguardando Evento incluindo o não inscrito, canal apagado, voiceChannelId null, 0 sessão aberta no canal) e 'falha do Discord ao apagar o canal não desfaz o cancelamento nem as inscrições'; db.integration 'cancelar em running fecha as sessões de voz abertas no canal do evento, sem tocar nas dos outros' (2 fechadas, a de outro canal intacta, idempotente) | ✅ |
| AC#3 finished não cancela | events.test.ts 'evento finalizado não pode ser cancelado, e a mensagem do 409 diz por quê'; events.http.test.ts 'evento finalizado não pode ser cancelado: 409 PT-BR e nada muda' e 'cancela de qualquer estado antes de finished' (draft/open/closed/running, os quatro com motivo gravado); event-voice.service.test.ts '/evento cancelar não acha evento finalizado e recusa quem não conduz o evento' | ✅ |
| AC#4 membro vê cancelado no embed e no painel | event-embed.test.ts 'mostra o motivo, avisa que as inscrições caíram e não deixa nenhum botão na mensagem'; event-embed.service.test.ts 'cancelar edita a mesma mensagem: vira aviso com motivo e sem botão nenhum' (mesma mensagem, não republica); e2e events.spec.ts 'caller cancela evento com motivo; inscrito vê o cancelamento e não entra mais' (desktop 1280 e mobile 400) | ✅ |
| DoD#4 visual | .playwright-mcp/task025/: membro-cancelado-1280-dark/light, membro-cancelado-400-dark, staff-cancelado-1280-dark/light, staff-cancelado-400-dark, staff-cancelar-dialogo-1280-dark — revisados pelo agent: estado com ícone+texto+cor (nunca só cor), aviso legível nos dois temas, sem overflow horizontal (scrollWidth 385 ≤ 400), console sem erro, um CTA destrutivo por diálogo | ✅ |
| DoD#6 security-review | sem achado de confiança ≥ 8. Conferidos: assertCan roda antes de ler o corpo (cancel só para owner ou staff), corpo dá só 'reason' (sem mass assignment), comando do bot relê o evento e rechecha CASL, SQL só por query builder, SameOriginGuard mantido, embed não resolve menção e o motivo tem teto de 300, JSX sem dangerouslySetInnerHTML, finished→cancelled barrado dentro do for update | ✅ |

### Quality gate completo (local, commit 002a469, Postgres 55457)
| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 93.17% | ≥ 79% | ✅ |
| E2E (desktop 1280 + mobile 400) | 40 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke | ✅ |
| Duplicação | 1.16% | ≤ 15% | ✅ |
| Dead code | 7 (exports shadcn pré-existentes, os mesmos da TASK-020..024) | 0 (advisory) | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

Skills: emil-design-eng, security-review, task-done-check.

### Pendência do usuário — verificação no Discord real
1. Criar evento, abrir a inscrição e inscrever duas contas (uma confirmada, uma na espera).
2. Cancelar pelo painel escrevendo um motivo. Esperado: a mensagem do evento no canal de eventos vira 'Evento cancelado: <motivo>. Todas as inscrições foram canceladas.', sem nenhum botão; clicar num botão antigo (cache do cliente) responde que as inscrições não estão abertas.
3. Repetir com o evento já iniciado, com as duas contas dentro do canal de voz do evento e uma terceira sem inscrição também lá. Esperado: todo mundo volta para Aguardando Evento, o canal do evento some e nenhuma sessão de voz fica aberta.
4. Rodar `/evento cancelar` sem a opção evento, com um evento seu só: deve resolver sozinho; com dois, deve pedir desempate listando os ids.
5. Rodar `/evento cancelar` num evento de outro caller com uma conta sem staff: deve responder que não achou evento para cancelar, sem revelar o evento.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cancelar evento passou a ter efeito de verdade (Q26). A transição para cancelled cancela, na mesma transação, todas as inscrições ativas — confirmadas e em espera — de modo que o evento nunca fica cancelado com gente ainda marcada como confirmada; nada é apagado, a linha vira cancelled e continua sendo histórico. Cancelar um evento em andamento reusa o EventVoiceService.closeChannel da TASK-024: devolve todo mundo que estiver no canal para Aguardando Evento (inclusive quem entrou sem inscrição, Q7), apaga o canal e depois fecha as sessões de voz que sobraram abertas nele, para nenhuma sessão órfã sujar a presença do próximo evento (Q6). Evento finalizado continua sendo estado final e o cancelamento responde 409 PT-BR sem mudar nada. Foi adicionado um motivo opcional (1–300 caracteres, coluna events.cancel_reason com check no banco): quem cancela escreve uma frase e ela vira o mesmo aviso no embed do Discord — que perde todos os botões e a lista — e nas duas telas do painel, onde o inscrito lê 'Evento cancelado: <motivo>'. O cancelamento também ganhou porta no Discord, /evento cancelar com opção motivo, no mesmo caminho genérico de /evento iniciar|encerrar, com a mesma resolução de evento e a mesma checagem CASL da API. Verificado com 3 testes de integração no Postgres (inscrições canceladas com o motivo, sessões do canal fechadas sem tocar nas de outros canais, motivo ignorado fora do cancel), 5 testes HTTP (cancela de draft/open/closed/running, inscrições derrubadas, finished 409, membro e caller de outro evento 403, motivo longo 400), 6 testes com Postgres real + Discord falso (canal devolvido e apagado, sessões fechadas, falha do Discord não desfaz nada, comando igual ao painel), 4 testes puros novos no shared e no embed, e e2e desktop 1280 + mobile 400 cobrindo o caller cancelando com motivo e o inscrito vendo o evento cancelado sem poder entrar. Gate completo verde (lint 0, typecheck ok, coverage branch 93.17%, e2e 40/0, imagem ok, audit 0) e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
