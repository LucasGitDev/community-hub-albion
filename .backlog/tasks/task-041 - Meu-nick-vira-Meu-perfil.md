---
id: TASK-041
title: Meu nick vira Meu perfil
status: Done
assignee:
  - '@claude'
created_date: '2026-09-16 03:45'
updated_date: '2026-09-17 00:32'
labels:
  - frontend
  - backend
dependencies: []
priority: low
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Renomear e ampliar a página /nick para /perfil, base para futuras configurações e perfil compartilhável no servidor. Nesta task: nick + dados básicos do Discord + papéis, sem novas configurações.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rota /perfil mostra nick, conta Discord e papéis
- [x] #2 Fluxo de registro/troca de nick continua igual
- [x] #3 Navegação e textos atualizados; /nick redireciona para /perfil
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
1. Ler doc-003/005/006; mapear Nick.tsx, AppShell, main.tsx, /api/auth/me e specs e2e que usam /nick.
2. Criar apps/web/src/pages/Profile.tsx: cabeçalho de identidade (avatar/iniciais, nick, @username do Discord, papéis), tira de resumo (saldo disponível com link pra carteira + saques em aberto), e o bloco de nick EXATAMENTE com o fluxo atual (form, pendente, recusa, troca) + trilha 'Como funciona'. Dados só da sessão (/api/auth/me) e dos providers existentes; sem endpoint novo.
3. Rota /perfil em main.tsx e <Navigate to='/perfil' replace> em /nick; AppShell: item 'Meu perfil' -> /perfil; Wallet.tsx aponta os links de nick pra /perfil.
4. Tratar carregando (skeleton), erro (retry) e vazio (sem nick -> CTA de registrar).
5. Testes: e2e nick.spec.ts -> profile.spec.ts com /perfil, spec própria do redirect /nick -> /perfil, staff-members.spec.ts atualizado; teste de server garantindo que /api/auth/me devolve só o usuário da sessão (id nunca vem do cliente).
6. security-review + task-done-check; pnpm quality completo com E2E_PORT=4192 e Postgres na 55442; screenshots 1280/400 revisados.
7. Commits atômicos + PR citando TASK-041.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação
/perfil (apps/web/src/pages/Profile.tsx, sucessora de pages/Nick.tsx): faixa de identidade (avatar do Discord ou iniciais, nick aprovado, pílula de estado do nick, saldo disponível + reservado e link pra carteira), painel 'Nick do Albion' com o fluxo de registro/troca **inalterado** (TASK-012, Q14/Q31), trilha 'Como funciona', 'Conta do Discord' (@usuário, nome exibido, ID) e 'Seus papéis' (ROLE_LABELS + o que cada papel libera).

Sem endpoint novo: identidade vem de /api/auth/me via useCurrentUser (AuthProvider passou a expor username e avatar, que a resposta já trazia) e saldo do WalletProvider. Nenhum id de usuário sai do cliente.
/nick virou <Navigate to='/perfil' replace>; menu e Carteira apontam pra /perfil.
Estados: carregando (skeleton), erro (alerta + 'Tentar de novo'), sem nick (CTA 'Enviar para aprovação'), pendente, recusado, aprovado.

## Quality gate (local, E2E_PORT=4192, Postgres 55442)
Passou com avisos: lint 0, race 0, typecheck ok, coverage branch 89,22% (≥79%), e2e 78 ok / 0 falha / 0 flaky (desktop 1280 + mobile 400), imagem Docker build + smoke ok, duplicação 1,79%, audit 0 high+. Aviso advisory: dead code 6 itens, todos exports pré-existentes de components/ui (button, dialog, table, tabs), não tocados nesta task.

## Evidências
| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 rota /perfil com nick, conta Discord e papéis | e2e/profile.spec.ts 'perfil mostra conta do Discord e papéis...' (região 'Conta do Discord' com @perfilado, região 'Seus papéis' com Membro, nick e saldo) + screenshot perfil-completo 1280/400 | ✅ |
| AC#2 registro/troca de nick igual | e2e/profile.spec.ts 'membro novo registra nick pela carteira e corrige a pendente' e 'membro aprovado pede troca e mantém nick e acesso'; e2e/staff-members.spec.ts (aprovação e recusa) sem mudança de fluxo | ✅ |
| AC#3 navegação/textos e /nick → /perfil | e2e/profile.spec.ts (goto /nick termina em /perfil; clique em 'Meu perfil' no menu) + verificação ao vivo com Playwright MCP (location.pathname = /perfil) | ✅ |
| DoD#1 gate | resumo acima, .quality/summary.md | ✅ |
| DoD#4 visual 1280/400 | screenshots do e2e (perfil-sem-nick, perfil-nick-pendente, perfil-nick-aprovado, perfil-completo) + Playwright MCP ao vivo: sem overflow horizontal (1265≤1280, 385≤400), console 0 erros, foco de teclado visível | ✅ |
| DoD#6 security-review | sem achado; /api/auth/me e /api/me/nick derivam o usuário só da sessão; URL do avatar tem host e esquema literais; teste novo em auth.http.test.ts prova que query/header com outro id são ignorados | ✅ |

## Skills (doc-003)
emil-design-eng, frontend-design (faixa de identidade, hierarquia, densidade), ask-sonner (toast de nick mantido, sem Toaster novo), marclou-review (#6/#22: tirado o botão duplicado 'Ver carteira' do cabeçalho; trilha vira 'Como funciona a troca de nick' quando já aprovado), security-review, task-done-check. revenue-centric-design não foi aplicada: o onboarding de nick não mudou nesta task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A página 'Meu nick' virou '/perfil': identidade do membro (nick aprovado, conta do Discord e papéis) com um resumo curto do saldo ligando à carteira, mantendo intacto o fluxo de registro e troca de nick. /nick redireciona pra /perfil. Verificado com e2e (3 specs, desktop 1280 e mobile 400, screenshots revisados), teste de servidor provando que /api/auth/me ignora usuário vindo do cliente, security-review sem achado e pnpm quality completo (só aviso advisory de dead code pré-existente).
<!-- SECTION:FINAL_SUMMARY:END -->
