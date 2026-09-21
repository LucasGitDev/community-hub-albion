---
id: TASK-086
title: Bot pergunta se inscreve quem entrou no meio da call
status: In Progress
assignee:
  - '@agent'
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 14:47'
labels: []
milestone: m-12
dependencies:
  - TASK-084
  - TASK-085
priority: medium
type: feature
ordinal: 6840
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE7 e PE8 no doc-005. Alguém entra na call do evento sem estar inscrito; o bot pergunta **no chat de texto do próprio canal de voz** se deve inscrever, com botões *Inscrever* e *Ignorar*.

Sem resposta, nada acontece: silêncio não vira inscrição (PE7). A contagem de presença dessa pessoa **começa no aceite** (PE8), não em quando ela entrou na call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Entrada de alguém não inscrito na call do evento gera a pergunta no chat do canal de voz
- [x] #2 Inscrever coloca a pessoa no evento, com escolha de role quando há vaga
- [x] #3 Ignorar encerra a pergunta sem inscrever
- [x] #4 Sem resposta, a pessoa continua sem inscrição e sem presença contada
- [x] #5 A presença de quem foi aceito conta a partir do aceite, não da entrada na call
- [x] #6 Só caller do evento e staff conseguem responder; outros recebem recusa
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [x] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. (feito, commit 4da457c) db: migration 0028 `event_signups.presence_from`, `listEventPresence` cortando a sessão no aceite, `findRunningEventByVoiceChannelId`, `listEventFreeRoleSlots`, `addLateEventSignup`.
2. (feito) domain/event-late-signup.ts puro: ids de botão por ticket, embed da pergunta em lote, embed da escolha de role, copy das recusas.
3. Falta: teste unitário do domain (ids, lote, copy).
4. Falta: bot/event-late-signup.service.ts — registro de tickets em memória, janela curta de agrupamento (uma pergunta por lote, até 4 pessoas), memória de quem já foi perguntado/ignorado por evento.
5. Falta: bot/event-late-signup.interactions.ts — botões Inscrever / escolher role / Ignorar com CASL `update Event` no clique (caller ou staff), igual à TASK-085.
6. Falta: VoiceListener chama o serviço no join/move para dentro do canal do evento.
7. Falta: timeline `event.late_signup_added` e `event.late_signup_ignored` depois do commit, com teste.
8. Falta: testes — domain, serviço com Discord falso, integração de banco de presence_from e addLateEventSignup, e interações com Postgres real reusando o gateway falso da TASK-085.
9. Falta: gate completo, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (commit eb51c3a, local)

Quality gate ⚠️ Passou com avisos (bloqueantes todos verdes): lint 0, race 0, typecheck ok,
coverage de branch 87.49% (≥79%), e2e 158 ok / 0 falha na porta 4195, imagem Docker build+smoke ok,
duplicação 2.24%, vulnerabilidades high+ 0. Único ⚠️: dead code 10 itens (advisory), **todos
pré-existentes** — nenhum vem dos arquivos desta task.

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| #1 pergunta no chat do canal de voz | `apps/server/src/bot/event-late-signup.interactions.test.ts`: 'AC#1: entrada de não inscrito na call do evento gera a pergunta no chat do canal de voz' (afirma `channelId` da call), + 'quem já está inscrito entrando na call não gera pergunta nenhuma' e 'canal que não é call de evento em andamento fica em silêncio'; `packages/db/src/event-late-signup.integration.test.ts`: 'acha o evento pelo canal de voz só enquanto ele está em andamento' | ✅ |
| #2 Inscrever coloca no evento, com escolha de role quando há vaga | mesmo arquivo: 'AC#2: Inscrever oferece só as roles com vaga e então coloca a pessoa no evento' (o primeiro clique não inscreve; o segundo grava confirmed em Tank) e 'AC#2: sem vaga em nenhuma role a resposta diz isso, e ninguém é inscrito'; no banco, 'só devolve role com vaga, e some quando a última é tomada' e 'inscreve confirmado, nunca na espera: role cheia é recusa' | ✅ |
| #3 Ignorar encerra sem inscrever | 'AC#3: Ignorar encerra a pergunta sem inscrever, e os botões dela param de valer' (clique posterior recebe `expired`) e 'AC#3: quem foi ignorado não gera pergunta nova ao reentrar na call' | ✅ |
| #4 sem resposta, sem inscrição e sem presença | 'AC#4: sem resposta ninguém entra no evento e nada é publicado na timeline'; no banco, 'sem aceite ninguém ganha presença: quem só apareceu na call fica em 0' (PE6: aparece na lista com presença 0) | ✅ |
| #5 presença conta a partir do aceite | `packages/db/src/event-late-signup.integration.test.ts`: 'quem é aceito faltando 20% do evento termina com 20%, mesmo tendo ficado a call inteira' (24 min de 120), 'quem se inscreveu antes continua contando desde o início da call (presence_from nulo)' e 'aceito depois de já ter saído e voltado só conta o pedaço posterior ao aceite' | ✅ |
| #6 só caller e staff respondem | 'AC#6: estranho recebe recusa e nada acontece; staff que não é o caller consegue' (inclui custom id forjado direto no botão de role) e 'AC#6: ticket que o bot não conhece não inscreve ninguém' | ✅ |
| DoD#7 timeline | 'DoD#7: o aceite publica na timeline quem inscreveu quem, com a role e o início da presença' e 'DoD#7: ignorar também publica, com quem ignorou e quem ficou de fora'; `publishAfterCommit` garante que falha ao publicar não derruba a operação | ✅ |

## Como a presença a partir do aceite ficou ligada

`event_signups.presence_from` (migration 0028) recebe o instante do aceite em `addLateEventSignup`.
`listEventPresence` não ganhou uma segunda medição: é a mesma `overlapMs`, com o início da janela
empurrado **só para essa pessoa** (`max(startedAt, presence_from)`). O denominador continua sendo a
call inteira, que é exatamente o que a PE8 pede — aceito faltando 20% termina com 20%, e o caller
ainda pode subir na mão (PE1).

## Como a enxurrada de perguntas foi evitada

Três travas, cada uma para um caso diferente:
1. **Lote com janela de 3 s**: a entrada não pergunta na hora, entra numa lista; todo mundo que caiu
   na call no intervalo sai numa mensagem só, com até 4 pessoas (quatro *Inscrever* mais o *Ignorar*
   fecham a linha de botões do Discord). Cinco entrando juntas = 2 mensagens, não 5 (teste).
2. **Memória por evento** de quem já foi perguntado ou ignorado: re-entrar na call não gera pergunta
   nova (dois testes).
3. **Conferência de quem ainda está na call** na hora de publicar: quem entrou e saiu dentro da
   janela some do lote, e lote vazio não publica mensagem.

A memória é de processo: reiniciar o bot pergunta de novo (melhor que perder quem entrou durante a
queda) e invalida os tickets antigos, que passam a responder 'não vale mais' em vez de inscrever
alguém pelo motivo errado.

## Skills

`task-done-check` (este roteiro) e `security-review` (toca cobrança em Buffunfa no aceite).
Skills de UI/design do doc-003 **não se aplicam**: a task não toca o painel web — a interface nova é
embed e botão do Discord, montados por função pura em `domain/event-late-signup.ts` e cobertos por
teste unitário de copy e de rótulo. Por isso o DoD#4 (screenshots 1280/400) fica sem marcar.
<!-- SECTION:NOTES:END -->
