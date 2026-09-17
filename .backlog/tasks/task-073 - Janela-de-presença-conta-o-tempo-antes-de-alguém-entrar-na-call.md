---
id: TASK-073
title: Janela de presença conta o tempo antes de alguém entrar na call
status: Done
assignee: []
created_date: '2026-09-17 20:04'
updated_date: '2026-09-17 20:13'
labels: []
milestone: m-12
dependencies: []
priority: high
type: bug
ordinal: 7005
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reportado pelo usuário com evidência: numa call de menos de 1 minuto, o único participante ficou com **72,66%** de presença e não recebeu Buffunfa, enquanto no loot split da mesma tela ele tem 100%.

Causa: `attendanceWindowMs` (`packages/shared/src/event-attendance.ts`) define a janela como `finishedAt - startedAt` do **evento**, mas `presenceMs` só conta tempo **dentro do canal de voz**. Entre o evento começar (o bot cria o canal e arrasta gente da sala de espera) e a primeira pessoa efetivamente entrar existe um intervalo em que ninguém poderia estar na call — e ele conta contra todos. Em call curta isso domina: ~16 segundos de arrasto numa call de 1 minuto são os 27% que faltaram.

A prata não sofre porque o percentual do split é digitado pelo caller; o corte dos 90% é o único consumidor da janela medida.

Correção: a janela passa a começar quando a call **de fato** começa — a primeira entrada registrada em `voice_sessions` para o canal do evento, nunca antes do início do evento. Quem esteve desde o começo passa a marcar ~100%, que é o que a tela já afirma.

Não mexer no corte de 90% em si (F6-10) nem na medição da prata: o defeito é o denominador.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Participante que entrou na call assim que ela abriu e ficou até o fim marca presença suficiente para receber
- [ ] #2 A janela começa na primeira entrada registrada no canal, nunca antes do início do evento
- [ ] #3 Quem entrou no meio da call continua com presença proporcionalmente menor, e abaixo de 90% não recebe
- [ ] #4 Evento sem canal medido continua não pagando a ninguém
- [ ] #5 Teste cobre o caso do relato: call curta, uma pessoa, entrada alguns segundos depois do início
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Janela de presença passa a abrir na primeira entrada no canal (eventCallWindowMs), não no início do evento.

O que o relato ensinou, e que o desenho original não tinha visto: presenceMs e a janela mediam coisas diferentes. A presença só corre dentro do canal de voz; a janela corria desde o start do evento, quando o bot ainda estava criando o canal e arrastando gente. Em call longa o desvio some no arredondamento, em call curta ele decide o pagamento.

RED provado com um teste que reproduz o relato (call de 50s, entrada 16s depois): sem a correção, 'expected 50000 to be 34000'. attendanceWindowMs foi removido — codificava a regra errada e ficaria como armadilha para quem voltasse ao arquivo.

Gate: 144 e2e, cobertura 88,71%.
<!-- SECTION:NOTES:END -->
