---
id: TASK-064
title: Decidir como role e build convivem por tipo de conteúdo
status: In Progress
assignee: []
created_date: '2026-09-17 17:06'
updated_date: '2026-09-17 17:36'
labels:
  - congelada
  - eventos
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-005 - Decisões-v1.md
priority: low
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Congelada por decisão do usuário em 2026-09-17.** O spike foi concluído e a recomendação está no doc-010 (role global, descrição e build no par template+role, migration aditiva sem backfill), mas nada disso vira código enquanto as sete perguntas do §5 do doc não forem respondidas.

Descongelar exige, na ordem: responder P1–P7, registrar as respostas no doc-005 e só então criar as tasks derivadas. A pergunta que mais pesa é a P6 — se a faixa de Buffunfa da F6-8 pertence ao par (template, role) ou à build, porque no segundo caso a TASK-057 passa a depender desta decisão e a ordem de merge da F6 muda.

Enquanto isso, o vazamento do import de YAML que o spike encontrou virou task própria e não espera esta decisão.

---

Spike conduzido; decisão escrita no doc-010 "Role e build por tipo de conteúdo". **Pendente de aprovação do usuário**: nada foi escrito no doc-005, nenhuma task derivada criada, schema intocado.

Achado principal: o formato YAML de template **já** trata a descrição como propriedade do par (template, role) — `packages/shared/src/event-template-yaml.ts:14-22,64-68` — mas o banco não tem onde guardá-la por par (`event_template_roles` só tem `slots` e `sort_order`, schema.ts:210-224), então o import escorre a descrição para o catálogo global (`event-templates-repo.ts:191`): importar um template de ZvZ pode sobrescrever a ideia de "Tank" para todos os conteúdos. Soma-se a isso que a F6-8 já obriga `event_template_roles` a ganhar faixa de Buffunfa por role na TASK-057 — duas features independentes pedindo a mesma linha.

Recomendação: **role continua identidade global** (preserva o ranking da F10, que ainda não existe no código — `grep ranking` não retorna nada em apps/ nem packages/) e **descrição/build moram no par (template, role)**, com o catálogo como default via `coalesce`. Migration aditiva de uma coluna anulável, sem backfill; enquanto ninguém escrever no par a saída é idêntica à de hoje.

Descartadas: catálogo por conteúdo (`content_type_id`) destrói o agrupamento por role antes de a F10 nascer; entidade `role_builds` com N builds e escolha na inscrição é a mesma base mais uma camada, e cobra um segundo passo no botão do Discord por algo que ainda não existe — fica registrada como evolução aditiva.

Sete perguntas abertas para o usuário no §5 do doc-010 (P1 a P7), incluindo se a faixa de Buffunfa da F6-8 é por role ou por build, o que decidiria se a TASK-057 passa a depender desta decisão.
<!-- SECTION:NOTES:END -->
