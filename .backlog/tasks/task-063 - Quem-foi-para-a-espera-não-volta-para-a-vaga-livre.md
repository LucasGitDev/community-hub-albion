---
id: TASK-063
title: Quem foi para a espera não volta para a vaga livre
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 17:05'
updated_date: '2026-09-17 17:35'
labels:
  - eventos
  - painel
milestone: m-12
dependencies: []
modified_files:
  - apps/web/src/pages/StaffEvents.tsx
priority: high
type: bug
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fluxo quebrado hoje: o caller manda alguém da role para a lista de espera (botão "↓ espera"). Depois a vaga continua livre — e não há como devolver a pessoa para ela.

Causa no painel: em `apps/web/src/pages/StaffEvents.tsx`, o `SignupRow` monta os botões de destino com `roles.filter((r) => r.slotId !== signup.slotId)`, ou seja, só as **outras** roles. Para quem está na espera da role X, o botão "→ X" nunca aparece, embora seja exatamente o movimento necessário. O backend já aceita: `moveEventSignup` (`packages/db/src/event-signups-repo.ts`) só recusa `already_there` quando a inscrição já está `confirmed` naquela vaga, e a promoção automática existe, mas só dispara quando alguém **sai** da role — mandar para a espera não libera promoção por decisão explícita (senão a pessoa voltaria sozinha).

Efeito no start: `start` arrasta só inscritos confirmados que estão em "Aguardando Evento" (Q29). Quem ficou preso na espera não entra no evento nem com vaga sobrando, e não há saída manual. É o que o usuário observou.

Escopo: devolver o controle manual. Não mexer na regra de promoção automática nem na regra do start.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Na lista de espera de uma role com vaga livre, o painel oferece o botão de mover para essa mesma role
- [x] #2 Mover da espera para a própria role com vaga livre confirma a pessoa e reordena a espera restante
- [x] #3 Com a role lotada, o botão aparece desabilitado com o motivo, igual ao tratamento das outras roles
- [x] #4 Sair da role continua promovendo o primeiro da espera automaticamente, e mandar alguém para a espera continua não promovendo ninguém no lugar dele
- [x] #5 E2E cobre o ciclo: confirmar, mandar para a espera, devolver para a vaga e iniciar o evento com a pessoa sendo arrastada
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirmar no código: SignupRow monta destinos com roles.filter(r => r.slotId !== signup.slotId), escondendo o retorno para a própria role; moveEventSignup só recusa already_there quando já está confirmed na vaga.
2. No painel, calcular os destinos por status: confirmado continua vendo só as outras roles; quem está na espera vê todas as roles, inclusive a própria, com o mesmo tratamento de role lotada (disabled + title).
3. Mostrar a ordem da espera pela posição na lista renderizada (1º, 2º...), para a espera restante ficar coerente depois que alguém sai dela.
4. Não tocar em promoteFirstWaiting nem na regra do start.
5. E2E novo (e2e/staff-waitlist-return.spec.ts): confirmar em Tank, caller manda para a espera, confirma que o botão '→ Tank' aparece, devolve para a vaga, confirma 1/1 e inicia o evento. Verificar que falha antes do fix.
6. pnpm quality completo com E2E_PORT=4163 e TEST_DATABASE_URL do banco albion_hub_t063.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (local, porta E2E 4163)

| Métrica | Resultado | Status |
|---|---|---|
| Linting | 0 issues | ✅ |
| Race conditions | 0 | ✅ |
| Typecheck | ok | ✅ |
| Testes + coverage (branch) | 89.26% (≥79%) | ✅ |
| E2E + screenshots | 118 ok, 0 falha, 0 flaky | ✅ |
| Imagem Docker (build + smoke) | ok | ✅ |
| Duplicação | 1.72% (≤15%) | ✅ |
| Dead code | 6 itens (advisory, pré-existentes em components/ui) | ⚠️ |
| Vulnerabilidades high+ | 0 | ✅ |

## Evidência

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 | e2e/staff-waitlist-return.spec.ts: com Tank 0/1 e alguém na espera, `→ Tank` aparece habilitado; sem o fix o teste falha em `toBeEnabled` (execução RED registrada) | ✅ |
| AC#2 | mesmo spec: clique em `→ Tank` → toast `foi para Tank`, Tank volta a 1/1 e a espera some; a fila restante é numerada pelo índice (1º, 2º), sem buraco | ✅ |
| AC#3 | mesmo spec: com Tank 1/1, o `→ Tank` da espera fica `disabled` com title `Tank está lotada`; screenshot espera-com-role-lotada-D/M | ✅ |
| AC#4 | mesmo spec: descer o confirmado com fila promove o primeiro da espera e exclui quem desceu; `moveEventSignup`/`promoteFirstWaiting` não foram tocados (diff só em StaffEvents.tsx + spec novo) | ✅ |
| AC#5 | mesmo spec cobre o ciclo inteiro: confirmar → espera → volta para a vaga → fechar inscrições → Iniciar evento com os dois confirmados | ✅ |
| DoD#4 visual | screenshots do spec em 1280 e 400 revisados (espera-com-vaga-livre, espera-com-role-lotada, espera-devolvida-para-a-vaga, espera-evento-iniciado) — sem overflow, botões outline iguais aos destinos já existentes, paleta da TASK-055 intacta (nenhum botão novo de cor) | ✅ |
| DoD#5 doc-005 | Q27 (espera por role) e Q29 (start só arrasta confirmados de Aguardando Evento) preservadas; nenhuma regra de servidor alterada | ✅ |
| DoD#6 | não toca auth, ledger, prata nem saque — security-review não se aplica | n/a |

Skills: task-done-check, emil-design-eng (mudança reusa o Button outline xs e o mesmo padrão disabled+title dos outros destinos; nenhuma animação envolvida).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
O painel passou a oferecer a própria role como destino para quem está na lista de espera dela, com o mesmo tratamento de role lotada dos outros destinos, e a ordem da espera passou a ser contada na lista renderizada. Nada mudou no servidor: promoção automática e regra do start intactas. Verificado por e2e novo (staff-waitlist-return.spec.ts) que falha sem o fix, e pelo gate completo verde.
<!-- SECTION:FINAL_SUMMARY:END -->
