---
id: TASK-039
title: Descrição e build por role
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 23:39'
labels:
  - db
  - backend
  - frontend
dependencies: []
priority: low
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cada role do catálogo ganha descrição e, futuramente, uma página de build. Nesta task: campo de descrição editável e exibido onde a role aparece.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff edita descrição da role
- [x] #2 Descrição aparece no painel (templates, roster, inscrição)
- [x] #3 Descrição é opcional e não quebra roles existentes
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
1. Descoberta: o campo `event_roles.description` JÁ existe desde a migration 0005 (TASK-020), com `eventRoleInputSchema`/`eventRolePatchSchema`, `EventRoleDto.description` e persistência no repo. Nenhuma migration nova é necessária — o campo já é nullable, então AC#3 (opcional, não quebra role existente) é estrutural. Registrar a decisão nas notas.
2. Shared: expor a descrição onde a role aparece — `EventTemplateDto.roles[].description` e `EventRoleSlotDto.description`. A descrição é lida ao vivo do catálogo (fonte única) via `role_id`; `null` quando a role do catálogo foi apagada (slot guarda só o nome congelado). Assim editar a descrição reflete em evento já aberto.
3. DB: `loadTemplates` e `loadEvents` trazem `event_roles.description` no join (left join no caso do evento, porque `role_id` é nullable).
4. Web /staff/roles: coluna "Descrição" entre "Role" e "Uso" (remover o comentário reservado da TASK-040); edição inline passa a editar nome + descrição juntos (textarea, limite EVENT_ROLE_DESCRIPTION_MAX=200, contador), com toast sonner de sucesso/erro. Vazio/carregando/erro já tratados na página.
5. Web: descrição visível onde a role aparece — /staff/templates (linha da role), roster do evento em /staff/events e, principalmente, no botão de inscrição em /events (tooltip + aria-label), que é onde o jogador decide.
6. Discord: embed de evento ganha a descrição da role em linha secundária sob o nome, só quando existe e truncada, pra não poluir. Botões ficam inalterados (label de botão tem 80 chars e a contagem já ocupa).
7. Segurança: escrita continua sob a mesma permissão do catálogo (update EventTemplate). Teste http cobrindo membro sem permissão recebendo 403 ao tentar PATCH de descrição. Rodar skill security-review.
8. Testes: unit shared, integration db, http do server, embed snapshot, e2e novo cobrindo editar descrição na /staff/roles e ver na inscrição; screenshots 1280 e 400.
9. Gate: E2E_PORT=4191, POSTGRES_PORT=55441, pnpm quality completo; task-done-check antes do PR.
10. Fora de escopo (anotado, não implementado): página de build por role em /staff/roles/:id — o nome da role na tabela fica pronto pra virar link quando a task existir.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Descoberta que mudou o plano: nenhuma migration nova

O campo `event_roles.description` **já existe** desde a migration `0005` (TASK-020), nullable, com
`eventRoleInputSchema`/`eventRolePatchSchema` (texto livre, trim, vazio → null, teto
`EVENT_ROLE_DESCRIPTION_MAX = 200`), `EventRoleDto.description` e persistência no repo. O que faltava era
tudo depois do catálogo: ninguém escrevia e ninguém lia. Então a task não criou a `0016` — inventar uma
coluna nova seria duplicar a existente. AC#3 (opcional, não quebra role existente) é estrutural: a coluna
já é nullable e todas as roles do seed continuam com `null`.

## Decisão: descrição lida ao vivo, não congelada na vaga

`event_role_slots` congela o **nome** da role na criação do evento (snapshot, Q9). A descrição **não** foi
congelada: ela é lida do catálogo por `role_id` (left join). Motivo: o valor da descrição é orientar quem
vai se inscrever, e staff corrigir o texto tem que alcançar evento que já está aberto — congelar deixaria
a instrução errada no ar. Quando a role sai do catálogo (`role_id` vira null), a descrição some e o nome
congelado segura a exibição. Coberto em `db.integration.test.ts` e `events.http.test.ts`.

## Onde a descrição aparece

- **/staff/roles** (escrita, AC#1): coluna "Descrição" entre "Role" e "Uso" (o comentário reservado da
  TASK-040 saiu). Nome e descrição editados juntos, um PATCH só; textarea com contador, Ctrl/Cmd+Enter
  salva, Esc cancela. Role sem descrição não vira célula vazia: vira o botão `Descrever`. StatCard novo
  "Sem descrição" com a consequência ("quem se inscrever escolhe no escuro"). Toast sonner diz o efeito:
  "Quem for se inscrever em X vai ler a descrição."
- **/eventos** (leitura, o lugar que importa): `details` "O que cada role faz" logo abaixo dos botões de
  role, fechado por padrão. `details` em vez de tooltip porque a inscrição acontece no celular, que não
  tem hover; abre no toque e no teclado. A descrição também entra no `aria-label` do botão da role.
- **/staff/eventos** (roster): descrição sob o nome da role — é por ela que o caller julga quem está na
  role certa antes de mover alguém.
- **/staff/templates**: hover/foco da pill da role (borda tracejada sinaliza que tem texto). O card é
  resumo; despejar o texto de cada role ali enterraria o que o card existe pra mostrar.
- **YAML do template**: o import já criava a role do catálogo com a descrição, mas o export a jogava fora.
  Round-trip fechado — mandar o template pra outro servidor não perde mais o que a staff escreveu.
- **Embed do Discord**: campo único "O que cada role faz" antes da lista. Os campos de role são `inline`
  (três colunas estreitas) e a descrição dentro de cada um empurraria o roster pra baixo. Descrição
  cortada em 120 caracteres e o campo só entra se couber no teto de 25 campos do embed. **Os botões
  ficaram como estavam**: o label do Discord tem 80 caracteres e é a contagem de vagas que muda a cada
  clique — nome + vagas é o que precisa estar ali.

## Fora de escopo (anotado, não implementado)

Página de build por role (`/staff/roles/:id`): o usuário disse "futuramente". Quando a task existir, o
nome da role na tabela do catálogo é o link natural pra ela (registrado no comentário do topo do
`StaffRoles.tsx`).

## Texto livre, sem HTML

A descrição é renderizada como texto em todos os lugares: JSX (React escapa), `stringifyYaml` no export e
campo de embed no Discord. Limite de 200 caracteres validado no zod compartilhado (API e formulário) e
`maxLength` no textarea.

## Quality gate (local, E2E_PORT=4191, POSTGRES_PORT=55441)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 detectada(s) | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.31% | ≥ 79% | ✅ |
| E2E + screenshots | 78 ok, 0 falha, 0 flaky na porta 4191 | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.79% | ≤ 15% | ✅ |
| Dead code | 6 (advisory, todos pré-existentes do shadcn) | 0 advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| AC#1 Staff edita descrição da role | `e2e/staff-role-description.spec.ts` (desktop 1280 + mobile 400): cria role, abre a edição, escreve, salva, toast "Role salva", texto na linha do catálogo. Screenshots `roles-sem-descricao`, `roles-editando-descricao`, `roles-com-descricao`. HTTP: `templates.http.test.ts` "staff cria e edita role" (PATCH com description, vazio → null) | ✅ |
| AC#2 Descrição aparece no painel (templates, roster, inscrição) | Inscrição: mesma spec e2e abre "O que cada role faz" em /eventos e lê o texto (screenshot `inscricao-descricao` nos dois viewports); unit `apps/web/src/lib/events.test.ts` leva a descrição pro `RoleView`. Templates: spec e2e passa pela /staff/templates (screenshot `templates-role-descrita`) + `templates.http.test.ts` "descrição da role acompanha o template e o YAML". Roster: `StaffEvents` usa o mesmo `RoleView`, coberto pelo `EventDto` em `events.http.test.ts`. Discord: `event-embed.test.ts` "descrição da role vira um guia único antes da lista" | ✅ |
| AC#3 Descrição é opcional e não quebra roles existentes | Coluna já nullable desde a `0005`, nenhuma migration nova. `db.integration.test.ts` cria evento com role sem descrição (`description: null`) e mantém o nome congelado quando a role sai do catálogo; `events.http.test.ts" "chega na vaga do evento pelo catálogo…" começa em null e volta a null; `event-embed.test.ts` sem descrição nenhuma não gera o campo; YAML sem descrição não escreve a chave | ✅ |

## Segurança

`security-review`: **nenhum achado**. Verificado: `PATCH /api/event-roles/:id` segue sob `@Authorize("update", "EventTemplate")` + `SameOriginGuard` (a mesma dupla do resto do catálogo; `manage EventTemplate` só staff/admin, caller só `read`), sem endpoint novo; a descrição nunca é aceita pelo lado do evento (é lida do catálogo), então nem o owner do evento escreve. Embed do Discord: `allowedMentions: { parse: [] }` em toda mensagem e o texto vai em `embeds[].fields[].value`, que não pinga — sem injeção de menção; tamanho limitado duas vezes (120 por role, 1000 no campo) e teto de 25 campos respeitado. YAML via `stringifyYaml` (escapa) e re-validado no import. Sem SQL cru (joins parametrizados no Drizzle). Sem `dangerouslySetInnerHTML` no `apps/web`. Exposição: a descrição passa a alcançar quem lê `Event` (membro), que é o objetivo da feature e o mesmo texto que vai pro embed público. Teste de regressão: membro e caller levam 403 no PATCH de `description` e o texto não muda (`templates.http.test.ts").

## Skills invocadas (doc-003)

`emil-design-eng`, `frontend-design`, `ask-sonner`, `security-review`, `marclou-review`, `task-done-check`.

`marclou-review` (UI/escopo): sem 🔴. #11 faz uma coisa só — a página de build ficou de fora, como pedido; #6 uma tela uma ideia — a descrição é coluna, não tela nova; #22/#28 CTA — o dourado continua só no "Adicionar role", "Descrever"/"Salvar role"/"O que cada role faz" dizem o que acontece; #3 números — o StatCard usa número + consequência ("7 · quem se inscrever escolhe no escuro").

## Revisão visual (DoD#4)

Screenshots `fullPage` em 1280×860 e 400×860 revisados pelo agent. Um achado corrigido no caminho: `TableCell` é `whitespace-nowrap`, então a descrição empurrava a tabela pra fora da tela no 400 (coluna "Role" cortada) e o `line-clamp-2` nunca engatava no desktop — resolvido com `whitespace-normal` + `line-clamp-2` nos dois. Depois do fix: sem overflow horizontal, hierarquia preservada (número-chave dourado no primeiro StatCard), estados distinguíveis por ícone + texto + borda.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A role do catálogo passou a carregar uma descrição de verdade: a staff escreve na própria linha em /staff/roles (nome e descrição num PATCH só, textarea com contador, botão 'Descrever' no lugar de célula vazia) e o texto aparece onde a role aparece — no card do template, no roster do evento, no embed do Discord e, principalmente, logo abaixo dos botões de inscrição em /eventos, num 'O que cada role faz' que abre no toque e no teclado, porque é no celular que a galera escolhe a role.

Duas decisões guiaram o resto: **nenhuma migration nova** (o campo já existia nullable desde a 0005, então AC#3 é estrutural) e **descrição lida ao vivo do catálogo**, não congelada na vaga do evento — staff corrigir o texto tem que alcançar evento já aberto, e quando a role sai do catálogo sobra o nome congelado. A página de build por role ficou de fora de propósito ('futuramente'), com o lugar dela anotado no código.

Verificado com: pnpm quality completo verde (lint 0, typecheck ok, cobertura de branch 89.31% ≥ 79%, 78 e2e sem falha na porta 4191, imagem Docker com smoke ok); e2e novo cobrindo escrever a descrição e lê-la na inscrição nos dois viewports, com screenshots 1280 e 400 revisados pelo agent (um overflow de tabela no 400 foi achado e corrigido nessa revisão); testes de API provando que membro e caller levam 403 no PATCH de descrição; integration provando que a edição alcança evento aberto e que role apagada não quebra a vaga; security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
