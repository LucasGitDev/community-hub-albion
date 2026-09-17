---
id: TASK-013
title: Aprovação de nick pelo painel staff
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 13:37'
labels:
  - backend
  - frontend
milestone: m-2
dependencies:
  - TASK-012
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff aprova ou rejeita solicitações de nick (Q14, Q31). Skills (doc-003): emil-design-eng, ask-sonner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff vê fila de pendentes e aprova ou rejeita
- [x] #2 Aprovação torna o nick vigente; rejeição mantém o anterior
- [x] #3 Usuário sem permissão de staff não acessa a fila nem a API
- [x] #4 Decisão registra quem aprovou/rejeitou e quando
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
1. db: decideNickRequest (approve/reject) transacional em nick-repo com lock FOR UPDATE; approve grava users.game_nick; conflito em não pendente; getNickStatus traz última recusa; testes de integração (audit, nick mantido, dupla decisão, concorrência).
2. server: módulo members com NickDecisionService (approve/reject + listeners NICK_DECISION_LISTENERS p/ TASK-014) + StaffNickRequestsController GET /api/staff/nick-requests, POST :id/approve, :id/reject (Authorize approve MemberRequest, SameOriginGuard, uuid/zod); testes unit + HTTP (401/403/validação/audit).
3. me/nick expõe lastRejection; web /nick mostra motivo da recusa.
4. web /staff/membros: fila com Aprovar nick / Recusar + motivo obrigatório, toasts, empty state; emil-design-eng + ask-sonner.
5. e2e desktop+mobile (aprovar, recusar com motivo, membro sem acesso); visual MCP 1280/400; security-review; quality; PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate (pnpm quality completo, pós-rebase em origin/main): lint 0, race 0, typecheck ok, coverage branch 93.17% (>=79), e2e 28 ok/0 falha/0 flaky, imagem Docker build+smoke ok, duplicação 0%, dead code 0, vulns high+ 0.

Decisões:
- DB: decideNickRequest (packages/db/src/nick-repo.ts) numa transação: UPDATE condicional where status='pending' grava status + decided_by/decided_at/decision_note; aprovar grava users.game_nick; recusar não toca o nick. Só uma decisão vence (inclusive concorrente); não pendente → not_pending (HTTP 409), inexistente → 404. getNickStatus devolve lastRejected (última decisão, se recusa).
- Serviço único: apps/server/src/members/nick-decision.service.ts NickDecisionService.approve(requestId, deciderUserId, note?) / reject(requestId, deciderUserId, note). MembersModule global exporta o serviço p/ bot/embed (TASK-014/015).
- Hook p/ TASK-014: NickDecisionService.onDecided(listener) → retorna unsubscribe; evento {decision, request, previousGameNick (null = primeira aprovação → cargo Membro), deciderUserId}; roda após o commit; erro de listener é logado e não desfaz a decisão (TASK-014 AC#3). Sem chamadas Discord aqui.
- API: GET /api/staff/nick-requests (pendentes, mais antigas primeiro, com displayName, discordUsername, gameNick atual, nick pedido, datas; no-store); POST :id/approve e :id/reject {note}; @Authorize('approve','MemberRequest') + SameOriginGuard; uuid validado; motivo obrigatório 1–300 (validateRejectionNote em packages/shared, reusado no web).
- Membro: /api/me/nick ganha lastRejection {nick, note, decidedAt} (sem decidedBy). /nick mostra card 'A staff recusou o nick X' + motivo quando não há pendente.
- Web /staff/membros: fila com 'nick atual → nick pedido' (ou 'Primeiro nick:'), 'Aprovar nick' primário, 'Recusar' secundário que abre textarea rotulada e 'Confirmar recusa' (desabilitado sem motivo) + 'Voltar'; toasts sonner (success aprovado; neutro recusado; error com mensagem da API e recarrega fila em 409); contador de pendentes; vazio 'Nenhuma solicitação pendente.'

AC → evidência:
- AC#1: HTTP apps/server/src/members/staff-nick-requests.http.test.ts 'staff lista pendentes...' e 'staff aprova...'/'staff recusa...'; e2e/staff-members.spec.ts aprovar e recusar (desktop+mobile, snaps staff-membros-fila, staff-membros-recusa).
- AC#2: db.integration 'aprovação torna o nick vigente...' e 'recusa mantém o nick anterior...'; HTTP /api/me/nick após decisão; e2e membro vê nick aprovado / motivo (snap nick-recusado).
- AC#3: HTTP 'sem sessão 401; membro comum 403 na fila e nas decisões'; e2e 'membro sem permissão não abre a fila nem a API' (Acesso negado + API 403).
- AC#4: db decided_by/decided_at/decision_note conferidos; HTTP decidedBy = staff e decidedAt igual ao gravado; dupla decisão 409 e concorrência só uma vence.
- Visual (Playwright MCP, server compilado :4178): .playwright-mcp/task013-staff-membros-1280.png, task013-staff-recusa-400.png, task013-nick-recusado-400.png, task013-nick-recusado-1280.png (na raiz do checkout onde o MCP salva) revisados; scrollWidth 385 <= 400; console sem erro na porta 4178. Ajuste após revisão: copy sob a recusa trocada p/ 'Você pode enviar outro nick quando quiser.' (membro aprovado não vê formulário abaixo).

Security review (skill security-review viu diff vazio; checklist manual em git diff origin/main...HEAD): rotas exigem sessão (401) e approve MemberRequest (403 p/ member); POSTs com SameOriginGuard (CSRF) + SameSite=Lax; id uuid validado, motivo validado/limitado, Drizzle parametrizado; decisão atômica evita dupla decisão; DTO do membro não expõe quem recusou; React sem HTML cru (motivo renderizado como texto); no-store na fila. Sem achado crítico. Observação não bloqueante: staff pode decidir o próprio pedido de nick (fora do escopo dos ACs).

Skills: emil-design-eng (sem animação em ação repetida da fila, press existente do Button, transição só de cor, estados com ícone+texto+borda), ask-sonner (Toaster único já montado; toast.success/toast/toast.error chamados no handler, não em effect), task-done-check (checklist), security-review (checklist manual).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Staff aprova/recusa nicks em /staff/membros via GET/POST /api/staff/nick-requests. NickDecisionService único (reusável por TASK-014/015, com hook onDecided) sobre decisão transacional no banco que grava nick vigente e auditoria; recusa exige motivo, exibido ao membro em /nick. Verificado com testes db/HTTP, e2e desktop+mobile, screenshots 1280/400 e pnpm quality completo verde.
<!-- SECTION:FINAL_SUMMARY:END -->
