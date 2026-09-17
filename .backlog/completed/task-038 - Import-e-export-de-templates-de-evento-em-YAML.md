---
id: TASK-038
title: Import e export de templates de evento em YAML
status: Done
assignee:
  - '@claude'
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 15:56'
labels:
  - backend
  - frontend
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-001: DB é fonte de verdade; YAML é só import/export. Staff exporta template(s) e importa de volta, inclusive em outro servidor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Staff exporta um template como YAML pelo painel
- [x] #2 Staff importa YAML e o template é criado com roles e vagas
- [x] #3 Import valida schema e reporta erro legível sem gravar nada
- [x] #4 Roles inexistentes no catálogo são criadas ou reportadas conforme decisão registrada
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
1. shared: event-template-yaml.ts — schema zod do YAML (version 1, chaves desconhecidas rejeitadas), serializeEventTemplateYaml (header de comentário) e parseEventTemplateYaml puro (lib 'yaml', aliases desabilitados, limite de 64 KB); testes de round-trip, YAML inválido, chave desconhecida, violação de regra, YAML bomb.
2. db: importEventTemplate — transação única que resolve roles por lower(name), cria as que faltam, grava template + vagas; devolve createdRoles. Testes de integração (all-or-nothing, nome duplicado, role criada).
3. server: GET /api/event-templates/:id/export (text/yaml + Content-Disposition saneado) e POST /api/event-templates/import ({ yaml }), staff-only + SameOriginGuard; testes HTTP 401/403/400/409/413-equivalente.
4. web: /staff/templates ganha 'Exportar' por template e diálogo 'Importar YAML' com pré-visualização (inclui roles que serão criadas) e erro legível; toasts (ask-sonner) e revisão emil-design-eng.
5. e2e desktop+mobile: exporta um template, importa o YAML e o novo template aparece com roles e vagas.
6. security-review, gate completo, screenshots 1280/400 nos dois temas, notas e PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisões TASK-038:
- **Formato YAML (version 1)**, documentado no cabeçalho do próprio arquivo exportado: `version`, `name`, `description?`, `minParty`, `maxParty` (null = sem teto), `active?` (default true), `roles: [{ name, slots, description? }]`. Sem `contentType`: não existe coluna nem consumidor disso na v1 (doc-001 lista tipos de conteúdo só como exemplo de tamanho); entra depois por campo novo sem quebrar o formato. Sem ids: o arquivo existe pra ir pra outro servidor, onde id local não significa nada — doc-001 diz que o DB é a fonte de verdade e o YAML é só transporte.
- **Chaves desconhecidas são erro** (`zod .strict()` nos dois níveis), com mensagem PT-BR traduzida em `yamlIssueMessage`: um typo `minparty` não pode virar calado um template com o tamanho errado. `version` maior que 1 é recusado com instrução em vez de ser lido pela metade.
- **Lib `yaml` 2.9.1, pinada exata** (não `^`): zero dependências, mantida (eemeli), YAML 1.2 completo. Parse com `maxAliasCount: 0` (recusa âncora/alias, então "billion laughs" não passa) e `version: "1.2"` (sem merge keys do 1.1). A lib não tem construtores por tag: `!!js/function` vira texto inerte, nunca função. Teto de 64 KB conferido em bytes antes de interpretar.
- **Roles que faltam no catálogo são CRIADAS** (AC#4), não reportadas como erro: a feature existe pra levar template entre servidores e um servidor novo não tem o catálogo do antigo — recusar transformaria o import num checklist manual. Os nomes criados voltam em `createdRoles`, aparecem na pré-visualização antes de gravar (pill com ícone + frase "Esta role será criada no catálogo…") e no toast depois. Casamento por `lower(name)`, a mesma regra do índice único do catálogo, então "tAnK" reusa a role Tank em vez de duplicar.
- **Nome de template repetido = 409**, não "Nome (2)": renomear é decisão da staff, e um "(2)" silencioso deixaria dois templates quase iguais na lista do caller sem ninguém ter pedido. A mensagem diz o que fazer ("Renomeie no arquivo ou apague o template atual"). Corrida na criação de role é distinguida pelo nome do índice e vira 409 "tente de novo", em vez de 500.
- **Import é tudo-ou-nada**: `importEventTemplate` grava template, vagas e roles novas na mesma transação, com o INSERT do template primeiro — colisão de nome aborta antes de qualquer role nova existir (provado em teste de integração).
- **API**: `GET /api/event-templates/:id/export` (text/yaml, `Content-Disposition` com slug ASCII) e `POST /api/event-templates/import` (corpo JSON `{ yaml }`, não multipart: o painel já fala JSON e não precisa de outra dependência pra mandar texto). Ambos exigem `update EventTemplate` (staff/admin; caller só tem `read`), e o import tem `SameOriginGuard`.

Gate completo (local, commit 23427391): passou com avisos — lint 0, race 0, typecheck ok, coverage branch 92.95% (>=79), e2e 42 ok/0 falhas/0 flaky (desktop 1280 + mobile 400), imagem Docker build+smoke ok, duplicação 0.99%, audit 0 high. Aviso não bloqueante: dead code 7 (exports shadcn pré-existentes, os mesmos das TASK-020/021).

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 staff exporta YAML pelo painel | templates.http.test.ts 'staff exporta o template como YAML com Content-Disposition e sem id' (text/yaml, filename yaml-export.yaml, no-store, 404/400 nos ids ruins); e2e staff-templates baixa o .yaml e confere version/name/minParty/role; screenshot t038-templates-1280-dark.png com o botão de exportar por linha | OK |
| AC#2 importa e o template nasce com roles e vagas | templates.http.test.ts 'staff importa o YAML exportado e o template nasce com roles e vagas' (201, totalSlots 5, roles Tank:1/Scout:4, id novo); db.integration 'casa role pelo nome sem diferenciar maiúsculas e não duplica o catálogo'; e2e importa e a linha nova mostra 3-7 e a role; screenshot t038-import-1280-dark.png (pré-visualização "17 vagas para 15-20 pessoas") | OK |
| AC#3 schema validado, erro legível, nada gravado | event-template-yaml.test.ts 17 testes (round-trip, YAML inválido, chave desconhecida no topo e na role, version futura, vagas 0, soma fora da party, role repetida, tipos errados, alias/billion laughs, 64 KB, tag customizada inerte); templates.http.test.ts 'YAML inválido é 400 legível e não grava nada' (9 corpos, lista idêntica antes/depois) + 'arquivo acima de 64 KB é recusado sem gravar'; db.integration 'nome de template repetido não grava nada, nem as roles novas'; e2e mostra o alerta e o botão desabilitado; screenshot t038-import-erro-1280-light.png | OK |
| AC#4 roles inexistentes criadas conforme decisão | db.integration 'cria as roles que faltam no catálogo e devolve os nomes criados' (createdRoles Battlemount/Bardo, descrição guardada, templateCount 1, sort_order sem colisão); templates.http.test.ts 'roles fora do catálogo são criadas e reportadas em createdRoles' ("tank" casa com Tank em vez de duplicar); e2e confere a frase da pré-visualização, o toast 'Roles criadas no catálogo' e a role no catálogo 'em 1 template' | OK |
| DoD#4 visual | .playwright-mcp/t038-{templates,import}-{1280,400}-{dark,light}.png lidos pelo agent: um CTA primário só (ouro em 'Criar template'; 'Importar YAML' outline), pré-visualização com números em vez de adjetivos, role nova marcada por cor + ícone + frase (não só cor), erro com ícone + borda + texto que diz como corrigir, scrollWidth 1265<=1280 e 400<=400 (sem overflow), Esc fecha o diálogo, console sem erro, copy PT-BR em voz ativa | OK |
| DoD#6 security-review | sem achado >= confiança 8, com verificação executada contra a lib pinada: alias/billion laughs lança ('Alias resolution is disabled'), !!js/function vira string inerte, __proto__ vira propriedade própria e ainda é barrada pelo strict, sql`` só interpola colunas do drizzle (chaves do usuário vão como bind em inArray), filename só [a-z0-9-] (sem aspas, barra ou CRLF), export e import exigem update EventTemplate (caller só tem read), import com SameOriginGuard, sem rota sombreada, sem dangerouslySetInnerHTML | OK |
| DoD#5 doc-005 | Q8 (roles por template a partir de catálogo global) preservada: o import alimenta o mesmo catálogo global em vez de criar roles por template; Q18 (só PT-BR) em toda a copy e em todas as mensagens de erro. Nada de pós-v1 entrou — sem moeda e sem taxa de entrada no YAML | OK |

Skills: emil-design-eng (um CTA primário, diálogo com pré-visualização antes de gravar, estado distinguível por ícone+texto+cor, sem animação em ação repetida), ask-sonner (toast.success com title+description e toast.error com a mensagem PT-BR da API, Toaster único no root seguindo o tema), marclou-review (#22 um CTA: import fica outline e 'Criar template' segue sendo o único ouro; #28 CTA diz o que acontece: 'Importar template'; #3 números em vez de adjetivos na pré-visualização; #26 sem palavras fracas na copy), security-review, task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Templates de evento passaram a viajar entre servidores em YAML (doc-001: DB é a fonte de verdade, YAML só transporte). O formato version 1 vive em @albion-hub/shared como função pura — serializa com cabeçalho explicativo e faz parse com aliases desligados, teto de 64 KB e chaves desconhecidas recusadas, aplicando as mesmas regras do painel (vagas > 0, soma dentro da party, role única). A API ganhou GET /api/event-templates/:id/export (text/yaml com nome de arquivo em slug ASCII) e POST /api/event-templates/import, ambos staff-only e com SameOriginGuard na escrita; o import roda numa transação só e cria no catálogo global as roles que faltam, devolvendo os nomes criados (nome de template repetido é 409 com instrução, não renomeia sozinho). No painel, cada template tem um botão de exportar que baixa o .yaml e o diálogo "Importar YAML" aceita arquivo ou texto colado, pré-visualizando o que será criado — inclusive as roles novas — e mostrando o erro do parser antes de enviar. Verificado com 17 testes unitários do formato (round-trip, YAML inválido, chave desconhecida, billion laughs, 64 KB), 4 de integração no Postgres (casamento por lower(name), roles criadas, tudo-ou-nada na colisão), 6 testes HTTP (401/403/400/409, export sem id, corpo grande) e e2e desktop 1280 + mobile 400 que exporta e reimporta, além de gate completo verde (coverage 92.95%, e2e 42/0) e security-review sem achado.
<!-- SECTION:FINAL_SUMMARY:END -->
