---
id: TASK-044
title: Estado arquivado depois de finalizado
status: Done
assignee:
  - '@claude'
created_date: '2026-09-16 14:35'
updated_date: '2026-09-16 15:56'
labels:
  - backend
  - frontend
  - bot
dependencies: []
priority: high
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisão do usuário (2026-09-16): 'finished' encerra o jogo mas ainda permite editar dados do evento, taxa e loot splits; é preciso um estado final de fato, 'archived', que bloqueia edição. Ajusta a máquina de estados (TASK-021), painel (TASK-023), embed e comandos.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Máquina aceita finished → archived e recusa qualquer transição a partir de archived
- [x] #2 Evento finished permite editar dados, taxa e splits; archived bloqueia edição com mensagem clara (409)
- [x] #3 Painel e embed mostram os dois estados de forma distinta, com ação de arquivar para owner/staff
- [x] #4 Arquivar exige que não haja split em rascunho pendente (regra registrada nas notas)
- [x] #5 Testes cobrem transições novas e bloqueio de edição em archived
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
- [x] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. shared: 'archived' em EVENT_STATUSES, aresta finished→archived, archived terminal; ação 'archive' (EVENT_TRANSITIONS/ACTIONS/permissions CASL); helper eventEditBlocked + EVENT_ARCHIVED_EDIT_ERROR; labels PT-BR. Teste exaustivo de pares cobre as arestas novas.
2. db: coluna archived_at + checks de consistência (started/finished/archived) + valor do enum via pnpm db:generate; STAMP.archived; EventDto.archivedAt; transferEventOwner deixa de bloquear em finished e passa a bloquear em archived.
3. Precondição plugável dentro da transação do applyEventTransition (roda depois do 'for update'): devolve mensagem PT-BR e vira 409. EventsService expõe setArchivePrecondition; default = sem split em rascunho (F5/TASK-027/028 pluga a query real).
4. Guard de edição: assertEventEditable(event) no server (409 'Evento arquivado não pode mais ser editado.') aplicado em transferOwner, join, leave e move; F5 chama o mesmo helper no serviço de split.
5. Painel: pill/copy distintos para finished e archived, ação 'Arquivar evento' (owner/staff) com diálogo de confirmação; canTransferOwner passa a permitir finished e bloquear archived.
6. Embed: archived sem botão, com situação final clara e cor própria.
7. Bot: /evento arquivar (mesmo caminho de iniciar|encerrar|cancelar).
8. Testes: pares da máquina, HTTP (owner/staff arquiva, member 403, archived→qualquer 409, edição em archived 409, precondição falsa bloqueia), e2e desktop+mobile.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (local, commit eae716e, TEST_DATABASE_URL em :55462): lint 0 · race 0 · typecheck ok · coverage branch 91.37% (≥79%) · e2e 50 ok / 0 falhas (desktop 1280 + mobile 400) · imagem Docker build+smoke ok · audit 0 high+ · duplicação 1.05% · deadcode 7 (advisory, todos pré-existentes em components/ui).

Decisões:
- Máquina (packages/shared/src/events.ts): `finished → archived`, `archived` terminal. `cancelled → archived` NÃO existe — cancelado já é um fim e não tem split para fechar; dois estados finais distintos preservam a informação "terminou e foi fechado" vs "não aconteceu". TERMINAL_EVENT_STATUSES virou ["cancelled","archived"] (finished saiu: ainda vai para archived).
- Guard de edição: `eventEditBlocked(status)` no shared + `assertEventEditable(event)` no server (apps/server/src/events/archived.guard.ts) → 409 "Evento arquivado não pode mais ser editado.". Aplicado em transferOwner, join, leave e move. O serviço de loot split da F5 (TASK-027/028) chama a MESMA função ao criar/editar/confirmar split e ao mexer na taxa — é o único ponto a tocar.
- `finished` deixou de bloquear edição: `transferEventOwner` agora só recusa em `cancelled`/`archived`. A taxa e as sobras vão para o owner e o acerto acontece depois do jogo (Q26 revisada), então corrigir o dono errado precisa valer até o arquivamento. Move de roster continua travado em finished (regra de lista, EDITABLE_BY_STAFF = open|closed) — não mudou.
- AC#4 (sem split em rascunho): precondição plugável `EventTransitionPrecondition` (packages/db/src/events-repo.ts) avaliada DENTRO da transação, depois do `for update` e depois da máquina — é isso que impede a corrida "conferi que não havia split e alguém criou um no meio". EventsService.setArchivePrecondition registra; default devolve null ("não há split pendente") porque split só nasce na F5. Recusa vira `{ ok:false, reason:"blocked", message }` → 409 com a frase PT-BR. F5 pluga a query real sem tocar no repo nem no controller.
- Migration 0010_blushing_toad_men.sql: os checks comparam o status por `::text`. O literal do enum criado pelo próprio migration (`alter type ... add value`) não pode ser usado na mesma transação ("unsafe use of new value") — a primeira versão gerada quebrava; provado pelos testes de integração, que criam o banco do zero e rodam as migrations.
- `/evento arquivar`: SIM. É o mesmo caminho de iniciar|encerrar|cancelar (muda só o estado buscado, a ação CASL e a copy, ~20 linhas), e quem conduz o evento pelo Discord teria que abrir o painel só para fechar o evento.
- Embed: arquivado sem botão nenhum (como cancelado) mas MANTÉM a lista — o evento aconteceu e quem jogou continua no registro; o cancelado some com a lista porque as inscrições caíram.

Evidência AC→prova:
| AC | Evidência | Status |
|---|---|---|
| AC#1 máquina aceita finished→archived e recusa saída de archived | packages/shared/src/events.test.ts "cobre todos os 49 pares … 10 arestas" + "finished vai só para archived; archived não vai para lugar nenhum" + "cancelled não vai para archived"; db.integration "arquiva depois de finalizado, carimba archived_at e trava qualquer saída"; events.http.test "de archived não sai nenhuma transição: 409 PT-BR e nada muda" | ✅ |
| AC#2 finished edita, archived bloqueia com 409 claro | events.http.test "evento finalizado ainda aceita edição; arquivado devolve 409 com a frase do arquivamento" (owner transfer 200 em finished; owner/join/leave/move todos 409 "Evento arquivado não pode mais ser editado." em archived); db.integration "evento finalizado ainda troca de owner; arquivado não"; shared "só archived bloqueia edição" | ✅ |
| AC#3 painel e embed distinguem os dois, com ação de arquivar para owner/staff | screenshots t044-finalizado-1280-light/dark, t044-arquivado-1280-dark/light, t044-dialogo-1280-light, t044-finalizado-400-dark, t044-arquivado-400-light (lidos pelo agent); e2e "staff arquiva um evento finalizado…" (desktop+mobile); web/lib/events.test "finalizado oferece só arquivar; cancelado e arquivado não oferecem nada"; event-embed.test "embed do evento arquivado" + "finalizado e arquivado não se confundem: cor, situação e botões diferentes" | ✅ |
| AC#4 arquivar exige nenhum split em rascunho | events.http.test "split em rascunho barra o arquivamento: 409 e o evento continua finalizado"; db.integration "precondição recusa o arquivamento dentro da transação e não muda nada" + "precondição não roda quando a máquina já recusou" | ✅ |
| AC#5 testes cobrem transições novas e bloqueio de edição | 20 testes em shared/events.test.ts, +3 casos em db.integration, +5 em events.http.test, +2 no embed, +e2e desktop/mobile; coverage branch 91.37% | ✅ |
| DoD#4 visual | 1280 e 400 nos dois temas, lidos pelo agent: Finalizado (success + CheckCircle2) ≠ Arquivado (neutral + Archive) ≠ Cancelado (destructive + XCircle) — ícone, texto e cor, nunca só cor. scrollWidth 385 ≤ innerWidth 400 (sem overflow). Console sem erro. Diálogo de confirmação com foco visível no botão de confirmar. | ✅ |
| DoD#6 security-review | Sem achados. Verificado: ação `archive` só para caller dono (condição ownerId) e staff/admin; bot re-lê o evento e refaz a checagem antes de transicionar; todas as rotas de mutação passam por assertEventEditable; relaxar transferEventOwner não escala privilégio (rota é `manage Event`, staff/admin); checks do migration usam sql template com literais estáticos (sem injeção); precondição não é alcançável por input de request. | ✅ |

Skills: emil-design-eng (pill/diálogo de arquivamento), task-done-check (roteiro), security-review (checklist manual sobre `git diff origin/main...HEAD` — a skill rodou do checkout principal e viu diff vazio).

Q do doc-005: Q26 (revisada 2026-09-16) — confere. Nada fora do escopo: a única regra adjacente tocada foi `transferEventOwner` em finished, que é exatamente o "permite editar dados" do AC#2.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adiciona o estado final `archived` depois de `finished` (Q26 revisada 2026-09-16): finished encerra o jogo e continua aceitando acerto de dados, taxa e loot splits; archived fecha o evento de vez. Máquina compartilhada ganhou a aresta finished→archived (archived terminal, cancelled→archived recusado de propósito); banco ganhou archived_at com checks de consistência e o valor do enum via migration (checks por ::text para o literal novo poder ser usado na mesma transação). Edição de evento arquivado passa por um guard único — assertEventEditable → 409 "Evento arquivado não pode mais ser editado." — que a F5 (TASK-027/028) reaproveita no serviço de split. Arquivar exige nenhum split em rascunho via precondição plugável avaliada dentro da transação, com o evento travado por `for update`. Painel distingue os dois estados por ícone, texto e cor, com ação "Arquivar evento" para owner/staff atrás de diálogo de confirmação; embed do arquivado fica sem botão e o bot ganhou /evento arquivar. Verificado com: pnpm quality completo verde (lint 0, typecheck ok, coverage branch 91.37%, e2e 50/0, imagem Docker build+smoke, audit 0 high+), testes novos na máquina (49 pares), no repo, no HTTP (owner/staff arquivam, membro 403, archived→qualquer 409, edição 409, precondição bloqueia), e2e desktop 1280 + mobile 400, screenshots nos dois temas lidos pelo agent e security-review sem achados.
<!-- SECTION:FINAL_SUMMARY:END -->
