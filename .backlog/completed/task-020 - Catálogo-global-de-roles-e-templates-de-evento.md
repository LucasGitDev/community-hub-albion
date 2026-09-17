---
id: TASK-020
title: Catálogo global de roles e templates de evento
status: Done
assignee:
  - '@claude'
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 00:06'
labels:
  - events
  - db
  - backend
  - frontend
milestone: m-4
dependencies:
  - TASK-009
priority: high
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Roles por template a partir de catálogo global (Q8); DB é fonte de verdade (doc-002). Skills (doc-003): emil-design-eng, prototype.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff cria/edita roles no catálogo global
- [x] #2 Template define roles do catálogo com quantidade de vagas
- [x] #3 Role em uso por template não pode ser apagada
- [x] #4 Sem permissão, API retorna 403
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
1. shared: zod schemas event-roles/templates (+testes)
2. db: tabelas event_roles, event_templates, event_template_roles (FK restrict, slots>0, unique lower(name)); migration com seed idempotente das 6 roles; repo + testes integração
3. server: EventTemplatesModule com /api/event-roles e /api/event-templates (Authorize EventTemplate, SameOriginGuard), 409 role em uso; testes HTTP 401/403/409
4. web: /staff/templates (catálogo de roles + templates + formulário com vagas), nav gestão; toasts
5. e2e desktop+mobile; visual 1280/400 dark+light; security-review; gate; PR
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisões TASK-020:
- Seed do catálogo (Tank, Healer, DPS Melee, DPS Range, Support, Scout) via migration 0005 com INSERT ... ON CONFLICT DO NOTHING: migration roda uma vez por banco (drizzle registra), então restart não duplica e edição/remoção da staff nunca é sobrescrita (boot seed idempotente ressuscitaria role apagada).
- Sem faixa de moeda por role e sem taxa de entrada no template: moeda temática/ledger é pós-v1 e não tem consumidor na v1; colunas nulas entram depois por migration aditiva barata. Documentado aqui pra TASK-021+.
- Sem templates de conteúdo pré-semeados: a staff cria no painel (tamanhos do doc-001 ficam como exemplo na copy).
- Regra do template: min<=max (max null = sem teto, PvP Roaming), soma de vagas <= max e >= min; vagas > 0; cada role uma vez.
- Apagar role em uso: 409 PT-BR (checagem explícita) + FK on delete restrict como barreira final.

Gate (local, commit c2203468): ⚠️ passou com avisos — lint 0, race 0, typecheck ok, coverage branch 94.19% (≥79), e2e 34 ok/0 falhas (desktop 1280 + mobile 400), imagem Docker build+smoke ok, duplicação 0%, audit 0 high. Aviso não bloqueante: dead code 7 (exports shadcn pré-existentes).

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 staff cria/edita roles | templates.http.test.ts 'staff cria e edita role; duplicado 409, inválido 400, outra origem 403'; db.integration 'cria e edita role; nome único sem diferenciar maiúsculas'; e2e staff-templates cria role | ✅ |
| AC#2 template com roles e vagas | templates.http.test.ts 'staff cria template com roles e vagas, edita parcial e valida party'; e2e cria 'Caçada' 3–7 com vagas; screenshot templates-1280-dark.png | ✅ |
| AC#3 role em uso não apaga | templates.http.test.ts 409 'em uso por um template'; db.integration FK restrict rejeita DELETE direto; e2e botão desabilitado + DELETE 409 | ✅ |
| AC#4 sem permissão 403 | templates.http.test.ts 'membro 403 em tudo; caller só lê' + 401 sem sessão; e2e 'membro sem permissão não abre templates nem a API' | ✅ |
| DoD#4 visual | .playwright-mcp/templates-{1280,400}-{dark,light}.png e templates-form-{1280,400}-dark.png lidos pelo agent: hierarquia (ouro só no CTA, número-chave e nav ativa), Inativo com ícone+texto, sem overflow (scrollWidth 385 ≤ 400), console sem erro, copy PT-BR | ✅ |
| DoD#6 security-review | sem achado: todas as rotas com @Authorize, mutações com SameOriginGuard, zod em todo body, sem SQL dinâmico com entrada do usuário | ✅ |

Skills: emil-design-eng, marclou-review (CTA passou de 'Novo template' para 'Criar template'), ask-sonner (toasts de sucesso/erro com descrição), security-review, task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Catálogo global de roles (seed de 6 na migration, editável pela staff) e templates de evento com vagas por role, expostos em /api/event-roles e /api/event-templates (leitura caller+staff, escrita staff) e na tela /staff/templates. Verificado com testes unitários dos schemas zod, integração no Postgres (nome único sem caixa, FK restrict, vagas>0), testes HTTP (401/403/409/400) e e2e desktop+mobile, além de screenshots 1280/400 nos dois temas.
<!-- SECTION:FINAL_SUMMARY:END -->
