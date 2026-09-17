---
id: TASK-047
title: Staff acessa a gestão de usuários
status: To Do
assignee: []
created_date: '2026-09-17 02:19'
labels:
  - admin
  - backend
  - web
dependencies: []
priority: high
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Staff passa a alcançar as quatro capacidades da TASK-045 (buscar/revalidar nick na API do Albion, editar nick e tag de guilda, escrever e ler notas internas), hoje restritas a admin pelo subject UserRole. /admin/papeis continua exclusivo de admin. Provisório até existirem permissões separadas de papéis (ver task de permissions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Staff alcança as quatro capacidades da lista de membros
- [ ] #2 Staff continua sem acesso a /admin/papeis
- [ ] #3 Membro comum segue sem acesso a nada disso (API e UI)
- [ ] #4 security-review sem achados críticos
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->
