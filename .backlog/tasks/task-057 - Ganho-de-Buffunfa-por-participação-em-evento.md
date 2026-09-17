---
id: TASK-057
title: Ganho de Buffunfa por participação em evento
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:04'
updated_date: '2026-09-17 19:01'
labels: []
milestone: m-6
dependencies:
  - TASK-056
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Primeira fonte de Buffunfa: comparecer a um evento. O valor é por role, dentro de uma faixa obrigatória do template, e o caller ajusta até o fechamento — serve para forçar o preenchimento de vaga escassa (faltam tanks, o caller sobe tank). A faixa é obrigatória, sem opção de deixar aberta, porque Buffunfa é criada do nada: caller generoso demais fura o sink e o ledger não volta atrás (F6-8).

Quem recebe é quem teve presença de pelo menos 90% do tempo de vida da call, no mesmo relógio que a prata já usa. A regra é binária: bateu os 90%, recebe o valor cheio. Proporcional em número de uma casa vira "2,7" e arredonda para nada — a prata é divisão de bolo, a Buffunfa é prêmio de comparecimento (F6-10).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 O template de evento define uma faixa obrigatória de Buffunfa por role; não existe forma de deixá-la aberta
- [x] #2 O caller ajusta o valor de uma role específica dentro da faixa, até o fechamento do evento
- [x] #3 O valor vigente no fechamento vale para todos os participantes daquela role, inclusive quem se inscreveu antes de uma alteração
- [x] #4 Recebe o valor cheio quem teve presença de 90% ou mais do tempo de vida do canal de voz; abaixo disso não recebe nada
- [x] #5 Evento sem presence_channel_id não paga Buffunfa a ninguém, e a tela de fechamento avisa o caller disso antes de fechar
- [x] #6 O pagamento gera lançamento de Buffunfa no ledger no fechamento, visível no extrato do membro
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
1. Migration aditiva 0019: faixa obrigatoria de Buffunfa em event_template_roles (buffunfa_min/buffunfa_max, check max >= min >= 0); snapshot da faixa + valor vigente em event_role_slots (buffunfa_min/max/value, check value entre min e max); events.buffunfa_paid_at como chave de idempotencia do pagamento; novo valor 'event_attendance' no enum ledger_entry_kind.
2. shared: LEDGER_ENTRY_KINDS ganha event_attendance com rotulo PT-BR; novo modulo event-attendance.ts com ATTENDANCE_MIN_PRESENCE_BP = 9000, regra binaria qualifies(presenceMs, windowMs) e attendanceAward(candidatos, valor por role, janela) puro e testado; schemas zod da faixa no template e do ajuste de valor por role no evento.
3. db: faixa no event-templates-repo (leitura, insert, update) e copia da faixa + valor inicial (minimo da faixa) para event_role_slots na criacao do evento; novo event-attendance-repo com setEventRoleBuffunfa (recusa fora da faixa, so ate o pagamento) e payEventAttendance (transacao, lock do evento, reusa listEventPresence, grava um ledger_entry buffunfa por participante elegivel, carimba buffunfa_paid_at; idempotente).
4. server: EventAttendanceService + endpoints GET/PATCH/POST em events/:eventId/attendance, mesma autorizacao distribute do split; evento sem presence_channel_id devolve aviso e nao paga.
5. web: passo novo 'Buffunfa por presenca' no EventSettlement (valor por role dentro da faixa, quem bate 90%, aviso de evento sem canal medido, botao de pagar) usando --brand e Amount currency=buffunfa sem abreviar; faixa obrigatoria por role no editor de template.
6. Testes: unitarios em shared, integracao no db (elegibilidade, idempotencia, sem canal, valor do fechamento vale para todos da role), http no server, e2e do fluxo + screenshots 1280/400.
7. Gate completo, skills task-done-check e emil-design-eng, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação

**Onde ficou o quê**
- Faixa obrigatória por role em `event_template_roles` (buffunfa_min/max) e snapshot + valor vigente em `event_role_slots`; `events.buffunfa_paid_at` é a chave de idempotência. Migration aditiva **0020** (renumerada depois de a TASK-059 ocupar a 0019).
- Regra pura em `packages/shared/src/event-attendance.ts`: corte binário de 90% comparado em inteiros, valor por role, motivo por linha de quem não recebe.
- `packages/db/src/event-attendance-repo.ts`: `setEventRoleBuffunfa` (faixa + só até o pagamento) e `payEventAttendance` (transação, `for update` no evento, reusa `listEventPresence` do split, carimbo com `where buffunfa_paid_at is null`).
- `/api/events/:id/attendance` (GET prévia, PATCH roles/:slotId, POST payout) com a mesma porta do split (`distribute` no evento + SameOriginGuard).
- Passo 4 do acerto em `apps/web/src/components/EventBuffunfa.tsx`; faixa por role no editor de template; `Step` extraído para `settlement-step.tsx`.

**Decisões tomadas aqui (não estavam no doc-005)**
1. O valor vigente vive na vaga do evento (`event_role_slots`), não no template: a faixa é snapshot pelo mesmo motivo das vagas — editar o template não pode mudar o prêmio de um evento publicado.
2. O valor **nasce no mínimo** da faixa: subir para preencher vaga escassa é decisão do caller, não default.
3. Fechamento da Buffunfa é um **passo próprio** (passo 4 do acerto), com botão e carimbo próprios, e não um efeito do finish nem da confirmação do split: o split pode ter N levas e a Buffunfa é paga uma vez.
4. Depois do pagamento o valor por role **congela** (409 `already_paid`): o ledger é imutável, mudar o número depois só mentiria na tela.
5. Recebe só quem tinha **inscrição ativa com role** (o valor é por role; presente sem inscrição não tem role, então não tem valor). A linha aparece com o motivo.
6. No **YAML** a faixa é opcional com default 0 (na API e na UI é obrigatória): template exportado antes da F6 continua importando, e 0 a 0 é role que não paga — nunca faixa aberta.
7. Teto de schema `BUFFUNFA_ROLE_MAX = 10.000` por role: sem teto, um zero a mais no template viraria inflação que o ledger não desfaz.
8. `amountSchema` saiu do loot split para `currency.ts` (as mensagens de prata continuam idênticas), e o cliente web serializa a faixa como string — `JSON.stringify` não serializa bigint.

**Gate** (commit 710d5da, porta E2E 4157): lint 0, race 0, typecheck ok, coverage 90.08% (≥79%), e2e 134 ok / 0 falha, imagem Docker ok, duplicação 1.86%, audit 0 high. Dead code 6 (advisory, exports de shadcn pré-existentes).

## Evidências por AC

| AC | Evidência | Status |
|---|---|---|
| #1 faixa obrigatória no template, sem deixar aberta | `packages/shared/src/event-templates.test.ts` (schema exige os dois extremos), `event-attendance.test.ts` "faixa de Buffunfa da role (F6-8)", check `event_template_roles_buffunfa_range` na migration 0020, integração "a faixa do template vira snapshot na vaga e o valor nasce no mínimo", e2e `buffunfa-template-faixa-D/M.png` | ✅ |
| #2 caller ajusta dentro da faixa até o fechamento | integração "o caller mexe no valor dentro da faixa e o banco recusa fora dela" (40 ok, 41 e 9 recusados), http "aceita valor dentro da faixa e recusa fora dela com a frase da faixa" (200/409/400), e2e `buffunfa-fora-da-faixa` + `buffunfa-valor-aplicado` | ✅ |
| #3 valor do fechamento vale para todos daquela role | integração "paga cheio quem bateu 90%... com o valor do fechamento" (valor sobe **depois** das inscrições e é o pago) e "todos da mesma role recebem o mesmo valor, seja qual for o instante da inscrição" (22 BUF para os dois) | ✅ |
| #4 ≥90% recebe cheio, abaixo não recebe nada | `event-attendance.test.ts` "90% em ponto é dentro; um milissegundo abaixo é fora", integração 95% paga 35 / 89% paga 0, http "presença abaixo de 90% não recebe nada" | ✅ |
| #5 evento sem presence_channel_id não paga e a tela avisa antes | integração "evento sem canal de presença não paga a ninguém" (`not_measured`, sem carimbo, saldo 0), http 409 "sem presença medida", `lib/attendance.test.ts` "evento sem canal medido não paga, e a tela diz antes do clique", e2e + screenshot `buffunfa-sem-canal-D/M.png` (aviso + botão desabilitado) | ✅ |
| #6 lançamento de Buffunfa no fechamento, visível no extrato | integração (1 lançamento `event_attendance`/`buffunfa`, memo com a role, prata intacta, idempotente), http "o lançamento aparece no extrato do membro" lendo `/api/me/ledger?currency=buffunfa` | ✅ |

## DoD
- #1 gate: `.quality/summary.md` do commit 710d5da — lint 0, race 0, typecheck ok, coverage 90.08%, e2e 134/0, imagem ok, audit 0 high (dead code 6 advisory, exports shadcn pré-existentes).
- #2 cada AC acima tem teste, e2e, screenshot ou saída de comando.
- #3 Skills: `emil-design-eng` (passo novo e campos do template), `marclou-review` (um CTA principal, números em vez de adjetivos: "1 pessoa recebe — 30 de Buffunfa criada no fechamento"), `revenue-centric-design` (default é decisão: o valor nasce no piso da faixa; o ganho aparece no extrato e no chip, que é o que faz voltar ao evento), `security-review`, `task-done-check`.
- #4 visual: screenshots desktop 1280 e mobile 400 anexados pelo e2e (`buffunfa-*-D/M`) e revisados — hierarquia com o total em ouro `--brand`, aviso com ícone + borda + texto (não só cor), campo inválido com borda + mensagem, sem overflow em 400px.
- #5 confere com F6-8 a F6-11; nada de taxa de entrada (058) nem loja (059) entrou.
- #6 security-review sem achado: autorização `distribute` nas três rotas (membro e caller de outro evento 403), SameOriginGuard nas de escrita, slot escopado ao evento (sem IDOR), valor com quatro camadas de limite (zod, teto 10.000, faixa do template que só a staff edita, check do Postgres), pagamento idempotente com `for update` + carimbo condicional, SQL parametrizado.
- #7 7 commits Conventional atômicos, sem co-autor.

Guardrail do diff: nenhum `any`/`@ts-ignore`/`eslint-disable` novo, nenhum hex solto, nenhum update/delete em `ledger_entries`. Único `Number()` sobre valor é na serialização do YAML e no teto do schema (≤ 10.000, volta para bigint no parse).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Primeira fonte de Buffunfa: o evento paga por comparecimento. O template passa a exigir uma faixa por role (F6-8), o evento leva a faixa como snapshot e o caller move o valor dentro dela até fechar (F6-9); no fechamento, quem teve 90% ou mais do tempo de vida da call recebe o valor cheio, regra binária, no mesmo relógio da prata (F6-10), e evento sem canal carimbado não paga nada e avisa antes (F6-11). Verificado com 8 testes de integração em Postgres real, 9 testes HTTP (incluindo o lançamento no extrato do membro), 21 testes unitários de regra e da tela, e2e desktop/mobile com screenshots, e gate completo verde (coverage 90.08%, e2e 134/0). Security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
