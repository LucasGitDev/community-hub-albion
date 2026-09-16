---
id: TASK-029
title: 'Tela de acerto do evento finalizado: dados, taxa e loot split'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 20:56'
labels:
  - frontend
  - economy
milestone: m-5
dependencies:
  - TASK-028
  - TASK-023
priority: medium
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Interface do pós-evento no painel. Hoje o evento finalizado some de 'Meus eventos' em StaffEvents.tsx (o filtro exclui finished) e não existe formulário nenhum para editar dados nem taxa, embora a API já permita enquanto o status for finished. Esta task entrega o lugar onde o caller/dono fecha a conta: rever dados do evento, ajustar a taxa herdada do template, criar e editar o loot split e confirmar, com o arquivamento como último passo irreversível. Skills (doc-003): emil-design-eng, frontend-design, ask-sonner, security-review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Evento finalizado aparece e é alcançável no painel de quem conduz (não some da lista como hoje)
- [x] #2 Caller/dono edita dados do evento e a taxa enquanto o status é finished; archived deixa tudo somente leitura com a razão visível
- [x] #3 Taxa editável em porcentagem ou valor fixo, mostrando na hora quanto é retido, quanto sobra pra dividir e pra quem vai o retido
- [x] #4 Cria split informando o valor total e vê o rascunho com percentual e tempo de presença por participante
- [x] #5 Soma dos percentuais sempre visível; confirmar desabilitado quando ≠ 100%, com o quanto falta ou sobra
- [x] #6 Não inscrito que apareceu na call aparece na lista com 0% e rotulado como tal
- [x] #7 Confirmação mostra o antes-e-depois (bruto, taxa, resíduo, líquido por pessoa) e avisa que vira lançamento imutável no ledger
- [x] #8 Taxa fixa maior que o total é recusada na interface com mensagem clara, antes de chamar a API
- [x] #9 Split confirmado fica somente leitura e mostra o caminho de correção por estorno
- [x] #10 Arquivar exige confirmação explícita e é bloqueado enquanto houver rascunho de split pendente, explicando o motivo
- [x] #11 Valores de prata formatados em PT-BR; nenhum valor passa por number no cálculo
- [x] #12 Membro sem permissão não vê nem acessa a tela; ganhos de evento alheio não vazam
- [x] #13 security-review executado sem achados críticos
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
Interface proposta (revisar antes de implementar):

1. ONDE VIVE. O acerto acontece dentro de StaffEvents, no painel de detalhe do evento, não numa tela solta. Motivo: quem acabou de finalizar já está ali, com a lista de inscritos na tela; mandar pra outra rota perde o contexto de quem esteve no evento. A rota /staff/splits continua existindo como fila ('o que ainda não fechei'), listando eventos finalizados com split pendente.

2. O EVENTO FINALIZADO PRECISA APARECER. Corrigir o filtro de 'Meus eventos' (hoje exclui finished). Proposta: seção 'A acertar' no topo da lista, separada dos eventos vivos, com contador. Evento finalizado sem split confirmado é pendência, não histórico — some da seção quando arquiva.

3. O PAINEL DE DETALHE GANHA ABAS quando o status é finished: 'Inscritos' (o que já existe) e 'Acerto' (novo). Abrir direto em Acerto quando o evento está finalizado sem split.

4. ABA ACERTO, de cima pra baixo, na ordem da decisão:
   a) Dados do evento em modo edição inline (nome, descrição), discreto — é correção, não criação.
   b) Bloco da taxa: toggle porcentagem | valor fixo, campo do valor, e embaixo a frase do resultado em tempo real ('De 10.000.000, retém 1.000.000 (10%) pra Thalya; sobram 9.000.000 pra dividir'). A frase é o feedback, não um preview separado.
   c) Bloco do split: campo do valor total arrecadado como CTA primário quando ainda não existe rascunho ('Calcular divisão'). Com rascunho, vira a tabela.
   d) Tabela do rascunho: participante, tempo na call, percentual editável, prata resultante. Não inscrito com 0% e rótulo 'apareceu sem inscrição'. Resíduo e taxa como linhas finais da mesma tabela, marcadas como destino do dono — o dinheiro tem que fechar visualmente de cima a baixo.
   e) Rodapé fixo da tabela com a soma dos percentuais como número-chave (dourado --brand): '100%' verde, ou '97% — faltam 3%'. Botão confirmar desabilitado fora de 100%.
   f) Confirmação em diálogo: bruto, taxa, resíduo, líquido por pessoa, e a frase de que vira lançamento imutável e correção só por estorno.
   g) Arquivar só depois, como ação destrutiva separada do fluxo, com confirmação.

5. DEPOIS DE CONFIRMADO. A aba vira somente leitura com os lançamentos gerados e uma linha explicando que correção é por estorno. Arquivado: mesma coisa, mais a nota de arquivamento.

6. PRINCÍPIOS. Nada de tela vazia: sem rascunho, o estado inicial já mostra os participantes e o tempo de cada um, porque esse dado existe desde o finish. Densidade e contraste (o usuário rejeitou a versão anterior do painel por ser 'clean igual um necrotério'). Dourado --brand só na soma dos percentuais e no CTA de confirmar. Tratar carregando, vazio (ninguém na call) e erro.

---

## Plano de execução (pesquisa feita no worktree, 2026-09-16)

O desenho acima fica de pé. O que a leitura do código mudou/acrescentou:

**Duas lacunas de API que a tela precisa** (achadas lendo `events.controller.ts` e `loot-split.controller.ts`):
1. Não existe endpoint para editar nome/descrição do evento — só criação e transições. AC#2 exige. Entra `PATCH /api/events/:id` com `eventUpdateSchema` novo no shared (nome + descrição), `@Authorize(\"update\",\"Event\")` + condição de dono + `assertEventEditable` (archived recusa com a frase única).
2. `LootSplitService.presence()` já existe mas **não tem rota**. Sem ela o estado inicial seria vazio, o que o plano proíbe. Entra `GET /api/events/:eventId/presence`, gateado por `distribute` no evento (nunca `read` em Event — TASK-027).

Nenhuma migration: `setEventFee`, `presence`, split e ledger já estão prontos da TASK-027/028.

**Passos**
1. shared: `eventUpdateSchema`/`EventUpdateInput`; `SplitPresenceDto`; helpers puros do acerto (prévia da taxa, recusa de taxa > total antes da API, soma dos percentuais e o quanto falta/sobra, parsing do campo de percentual em bp) + testes unitários.
2. db: `updateEventDetails(db, id, {name, description})` no `events-repo`, com teste de integração.
3. server: `PATCH events/:id`, `GET events/:eventId/presence`; testes HTTP de autorização dos dois (membro 403, caller de outro evento 403, arquivado 409).
4. web/api: `apps/web/src/api/splits.ts` (presence, list, create, patch, confirm) e `updateEvent` em `api/events.ts`.
5. web/lib: `lib/settlement.ts` puro (linhas da tela a partir do split OU da presença, totais, estado do botão confirmar) + testes.
6. web/UI: corrige o filtro `mine` (AC#1) e cria a seção **A acertar**; aba Inscritos/Acerto no detalhe do finished, abrindo em Acerto quando não há split confirmado; bloco de dados, bloco de taxa com a frase em tempo real, tabela do rascunho com rodapé de soma, diálogo de confirmação com antes-e-depois, somente-leitura depois de confirmado com a linha do estorno. Toasts pelo sonner. Skills emil-design-eng + frontend-design + ask-sonner.
7. e2e `e2e/settlement.spec.ts`: ciclo completo até finished, evento aparece em A acertar, edita dados e taxa, cria e edita split, taxa fixa > total barrada na tela, confirma, vira somente leitura, arquiva; screenshots 1280 e 400 revisados pelo agent. Membro sem permissão: sem aba e 403 na API (AC#12).
8. `security-review`, `pnpm quality` completo (Postgres :55438), `task-done-check`, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, Postgres :55438, worktree task-029, commit de2cd4fd)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.41% | ≥ 79% | ✅ |
| E2E + screenshots (1280/400) | 62 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.81% | ≤ 15% | ✅ |
| Dead code | 6, todos pré-existentes em apps/web/src/components/ui | advisory | ⚠️ |
| Vulnerabilidades high+ | 0 | 0 | ✅ |

Resultado: **Passou com avisos** (só o advisory de dead code pré-existente; nenhum arquivo desta task).

Nota de ambiente: a porta 4173 do e2e é fixa e compartilhada entre worktrees. Três rodadas deram falso negativo (`/presence` respondendo 404, "A acertar" ausente) porque o `reuseExistingServer` do Playwright pegou o servidor de outro agent (TASK-046, spec `panel`), com build de outra branch. Com a porta livre, 4/4 passam.

## O que a task decidiu, além do óbvio

**Duas lacunas de API apareceram só quando a tela foi desenhada.** Não existia caminho nenhum para editar um evento já criado — só criação e transições —, então AC#2 exigiu um `PATCH /api/events/:id` novo. E `LootSplitService.presence()` existia desde a TASK-027 sem rota; sem ela o passo 3 abriria vazio esperando o caller digitar um total, que é exatamente o que o plano proibia. Nenhuma migration: taxa, split, ledger e presença já estavam prontos.

**O `PATCH` edita nome e descrição, e nada mais.** Template, roles e horários são o registro do que aconteceu; reescrevê-los depois do jogo inventaria um evento que ninguém viveu. O que o caller precisa corrigir no acerto é o nome que saiu errado e a observação que faltou.

**A tela não recalcula prata.** `lib/settlement.ts` chama `feeBreakdown`, `distributeByShare` e `checkSplitConfirm` — as mesmas funções que o servidor usa para gravar no ledger. É isso que faz o número conferido na tela ser o número creditado, inclusive nos arredondamentos, e é isso que faz a recusa da AC#8 usar a frase idêntica à do 409 em vez de uma paráfrase.

**O total da leva mora acima do passo 3, e não dentro dele.** A frase da taxa ("De 10.000.000, retém 1.000.000 (10%) para Thalya; sobram 9.000.000 para dividir") é feita do total, então é digitando o total que o caller descobre quanto a taxa retém de verdade. Sem essa ligação, o passo 2 só conseguiria mostrar o percentual abstrato.

**A duplicação da frase da AC#8 foi cortada de propósito.** A frase inteira (a mesma do 409) fica no passo 2, que é onde se conserta a taxa; o passo 3 só diz por que o botão não vai ("A taxa do evento não cabe neste total. Baixe a taxa no passo 2 ou aumente o total."). Duas cópias do mesmo parágrafo coladas uma na outra em 400px não informam duas vezes.

**O rodapé da soma não é `sticky`.** Foi, e a revisão das screenshots mostrou por que não devia ser: numa página que rola, `sticky bottom-0` fica pendurado no rodapé da janela e passa por cima da própria tabela que ele resume.

**Fila "A acertar" no topo da lista.** O filtro de "Meus eventos" excluía `finished` — o evento saía da conta no instante em que o caller terminava o jogo, com a prata ainda por dividir. Agora `finished` conta em "Meus eventos", ganha seção e contador próprios no topo da lista, e é o evento que a tela seleciona sozinha. Some da fila quando arquiva, que é o fim de fato (Q26).

**Arquivar é bloqueado na tela, não só no 409.** A API já recusava arquivar com rascunho aberto (TASK-027). A tela agora desliga o botão e escreve o motivo antes do clique — quem arquiva precisa ler isso antes, não descobrir depois.

## Responsividade
Em 400px não cabem quatro colunas sem empurrar a prata para fora da tela, e a prata é o número que se confere: o tempo de call vira uma linha abaixo do nome (`sm:hidden` / `hidden sm:table-cell`), mantendo o dado nos dois tamanhos.

## Testes desta task
- 5 unitários novos do `parsePercentBp` e 2 do `eventUpdateSchema` — `packages/shared/src/*.test.ts`
- 15 unitários das regras da tela — `apps/web/src/lib/settlement.test.ts` (soma, fechamento do dinheiro, frase da taxa, recusas, quem vê)
- 1 de integração em Postgres real — `packages/db/src/loot-split.integration.test.ts` ("nome e observação... sem mexer no resto")
- 5 HTTP focados em autorização dos dois endpoints novos — `apps/server/src/economy/loot-split.http.test.ts`
- 2 e2e × 2 viewports com 10 screenshots cada — `e2e/settlement.spec.ts`

## Guardrails (task-done-check)
Sem `any`, `@ts-ignore` ou `eslint-disable` novos; nenhum hex solto; nenhum UPDATE/DELETE em `ledger_entries` (esta task não escreve no ledger). O único `Number(` do diff é o `parsePercentBp`, que converte percentual digitado em basis points — prata nenhuma passa por ele, e continua toda em `bigint`.

## security-review (AC#13)
Rodado sobre `origin/main...HEAD`. **Nenhum achado com confiança ≥ 8.**

Verificado como seguro:
- **Autorização do `GET /events/:id/presence`**: `@Authorize("read","LootSplit")` (membro puro não tem) **mais** `assertCan(auth,"distribute", event)`, que avalia a condição `{ownerId}` do CASL contra o evento carregado. Nunca `read` em `Event` — esse é de todo membro logado, e a presença é quem esteve com quem. Provado no HTTP: anônimo 401, membro 403 (mesmo lendo o evento com 200), caller de outro evento 403, staff 200.
- **Autorização do `PATCH /events/:id`**: `update` em `Event` com a condição de dono, mais `assertEventEditable` antes de qualquer escrita; arquivado leva 409 com a frase do arquivamento.
- **CSRF**: o PATCH está sob `SameOriginGuard` (origem estranha → 403, testado); a rota de presença é GET sem efeito.
- **IDOR**: os dois passam por `parseId` (UUID, 400) e `load` (404 para inexistente, sem vazar existência de id).
- **Injection**: `updateEventDetails` usa `update().set().where(eq(...))` parametrizado do drizzle, sobre uma lista fechada de `name`/`description`/`updatedAt`; o corpo é estreitado pelo `eventUpdateSchema` (dois campos), então não há mass assignment — `fee`, `ownerUserId` e `status` não são alcançáveis pelo PATCH.
- **XSS**: nenhum `dangerouslySetInnerHTML` ou equivalente no diff.
- **Exposição de dados**: `SplitPresenceDto` traz o mesmo conteúdo que as linhas do rascunho já traziam, e só para dono/staff.
- **Integridade da prata**: nada no diff escreve no ledger; prata trafega como string e é validada pelos schemas já existentes; a taxa do split continua congelada pelo servidor (o corpo de criação não manda `fee`).

Skills: emil-design-eng, frontend-design, ask-sonner, security-review, task-done-check.

## Evidências por AC

| AC | Evidência | Status |
|---|---|---|
| #1 finalizado aparece e é alcançável | e2e "caller acerta…": seção **A acertar** com contador no topo da lista + aba Acerto já ativa (`acerto-fila-D/M.png`); unit `settlement.test.ts` "a fila 'a acertar' traz só o finalizado que quem olha conduz"; filtro `mine` deixou de excluir `finished` | ✅ |
| #2 edita dados e taxa em finished; archived só leitura | e2e edita observação e salva ("Dados do evento salvos"), e no arquivado "Arquivado: os dados não mudam mais." sem botões Corrigir/Salvar taxa (`acerto-arquivado-D/M.png`); HTTP "dono corrige nome e observação…" e "arquivado recusa a correção com a frase do arquivamento"; integração db "sem mexer no resto" | ✅ |
| #3 taxa em % ou fixo, com retido/sobra/destino em tempo real | e2e: "De 10.000.000, retém 1.000.000 (10%) para callerAc8; sobram 9.000.000 para dividir" (`acerto-taxa-D/M.png`), toggle Porcentagem/Valor fixo usado nos dois modos; unit "diz quanto retém, para quem, e quanto sobra" | ✅ |
| #4 cria split e vê rascunho com % e tempo | e2e "Calcular divisão" → tabela com Tempo na call e Participação por pessoa (`acerto-rascunho-D/M.png`); unit "abre com a presença medida" / "com rascunho, usa o percentual e a prata que o servidor gravou" | ✅ |
| #5 soma sempre visível; confirmar off fora de 100% | e2e: rodapé "0% faltam 100%" e "97% faltam 3%" com o botão desabilitado, e "100% a divisão fecha" liberando (`acerto-soma-incompleta-D/M.png`); unit "diz quanto falta, quanto passou, ou só 100%" e "barra soma diferente de 100% dizendo o quanto falta" | ✅ |
| #6 não inscrito com 0% e rotulado | unit "abre com a presença medida…" (linha com `signedUp:false`) + pill "apareceu sem inscrição" na tabela; a lista de presença já vem marcada da TASK-027 | ✅ |
| #7 confirmação com antes-e-depois e aviso de imutável | e2e checa no diálogo "Total bruto da leva", "Dividido entre 1 pessoa" e "Lançamento não se apaga nem se edita" (`acerto-confirmacao-D/M.png`) | ✅ |
| #8 taxa fixa > total recusada na UI, antes da API | e2e com taxa fixa de 20.000.000 sobre total de 10.000.000: frase idêntica à da API no passo 2, alerta no passo 3 e "Calcular divisão" desabilitado (`acerto-taxa-maior-que-total-D/M.png`); unit "taxa maior que o total usa exatamente a frase que a API devolveria" | ✅ |
| #9 confirmado somente leitura + caminho do estorno | e2e: "Leva 1 confirmada", nenhum campo de participação na tela e "a staff estorna os lançamentos…" (`acerto-confirmado-D/M.png`) | ✅ |
| #10 arquivar exige confirmação e é bloqueado com rascunho | e2e: com rascunho, aviso "Há um loot split em rascunho…" e botão Arquivar desabilitado; depois de confirmar, arquiva pelo diálogo | ✅ |
| #11 prata em PT-BR, sem number no cálculo | e2e confere 9.000.000 / 1.000.000 / 10.000.000 na tela e "9000000" gravado na API; grep do diff: nenhum `Number(`/`parseFloat` sobre prata (o único `Number(` é percentual→bp) | ✅ |
| #12 sem permissão não vê nem acessa | e2e "membro e caller de outro evento não alcançam o acerto": caller alheio sem aba Acerto e 403 em `/presence` e `/splits`; membro com 200 no evento e 403 nos dois, 403 no PATCH, "Acesso negado" na central (`acerto-sem-permissao-*.png`); HTTP idem; unit `canSettle` | ✅ |
| #13 security-review sem crítico | relatório acima, 0 achados ≥ 8 | ✅ |

## Evidências de DoD
| DoD | Evidência |
|---|---|
| #1 gate | tabela do gate acima, commit de2cd4fd, sem falha bloqueante |
| #2 AC com evidência objetiva | tabela acima: teste, e2e, screenshot ou saída de comando em cada linha |
| #3 skills | emil-design-eng, frontend-design, ask-sonner, security-review, task-done-check |
| #4 e2e + screenshots 1280/400 revisados | `e2e/settlement.spec.ts`, 20 screenshots (10 estados × 2 viewports) extraídos do relatório e lidos pelo agent; a revisão gerou 5 correções: rodapé sem `sticky`, coluna de tempo responsiva, frase da AC#8 sem duplicata, "1 pessoa" em vez de "1 pessoas", arquivado sem prévia órfã de 0% |
| #5 doc-005 | Q26 (finished acerta, archived fecha), Q22 (100% para confirmar), Q23 (taxa e resíduo para o dono, N levas), Q20 (prata inteira, UI formata), Q7 (presente não inscrito com 0%), bloco "Taxa do split" (% ou fixo, sem teto, antes da divisão) |
| #6 security-review | sem achado ≥ 8 |
| #7 notas e commits | 6 commits Conventional atômicos, sem co-autor |
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
O evento finalizado ganhou o lugar onde a conta é fechada: dados, taxa e loot split, dentro do painel de detalhe, na ordem em que o caller decide.

Duas coisas que não existiam apareceram só quando a tela foi desenhada. Não havia caminho nenhum para editar um evento já criado — só criação e transições —, então entrou um `PATCH /api/events/:id` restrito a nome e descrição: template, roles e horários são o registro do que aconteceu. E `LootSplitService.presence()` estava pronto desde a TASK-027 sem rota; com ela o passo do split abre mostrando quem esteve na call e por quanto tempo, em vez de um formulário em branco pedindo um total.

O filtro de "Meus eventos" excluía `finished`, e o evento saía da conta no instante em que o jogo acabava, com a prata ainda por dividir. Agora `finished` é pendência: seção "A acertar" com contador no topo da lista, e é ele que a tela seleciona sozinha, já na aba do acerto.

A tela não refaz nenhuma conta de prata — `feeBreakdown`, `distributeByShare` e `checkSplitConfirm` são as mesmas do servidor. É por isso que o número conferido é o número creditado, e que a recusa de taxa maior que o total usa exatamente a frase do 409 em vez de uma paráfrase. O total da leva ficou acima do bloco da taxa porque é dele que sai a frase "De 10.000.000, retém 1.000.000 (10%) para Thalya; sobram 9.000.000 para dividir".

Revisar as screenshots mudou cinco coisas que a leitura do código não pegaria: o rodapé da soma deixou de ser `sticky` (numa página que rola ele passava por cima da tabela que resume), a coluna de tempo desce para baixo do nome em 400px para a prata não sair da tela, a frase da taxa que não cabe parou de aparecer duas vezes coladas, "1 pessoas" virou "1 pessoa" e o evento arquivado não oferece mais uma prévia órfã de 0% embaixo da leva já confirmada.

Verificado com 22 testes unitários novos (7 no shared, 15 nas regras da tela), 1 de integração em Postgres real, 5 HTTP focados em autorização dos dois endpoints novos e 2 e2e em 1280 e 400 cobrindo o ciclo inteiro até o crédito no ledger; `pnpm quality` verde (coverage 89,41%, e2e 62/62) e security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
