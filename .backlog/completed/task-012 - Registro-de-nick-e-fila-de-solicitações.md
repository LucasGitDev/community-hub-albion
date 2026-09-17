---
id: TASK-012
title: Registro de nick e fila de solicitações
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 12:55'
labels:
  - backend
  - db
  - frontend
milestone: m-2
dependencies:
  - TASK-009
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Entrada de membros = nick + aprovação staff (Q14). Membro registra nick no painel; troca de nick gera nova solicitação pendente mantendo acesso e nick atual (Q31).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Usuário logado envia nick e a solicitação fica pending
- [x] #2 Só há uma solicitação pendente por usuário
- [x] #3 Troca de nick por membro aprovado cria pendência sem remover acesso nem nick vigente
- [x] #4 Tela de registro em PT-BR; skills doc-003 revenue-centric-design e emil-design-eng aplicadas
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
1. shared: validateNick (Albion 3-16 letras/dígitos) + regras CASL MemberRequest do próprio usuário (create, read own) com testes.
2. db: users.game_nick + tabela nick_requests (status enum, índice único parcial pending) + migration; repo nick-repo (getNickStatus, requestNick upsert atômico na pendente, listPendingNickRequests) + integração.
3. server: módulo nick com GET/POST /api/me/nick (Authorize, CSRF same-origin, zod) + testes HTTP.
4. web: página /nick (sem nick/pendente/aprovado), passo no FirstSteps da carteira, item de nav; emil-design-eng + revenue-centric-design.
5. e2e desktop+mobile com snap; visual Playwright MCP 1280/400; security-review; quality completo; PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, pós-rebase em origin/main 85e3abb): lint 0, race 0, typecheck ok, coverage branch 98.79% (>=79), e2e 20 ok/0 falha/0 flaky, imagem Docker build+smoke ok, duplicação 0%, dead code 0, vulns high+ 0.

Decisões:
- Regra de nick (packages/shared/src/nick.ts, validateNick): 3–16 caracteres, só letras ASCII e dígitos (regra de criação de personagem do Albion Online); trim; comparação sem caixa (sameNick). Usada na API, no dev-login e no form web.
- DB: users.game_nick (nick vigente) + nick_requests (status pending|approved|rejected, decided_at/decided_by/decision_note para TASK-013), índice único parcial (user_id) where status='pending', check pending <=> decided_at null. Migration 0003_nick_requests.
- Pendente duplicada: POST com pendente existente TROCA o nick da pendente (upsert atômico ON CONFLICT no índice parcial; 201 criada / 200 atualizada) em vez de 409 — o membro corrige erro de digitação sem esperar a staff, e AC#2 continua garantido pelo banco (inclusive concorrência). Nick igual ao vigente = 409.
- CASL: member pode create MemberRequest e read MemberRequest do próprio userId; staff segue manage. Rotas: GET/POST /api/me/nick (@Authorize, userId só da sessão, POST exige same-origin).
- Repo pronto p/ TASK-013: listPendingNickRequests, getNickStatus, requestNick, setGameNick.
- dev-login aceita gameNick opcional (só com AUTH_DEV_LOGIN) para e2e do estado aprovado.
- UI: página /nick (item 'Meu nick' na nav desktop e barra mobile) + passo 2 'Registre seu nick do Albion' no FirstSteps da carteira com link. Estados: sem nick → form 'Enviar para aprovação'; pendente → 'Aguardando aprovação da staff' + nick + 'Corrigir nick enviado' (secundário); aprovado → nick atual + 'Pedir troca de nick' com aviso Q31 'Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.'

AC → evidência:
- AC#1: apps/server/src/nick/nick.http.test.ts 'envia nick e a solicitação fica pending'; packages/db/src/db.integration.test.ts nick; e2e/nick.spec.ts 'membro novo registra nick...' (desktop+mobile, snaps nick-sem-nick, nick-erro, nick-pendente).
- AC#2: índice único parcial + testes db 'banco recusa segunda pendente' e 'requisições simultâneas geram uma só pendente'; HTTP 'segunda solicitação troca o nick da pendente'; e2e corrige pendente.
- AC#3: HTTP 'membro aprovado pede troca: pendência criada, nick vigente e acesso mantidos'; db 'membro aprovado que pede troca mantém nick vigente e papel'; e2e 'membro aprovado pede troca e mantém nick e acesso' (snaps nick-aprovado, nick-troca-pendente).
- AC#4: copy PT-BR; skills emil-design-eng (press scale existente, transição só de cor 150ms, sem animação em ação repetida, estados com ícone+texto+borda não só cor) e revenue-centric-design (empty state que direciona, progresso visível no FirstSteps, um CTA principal por estado, default/nudge ao passo seguinte).
- Visual (Playwright MCP, server compilado :4176): .playwright-mcp/task012-carteira-1280.png, task012-nick-vazio-1280.png, task012-nick-pendente-1280.png, task012-nick-pendente-400.png, task012-nick-troca-400.png revisados; scrollWidth 400 = innerWidth; console sem erro. Ajuste após revisão: copy da pendente trocada de 'aviso no Discord' (não existe) para 'seu apelido no Discord passa a ser esse nick' (Q31).

Security review (checklist manual sobre git diff origin/main...HEAD): endpoints exigem sessão (401) e permissão CASL (403); userId vem só da sessão (sem IDOR); POST com checagem same-origin (CSRF) + SameSite=Lax; entrada validada por regex estrita (sem XSS/injeção; Drizzle parametrizado); DTO não expõe decidedBy/nota; Cache-Control no-store; gameNick no dev-login só com AUTH_DEV_LOGIN (proibido em produção). Sem achado crítico. Observação não bloqueante: sem rate limit no POST (impacto limitado a 1 linha pendente do próprio usuário).

Skills: emil-design-eng, revenue-centric-design, task-done-check (checklist), security-review (checklist manual).

Rebase 2 sobre origin/main 4406c60 (TASK-011 merged): conflito só em packages/db/src/index.ts (mantidos exports de admin-roles e nick); sem colisão de migration (0003_nick_requests). pnpm quality completo: lint 0, race 0, typecheck ok, coverage branch 92.13%, e2e 22 ok/0 falha, imagem build+smoke ok, dup 0%, deadcode 0, vulns 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Membro registra/troca nick do Albion em /nick (entrada também pelo FirstSteps da carteira). Nova coluna users.game_nick e tabela nick_requests com uma pendente por usuário garantida por índice parcial; GET/POST /api/me/nick; validação de nick compartilhada; regras CASL do próprio pedido; helpers prontos p/ fila staff (TASK-013). Verificado com testes unit/db/HTTP, e2e desktop+mobile, screenshots 1280/400 e pnpm quality completo verde.
<!-- SECTION:FINAL_SUMMARY:END -->
