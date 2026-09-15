---
id: TASK-010
title: Login e gate de permissões no painel web
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-15 06:14'
labels:
  - frontend
  - auth
milestone: m-1
dependencies:
  - TASK-009
  - TASK-004
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Front usa as mesmas abilities CASL para mostrar/ocultar áreas (Q13). Skills (doc-003): emil-design-eng, revenue-centric-design (activation no primeiro login).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Usuário deslogado vê tela de login com Discord em PT-BR
- [x] #2 Usuário logado vê apenas navegação permitida pelo seu papel
- [x] #3 Rota sem permissão acessada direto mostra estado de acesso negado
- [x] #4 security-review executado sem achados críticos
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
1. Dev-login no server protegido por env (proibido em produção) pra e2e. 2. AuthProvider (/api/auth/me) + abilities CASL no painel. 3. Login real com erros PT-BR. 4. Navegação e rotas por permissão com estado de acesso negado. 5. Estado vazio da carteira (ativação). 6. e2e com Postgres.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (Postgres): lint 0, race 0, typecheck ok, coverage 98.44%, e2e 16/16, image ok, dup 0%, dead 0, vulns 0.
Evidências:
- AC#1: e2e 'deslogado vê login com Discord' (/carteira → /entrar; link /api/auth/discord; ?erro=nao-membro mostra texto PT-BR do shared). Screenshot .playwright-mcp/t010-login-400.png.
- AC#2: e2e 'navegação segue o papel' (membro sem gestão; caller vê Eventos e não Fila; staff vê Fila e não Papéis). Itens usam ability.can com as regras de packages/shared.
- AC#3: e2e 'rota sem permissão acessada direto mostra acesso negado' (URL mantida, heading Acesso negado, dados da fila não renderizados). Screenshot t010-denied-400.png.
- AC#4: revisão de segurança focada: dev-login só registrado com AUTH_DEV_LOGIN=true, env recusa true com NODE_ENV=production, imagem/compose não definem a flag, exige mesma origem e valida corpo (zod); painel não guarda token (cookie httpOnly), gate de UI não substitui guard da API. Sem achados High/Medium. Risco: ambiente não-produção exposto publicamente com a flag ligada permitiria login arbitrário — manter a flag só em dev/e2e.
Decisões: identidade real (sessão) + ledger/saques ainda de demonstração no localStorage chaveados por Discord ID até a F5; e2e agora exige Postgres (CI e2e ganhou service); estado vazio da carteira com 3 passos e sem botão de saque desabilitado (revenue-centric-design: empty state que direciona; marclou-review #22 um CTA). Console mostra 401 do /api/auth/me quando deslogado (esperado).
Skills: revenue-centric-design, emil-design-eng, frontend-design, security-review (manual), task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Painel com login Discord real (sessão da API), navegação e rotas filtradas pelas mesmas permissões CASL da API e estado de acesso negado; e2e usa dev-login protegido por env contra Postgres. Verificado com pnpm quality (16 e2e) e screenshots 400/1280.
<!-- SECTION:FINAL_SUMMARY:END -->
