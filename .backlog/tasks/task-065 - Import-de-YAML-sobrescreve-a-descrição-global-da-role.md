---
id: TASK-065
title: Import de YAML sobrescreve a descrição global da role
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 17:37'
updated_date: '2026-09-17 17:53'
labels: []
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-010 - Role-e-build-por-tipo-de-conteúdo.md
priority: high
type: bug
ordinal: 7050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Achado do spike TASK-064 (doc-010), com perda de dado silenciosa.

O YAML de template já trata `description` como propriedade do par (template, role) — ver `packages/shared/src/event-template-yaml.ts:14-22`. O banco não tem onde guardar isso: `event_template_roles` só tem `slots` e `sort_order`, e a descrição vive uma única vez no catálogo global `event_roles`. Então o import despeja a descrição no catálogo (`packages/db/src/event-templates-repo.ts:191`).

Efeito: importar um template de ZvZ com a descrição do "Tank" daquele conteúdo **reescreve o Tank de todos os outros templates**. Ninguém é avisado, e a descrição anterior se perde.

Este bug não espera a decisão de modelagem da TASK-064 (que está congelada): mesmo que a coluna por par nunca exista, sobrescrever silenciosamente catálogo global num import é errado. A correção mínima é não deixar o import escrever por cima de descrição já preenchida, avisando o que foi ignorado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Importar um template não altera a descrição de uma role que já tem descrição no catálogo
- [x] #2 O resultado do import diz explicitamente quais descrições foram ignoradas e por quê
- [x] #3 Role nova, sem descrição no catálogo, continua recebendo a descrição do YAML
- [x] #4 Teste cobre o caso de dois templates com a mesma role e descrições diferentes
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [x] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [x] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [x] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [x] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [x] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirmar no código: importEventTemplate só grava description ao CRIAR role nova (event-templates-repo.ts:180-197); para role existente a descrição do YAML é descartada em silêncio. O vazamento real do doc-010 é a role criada com texto de um conteúdo específico virando catálogo global, somado ao silêncio nos dois lados.
2. Correção defensiva (sem coluna por par, TASK-064 congelada): no import, para cada role já no catálogo — se já tem descrição preenchida e o YAML traz outra, NÃO sobrescreve e registra o nome em `ignoredDescriptions`; se a descrição do catálogo está vazia/nula, preenche com a do YAML (não há dado a perder). Role nova continua nascendo com a descrição do YAML.
3. Propagar `ignoredDescriptions` por EventTemplateImportDbResult → EventTemplateImportResult (shared) → controller → toast do StaffTemplates, com o motivo no texto ('já têm descrição no catálogo; o texto do arquivo foi ignorado').
4. Testes: integração em packages/db cobrindo dois templates com a mesma role e descrições diferentes (AC#4), backfill de descrição vazia (AC#3) e ignoradas reportadas (AC#2); http test do endpoint; e2e em staff-templates.spec.ts para o aviso na tela.
5. Gate: TEST_DATABASE_URL em albion_hub_t065, E2E_PORT=4165, pnpm quality completo; task-done-check; PR sem merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Correção

O import (`packages/db/src/event-templates-repo.ts`) passou a tratar a descrição do YAML como dado
**defensivo**, sem criar coluna por par (a modelagem continua congelada na TASK-064):

- role que **não existe** → nasce no catálogo com a descrição do arquivo (comportamento antigo);
- role que existe **sem** descrição → é preenchida com a do arquivo (não há dado a perder);
- role que existe **com** outra descrição → fica como está e o nome volta em `ignoredDescriptions`.

`ignoredDescriptions` atravessa `EventTemplateImportResult` (shared) → controller → painel. Em
`StaffTemplates` a pré-visualização já avisa **antes de gravar** quais descrições serão ignoradas e
por quê, e o toast de sucesso repete a lista.

## Gate

`pnpm quality` completo, commit `b2331b3a`, ✅ **Passou com avisos**:
Linting 0 · Race conditions 0 · Typecheck ok · coverage 89.36% (≥79%) · E2E 120 ok / 0 falha / 0 flaky
na porta 4165 · imagem Docker build+smoke ok · duplicação 1.71% · audit high+ 0 ·
dead code 6 (advisory, exports de shadcn pré-existentes, nenhum do diff).

## Evidências

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 | `packages/db/src/db.integration.test.ts` "import não sobrescreve descrição já preenchida…" — catálogo continua com o texto da ZvZ depois do import de DG; e2e `staff-templates.spec.ts` confere a linha do catálogo | ✅ |
| AC#2 | mesmo teste (`ignoredDescriptions: ["couraçado"]`), `templates.http.test.ts` (campo no 201) e e2e do aviso na pré-visualização + toast com o motivo | ✅ |
| AC#3 | teste "role sem descrição no catálogo recebe a do arquivo" + teste antigo de role criada com descrição continua verde | ✅ |
| AC#4 | dois templates com a mesma role e descrições diferentes, tanto na integração quanto no HTTP; RED provado: com o fix revertido os dois testes falham com `expected undefined to deeply equal []` | ✅ |
| DoD#1 | resumo do gate acima | ✅ |
| DoD#2 | cada AC com teste/e2e/screenshot, nunca só leitura | ✅ |
| DoD#3 | Skills: task-done-check, emil-design-eng (aviso reusa o padrão de hint existente: ícone + texto + cor, estado distinguível sem depender de cor; nenhuma animação nova) | ✅ |
| DoD#4 | Playwright MCP 1280×860 e 400×860 no fluxo de import: aviso na pré-visualização (singular e plural), toast com a lista, console sem erro, `scrollWidth <= innerWidth` no 400, Esc fecha o diálogo; e2e novo com `snap()` nos três estados | ✅ |
| DoD#5 | Q8 (roles por template a partir de catálogo global) continua valendo — a correção protege o catálogo global em vez de mudar o modelo; nada da TASK-064 entrou | ✅ |
| DoD#6 | não toca auth, ledger, prata nem saque | n/a |
| DoD#7 | dois commits Conventional atômicos, sem co-autor | ✅ |
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Import de YAML deixou de escorrer a descrição do template para o catálogo global: descrição já preenchida é preservada e volta em ignoredDescriptions, role sem descrição é preenchida, role nova continua nascendo com o texto do arquivo. Painel avisa antes de gravar e no toast. Verificado com testes de integração e HTTP (RED provado), e2e novo e revisão visual 1280/400.
<!-- SECTION:FINAL_SUMMARY:END -->
