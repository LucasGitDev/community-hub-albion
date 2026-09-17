---
id: TASK-023
title: Painel de eventos para caller e membros
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 03:50'
labels:
  - frontend
  - events
milestone: m-4
dependencies:
  - TASK-022
  - TASK-010
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gestão e visualização de eventos no painel, com polling (doc-002). Skills (doc-003): emil-design-eng, prototype, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Membro vê eventos e suas inscrições
- [x] #2 Caller/owner cria evento, abre/fecha inscrições e move inscritos
- [x] #3 Ações indisponíveis ao papel/estado não aparecem
- [x] #4 Estado atualiza por polling sem refresh manual
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
1. API (aditivo, sem tocar apps/server/src/bot): GET /api/events passa a devolver { events, occupancy, mySignups } (uma chamada por tela, AC#4) e GET /api/events/:id/signups passa a devolver { signups, members } com o nick de cada inscrito; EventDto ganha ownerNick. db: listEventOccupancy (agregado por vaga), listMySignups e nomes via join em users.
2. shared: EventOccupancyDto/EventMemberDto + helpers puros reaproveitados pelo painel.
3. web lib/events.ts (dentro do include de coverage): agrupamento por estado (abertos/agora/próximos/encerrados), vagas restantes por role, resolução da minha inscrição (role + posição na espera), ações permitidas por papel+estado (usa canTransition + ability) e helper de polling (intervalo, pausa com aba oculta, rótulo 'atualizado há Xs'). Testes unitários de tudo.
4. web: hook usePolling (visibilitychange, refetch após mutação) e cliente events/api.ts.
5. Página /eventos (todos): cards por evento com vagas enchendo por role, minha inscrição destacada, entrar/sair por role, posição na espera; empty state com próximo passo. Item de nav pessoal.
6. Página /staff/eventos (substitui o Placeholder): criar evento a partir de template, abrir/fechar inscrição, iniciar/finalizar/cancelar conforme a máquina (Q26) e o ability (Q9/Q21), roster por role com mover entre role e espera (Q27), transferir owner (só staff, a partir do roster).
7. AC#3: toda ação passa por ability.can(action, asSubject('Event', { ownerId })) + canTransition; API continua sendo a autoridade.
8. Testes: unitários dos helpers + e2e desktop/mobile (caller cria, abre, membro entra, role lotada vira espera, caller move, caller fecha, membro não vê ação de staff, membro toma acesso negado em /staff/eventos).
9. Visual 1280/400 nos dois temas, security-review, gate completo, notas/ACs/DoD e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisões TASK-023:
- Duas telas, dois papéis: `/eventos` (todo membro; item novo na nav pessoal) mostra o que dá para entrar agora, quantas vagas sobraram em cada role e em que role a pessoa está; `/staff/eventos` (substitui o Placeholder, `create Event`) é a central do caller: cria a partir de template (Q9), conduz a máquina (Q26) e organiza a lista por role (Q27). Separar evita a tela do membro virar painel de controle e a do caller virar catálogo.
- Uma chamada por tela (AC#4): `GET /api/events` passou a devolver `{ events, occupancy, mySignups }` — ocupação contada pelo banco (`listEventsOccupancy`, um group by) e só as inscrições de quem pediu (`auth.user.id`, nunca id do cliente). Sem isso o polling faria uma chamada por evento a cada ciclo. `GET /api/events/:id/signups` ganhou `members` (nick de cada inscrito + do owner) e o EventDto ganhou `ownerNick`: o painel mostra gente, não uuid. Nick = game_nick > display_name > usuário do Discord, num só lugar (`packages/db/src/member-nick.ts`), igual ao que o embed publica.
- Polling (doc-002, realtime fica pra depois): `usePoll` só agenda a próxima busca depois que a anterior voltou (não empilha requisição), não agenda nada com a aba escondida (`document.visibilityState`), busca na hora quando a aba volta e espaça o intervalo de 10s até 1 min enquanto a API falha. Toda mutação chama `refresh()`, então o resultado aparece sem esperar o ciclo.
- Sem contador 'há Xs' na tela: um relógio de 1 s repinta a página inteira o tempo todo (e `react-hooks/purity` barra `Date.now()` na renderização) para informar menos que 'atualiza sozinho a cada 10s'. O texto vem de `POLL_INTERVAL_MS`, a mesma constante do agendamento.
- AC#3 sem tela mentirosa: `availableTransitions` cruza a máquina (`ALLOWED_EVENT_TRANSITIONS`) com `ability.can(EVENT_TRANSITION_ACTIONS[t], asSubject('Event', { ownerId }))`, então o caller só vê ação no evento dele e a staff vê em qualquer um; `canManageRoster` (mover inscrito) exige `update Event` e só antes do start; `canTransferOwner` exige `manage Event` (staff, Q21). O mapa ação→permissão saiu do controller para `@albion-hub/shared`: API e painel leem a mesma tabela, então botão visível é botão que a API aceita — e a API refaz a checagem de qualquer jeito.
- Transferir owner sai do próprio roster (a staff clica em 'Passar o comando' em quem está inscrito), em vez de um seletor com todos os usuários: não existe endpoint de busca de usuário para caller/staff e o caso real é passar o comando para quem está no evento.
- Evento fora de 'open' não vira fileira de botões desligados na tela do membro: vira placar (chips com a contagem), que é o que ainda informa.
- Padrão dense do design system: PageHeader + 4 StatCards (ouro só no número principal), Panel com lista, `EventStatusPill` com ícone+texto+cor (nunca só cor) e `FillMeter` com o número antes da barra.
- `api/http.ts` extraído para os dois clientes (templates e eventos) não duplicarem o mesmo fetch.

Gate completo (local, commit f85a625 sobre 3cd07b29): ⚠️ passou com avisos — lint 0, race 0, typecheck ok, coverage branch 92.73% (≥79), e2e 38 ok/0 falhas/0 flaky (desktop 1280 + mobile 400), imagem Docker build+smoke ok, duplicação 1.13%, audit 0 high. Aviso não bloqueante: dead code 7 (exports shadcn pré-existentes, os mesmos da TASK-020/021/022).

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 membro vê eventos e suas inscrições | e2e events.spec.ts 'caller cria evento...' (membro abre /eventos, vê '0/2 vagas preenchidas', entra em Tank e passa a ver a pílula 'Tank, confirmado' e '1/2 vagas preenchidas'; o segundo membro vê 'Tank, 1º na espera'); events.test.ts groupEvents/roleViews/mySignupFor/mySignupLabel (13 casos); event-signups.http.test.ts 'listagem devolve ocupação por vaga e a inscrição de quem pediu'; screenshots eventos-membro-1280-dark/light | ✅ |
| AC#2 caller cria, abre/fecha e move inscritos | e2e: cria a partir do template pelo diálogo ('Evento criado'), 'Abrir inscrições', move da espera para outra role ('foi para Healer', Healer 1/1), 'Fechar inscrições' e 'Iniciar evento' (pílula 'Acontecendo agora'); screenshots eventos-staff-rascunho/roster e staff-eventos-roster-1280-dark | ✅ |
| AC#3 ação indisponível não aparece | events.test.ts 'ações permitidas' (11 asserções: rascunho só abre/cancela, estado final não oferece nada, caller não vê ação no evento de outro, staff vê, membro não vê nenhuma, roster só até o start, transferir owner só staff); e2e confere ausência de 'Fechar inscrições'/'Finalizar' no rascunho, ausência de ação de caller na tela do membro e 'Acesso negado' em /staff/eventos; API barra o mesmo (403 em /api/events e /api/event-templates para membro, e2e 'membro sem permissão não usa a API de caller') | ✅ |
| AC#4 estado atualiza por polling | events.test.ts nextPollDelay (aba oculta = null, 10s→20s→40s→60s com falhas); e2e vê 'atualiza sozinho' na tela e o evento fechado pelo caller aparecendo fechado para o membro sem refresh manual; usePoll pausa no visibilitychange e refaz a busca após cada mutação | ✅ |
| DoD#4 visual | .playwright-mcp/task023/: eventos-membro-1280-dark.png, eventos-membro-1280-light.png, staff-eventos-1280-dark.png, staff-eventos-roster-1280-dark.png, staff-eventos-1280-light.png, staff-eventos-400-dark.png — revisados pelo agent: hierarquia com o número principal em ouro, estados com ícone+texto+cor, sem overflow horizontal (scrollWidth 385 ≤ 400), console sem erro, mobile empilha lista e detalhe | ✅ |
| DoD#6 security-review | sem achado ≥ confiança 8: mySignups vem sempre da sessão (não de parâmetro), occupancy limitado aos eventos já autorizados, members derivado do próprio evento, todas as consultas novas parametrizadas (inArray/eq; os templates sql só interpolam colunas), uuid validado antes do banco, nenhum dangerouslySetInnerHTML, mapa de permissão por transição idêntico ao anterior | ✅ |

Skills: emil-design-eng, revenue-centric-design (dashboards), ask-sonner, security-review, task-done-check.

Pendência do usuário — conferência manual no painel real: criar evento pela tela com horário marcado e conferir o fechamento automático da inscrição no horário, e confirmar que abrir o evento pelo painel publica o embed no canal do Discord (o toast promete isso).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Painel de eventos em duas telas: /eventos, para qualquer membro, lista o que está aberto com as vagas de cada role, destaca em que role a pessoa está (ou sua posição na espera) e deixa entrar e sair por botão; /staff/eventos substitui o placeholder e dá ao caller a criação a partir de template (Q9), as transições da máquina de estados (Q26) e a lista de inscritos por role com movimentação entre role e espera (Q27), além da transferência de owner pela staff (Q21). Só aparece a ação que o estado e o papel permitem, porque a tela cruza ALLOWED_EVENT_TRANSITIONS com a mesma regra CASL por objeto que a API aplica (asSubject Event/ownerId) — e a API continua sendo a autoridade. Cada tela se atualiza sozinha por polling de 10s (doc-002, sem realtime na v1) que não empilha requisição, pausa com a aba escondida e refaz a busca depois de cada mutação; para isso GET /api/events passou a devolver ocupação por vaga e a inscrição de quem pediu, e a lista de inscritos passou a trazer o nick de cada pessoa. Verificado com 22 testes unitários das regras puras do painel, 2 testes HTTP novos da carga do painel, e2e desktop 1280 e mobile 400 cobrindo criar→abrir→entrar→espera→mover→fechar→iniciar mais o acesso negado do membro, gate completo verde (coverage branch 92.73%, e2e 38/0) e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
