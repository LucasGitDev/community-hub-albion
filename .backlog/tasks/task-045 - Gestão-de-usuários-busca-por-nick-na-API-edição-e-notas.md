---
id: TASK-045
title: 'Gestão de usuários: busca por nick na API, edição e notas'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-16 16:34'
updated_date: '2026-09-16 20:32'
labels:
  - admin
  - web
  - backend
dependencies: []
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Melhorias de qualidade de vida na lista de membros do admin (TASK-043): buscar/revalidar o nick direto na API do Albion pela linha do usuário, editar dados do usuário (nick, tag de guilda) e registrar notas internas por usuário (histórico append, autor e data). Notas são visíveis só para staff/admin.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Linha do usuário tem ação de buscar nick na API do Albion e atualiza status de validação sem recarregar a página
- [x] #2 Staff/admin consegue editar nick e tag de guilda do usuário, com validação do formato e registro de quem editou
- [x] #3 Notas por usuário: adicionar, listar em ordem cronológica com autor e data; nota não pode ser apagada nem editada
- [x] #4 Membro sem permissão não acessa busca, edição nem notas (API e UI)
- [x] #5 security-review executado sem achados críticos
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
1. shared: validateGuildTag + validateUserNote (limites, PT-BR) em packages/shared/src/member-profile.ts, com testes puros.
2. db: tabela user_notes (append-only: id, user_id, author_id, kind system|staff, body, created_at) + migration aditiva; user-notes-repo.ts com addUserNote/listUserNotes (só insert e select, nenhum update/delete); admin-members-repo ganha getAdminMember e updateMemberProfile (nick + guild_tag).
3. server: AdminMembersController ganha POST :userId/albion-check (reusa ALBION_PLAYER_LOOKUP + setAlbionCheck, nunca lança, devolve o bloco albion atualizado), PATCH :userId (valida formato, grava, registra nota de sistema com quem editou e o que mudou), GET/POST :userId/notes. Tudo com SameOriginGuard + @Authorize no mesmo subject UserRole da lista (admin), que é o dono da tela /admin/membros.
4. web: api/members.ts ganha os 4 endpoints; AdminMembers.tsx ganha coluna de ações por linha (revalidar + editar + notas), diálogo de edição e painel de notas append-only, com toasts sonner e atualização otimista da linha sem recarregar a página.
5. testes: unit shared, http tests (401/403 por papel, validação, append-only), e2e Playwright desktop 1280 + mobile 400 com screenshots.
6. pnpm quality completo + task-done-check + PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Quality gate (pnpm quality, commit 5d6120e, local, Postgres 55433)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issues | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.07% | ≥ 79% | ✅ |
| E2E + screenshots (desktop 1280 / mobile 400) | 56 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.07% | ≤ 15% | ✅ |
| Dead code | 6 (todos pré-existentes em components/ui) | advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

## Skills aplicadas (doc-003)
- emil-design-eng: ações por linha com press/scale, tooltips origin-aware já no design system, nota nova entra com @starting-style 200ms ease-out e respeita prefers-reduced-motion; estado nunca só por cor (ícone + marca à esquerda na nota de sistema).
- ask-sonner: toast.success/warning/error no conferir (achado = sucesso, não achado = aviso, não erro) e no salvar/nota; Toaster já montado em main.tsx.
- frontend-design: tokens existentes de apps/web/src/index.css, dourado só no CTA de import e no número-chave; densidade preservada na tabela.
- task-done-check e security-review: rodados antes do PR.

## Decisões do doc-005 respeitadas
- Q13: permissão granular em código; as 4 rotas novas usam o subject UserRole (só admin), o mesmo da lista da TASK-043. Member, caller e staff levam 403 — provado em teste.
- Q14/Q15: conferência no Albion é ajuda, nunca bloqueio; ALBION_REGION ausente responde 503 em PT-BR e não grava nada.
- Q18: toda a UI e as mensagens de erro em PT-BR; código e tabelas em inglês.
- Nota é append-only (mesma disciplina do ledger): o repositório só tem insert e select, e não existe rota de editar nem apagar.

## AC → evidência

| AC | Evidência | Status |
|---|---|---|
| AC#1 busca na API do Albion pela linha, sem recarregar | server: admin-member-profile.http.test.ts "revalida o nick… grava status, player id, guilda e data", "nick que sumiu… limpa player id e guilda", "sem nick é 400 e consulta desligada é 503". web: linha atualiza pelo mapa `edits` (nenhum refetch). e2e "admin confere o nick…" + screenshot admin-membros-conferir-desligado (1280 e 400) | ✅ |
| AC#2 edição de nick e tag com validação e registro de quem editou | shared: member-profile.test.ts (9 casos de validateGuildTag/describeMemberProfileChange). server: "edita nick e tag, registra quem editou numa nota e zera a conferência antiga", "recusa nick e tag fora do formato, usuário inexistente e nick de outro membro" (400/404/409). e2e edita e confere a linha atualizada + screenshots admin-membros-editar e admin-membros-linha-editada | ✅ |
| AC#3 notas append-only, cronológicas, com autor e data | server: "notas ficam em ordem cronológica, com autor e data, e não têm rota de editar nem apagar" (PATCH/PUT/DELETE → 404), "nota vazia ou longa demais é 400". e2e confere primeira = registro da edição, última = nota nova, e 0 botões de apagar/editar + screenshot admin-membros-notas | ✅ |
| AC#4 sem permissão não acessa (API e UI) | server: "sem sessão 401; member, caller e staff 403 nas três ações" e "escrita de outra origem é 403 e não altera nada", os dois conferindo que nada foi gravado. e2e "membro sem permissão não usa edição, notas nem conferência": tela mostra Acesso negado, 0 botões na UI e as 4 rotas respondem 403 | ✅ |
| AC#5 security-review sem achado crítico | security-review sobre o diff origin/main...HEAD: "No high-confidence security findings". Conferiu política por rota (UserRole + SameOriginGuard nas escritas), parametrização do drizzle no updateMemberProfile, superfície de SSRF (host vem de ALBION_GAMEINFO_HOSTS por env, redirect: error) e vazamento de notas | ✅ |

## DoD → evidência
- DoD#1/#2: gate completo colado acima; cada AC com teste, e2e ou screenshot, nenhum por leitura de código.
- DoD#3: skills listadas acima.
- DoD#4: e2e cobre o fluxo nos dois projetos (desktop 1280 e mobile 400); screenshots revisados pelo agent; e2e também checa ausência de overflow horizontal, console sem erro de aplicação e diálogo navegável por teclado que fecha com Esc.
- DoD#5: escopo bate com os AC (18 arquivos, todos explicados); nada de pós-v1; Qs do doc-005 citadas acima.
- DoD#6: security-review sem crítico.
- DoD#7: 7 commits Conventional atômicos, sem co-autor.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Lista de membros do admin ganhou três ações por linha: conferir o nick na API do Albion sob demanda (grava status, player id, guilda e data, sem recarregar a página), editar nick e tag de guilda, e um histórico de notas internas append-only. A edição vira automaticamente uma nota de sistema com quem editou e o que mudou, e trocar o nick zera a conferência antiga do Albion, que passou a ser de outro personagem. Tabela user_notes nova (migration aditiva 0011) com repositório que só faz insert e select: não existe rota de editar nem apagar nota. As quatro rotas ficam no subject CASL UserRole (só admin) com SameOriginGuard nas escritas; member, caller e staff levam 403. Verificado com 9 testes HTTP, 9 testes unitários das regras compartilhadas, e2e nos dois viewports (1280 e 400) com screenshots, gate completo verde (coverage 89.07%, 58 e2e, 0 vulnerabilidade) e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
