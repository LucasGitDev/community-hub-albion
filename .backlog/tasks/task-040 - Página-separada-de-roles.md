---
id: TASK-040
title: Página separada de roles
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 16:13'
labels:
  - frontend
dependencies: []
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tirar o catálogo de roles de dentro de /staff/templates e dar uma página própria, preparando a futura página de build por role.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rota própria para o catálogo de roles com item na navegação de gestão
- [x] #2 Templates continua funcionando sem o catálogo embutido
- [x] #3 Permissões e estados vazios mantidos
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [x] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Página /staff/roles com catálogo (criar, renomear, apagar). 2. Item Roles na navegação de gestão. 3. Templates perde o catálogo embutido e ganha link. 4. e2e + gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Assumida pelo lead depois do agent parar (worktree tinha a página pronta, sem commit nem testes).
Gate local: lint 0, race 0, typecheck ok, coverage 91.37%, e2e 52/52, imagem ok, dup 1.13%, vulns 0; aviso não bloqueante dead code 7 (exports shadcn pré-existentes).
Evidências:
- AC#1: rota /staff/roles com item 'Roles' na navegação de gestão (mesma permissão update EventTemplate); e2e 'staff cria role…' cria a role pela página nova.
- AC#2: StaffTemplates perdeu RolesPanel/RoleRow (movidos para StaffRoles) e ficou com aviso + link 'Criar a primeira role' quando o catálogo está vazio; e2e de template e de YAML seguem passando.
- AC#3: role em uso mostra 'em N template' e botão de apagar desabilitado; DELETE direto responde 409; e2e novo 'membro sem permissão não abre a página de roles' cobre acesso negado.
Decisões: rota /staff/roles (inglês, como o domínio já usa 'role' em todo o produto); tabela em vez de lista pra caber a futura coluna de descrição (TASK-039), com comentário no código marcando o lugar.
Skills: emil-design-eng, ask-sonner (toasts), task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Catálogo de roles saiu de /staff/templates para a página própria /staff/roles, com item na navegação de gestão, tabela preparada para descrição/build e as mesmas regras de permissão e de role em uso. Verificado com pnpm quality (e2e 52/52).
<!-- SECTION:FINAL_SUMMARY:END -->
