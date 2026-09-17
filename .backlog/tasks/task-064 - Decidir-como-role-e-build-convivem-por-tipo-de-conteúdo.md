---
id: TASK-064
title: Decidir como role e build convivem por tipo de conteúdo
status: To Do
assignee: []
created_date: '2026-09-17 17:06'
updated_date: '2026-09-17 17:09'
labels:
  - eventos
  - templates
  - arquitetura
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: high
type: spike
ordinal: 7100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
"Tank" não quer dizer a mesma coisa em DG de grupo, Raid do Dragão e ZvZ: mesma palavra, builds, equipamento e responsabilidade diferentes. O modelo atual não suporta isso.

Como está hoje (TASK-020/039): `event_roles` é catálogo **global**, com nome único ignorando maiúsculas e **uma** `description` por role. `event_template_roles` liga template↔role e guarda só `slots` e `sort_order`. Logo a descrição/build do Tank é uma só para todos os conteúdos, e a staff tem duas saídas ruins: descrever tudo num texto genérico, ou poluir o catálogo com "Tank DG", "Tank Raid", "Tank ZvZ" — o que quebra ranking e estatística por role e multiplica o catálogo a cada conteúdo novo.

A decisão é de modelagem e precisa sair **antes** de builds entrarem no sistema (itens de equipamento, links de build, exigência de build para se inscrever), porque a escolha errada vira migration cara depois que a staff cadastrar dezenas de builds.

Eixos a resolver, não a implementar:
- Role permanece identidade global (para ranking e estatística) com **build por template**, ou role passa a existir por conteúdo?
- Onde mora a build: campo de texto/link por par (template, role), entidade própria versionada, ou várias builds alternativas por par com o inscrito escolhendo uma?
- O inscrito escolhe build no momento da inscrição? Isso aparece no embed e na lista do caller?
- Caller pode sobrescrever a build no evento específico, como já faz com a taxa?
- O que acontece com as descrições de role já cadastradas na migração.
- Relação com a F6: role/build entra na faixa de Buffunfa por role (TASK-057)?

Entrega: decisão escrita, não código. As tasks de implementação nascem depois dela.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Opções de modelagem levantadas com custo e consequência de cada uma, incluindo o que acontece com ranking e estatística por role
- [ ] #2 Decisão escolhida e justificada, registrada no doc "Decisões v1" com número de Q
- [ ] #3 Caminho de migração das descrições de role atuais descrito
- [ ] #4 Impacto sobre o embed, a tela de templates, a tela de roles e a inscrição descrito o suficiente para virar tasks
- [ ] #5 Tasks de implementação criadas no backlog a partir da decisão
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
