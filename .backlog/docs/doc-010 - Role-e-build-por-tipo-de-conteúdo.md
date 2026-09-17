---
id: doc-010
title: Role e build por tipo de conteúdo
type: specification
created_date: '2026-09-17 17:30'
updated_date: '2026-09-17 17:32'
---
Spike da TASK-064. **Decisão proposta, ainda não aprovada pelo usuário** — enquanto não passar por ele,
nada entra no doc "Decisões v1" e nenhuma task de implementação nasce. Nenhuma linha de schema foi tocada.

O problema em uma frase: "Tank" não quer dizer a mesma coisa em DG de grupo, Raid do Dragão e ZvZ —
mesma palavra, builds, equipamento e responsabilidade diferentes — e o modelo atual só tem um lugar
para guardar isso, que é global.

---

## 1. O que existe hoje (mapeamento)

### Banco (`packages/db/src/schema.ts`)

| Onde | Linha | O que guarda |
|---|---|---|
| `event_roles` | 159-171 | Catálogo **global**: `name` (único ignorando maiúsculas, `event_roles_name_lower_idx`), **uma** `description`, `sort_order`. Seed Tank/Healer/DPS Melee/DPS Range/Support/Scout na migration. |
| `event_template_roles` | 210-224 | Liga template↔role. PK `(template_id, role_id)`. Guarda **só** `slots` e `sort_order`. É aqui que falta lugar. |
| `event_role_slots` | 311-330 | Cópia das roles no instante da criação do evento (snapshot de `slots` e `name`); `role_id` é `set null` para não travar limpeza do catálogo. **Não** copia descrição. |
| `event_signups` | 360-400 | Inscrição aponta para `slot_id` e repete `role_name` em texto. Não tem campo de build. |
| `loot_split_lines` | 614 | `role_name` copiado em texto, é o único rastro de role que sobrevive num split. |

### Leitura e escrita

- `packages/db/src/event-templates-repo.ts:28-36` — `roleColumns` traz a `description` do catálogo e um `templateCount` por role (usado para bloquear delete de role em uso).
- `packages/db/src/event-templates-repo.ts:99-110` — a listagem de template faz `innerJoin` no catálogo e entrega `description` **do catálogo** dentro de `EventTemplateRoleDto`. Ou seja: a tela de template já mostra uma descrição que não é do template.
- `packages/db/src/events-repo.ts:82-93` — o roster do evento também lê a descrição **ao vivo do catálogo**, com `leftJoin`, de propósito (comentário na linha 82: corrigir a descrição alcança evento já aberto). Quando `role_id` virou null, sobra o nome congelado na vaga.
- `packages/db/src/events-repo.ts:147-162` — criação do evento copia `(role_id, name, slots)` do template para `event_role_slots`. A taxa é copiada (linha 155-157), a descrição não é copiada: é referência.
- `packages/db/src/event-templates-repo.ts:180-197` — **import de YAML**: casa role pelo `lower(name)` e, se não existir, **cria no catálogo global com a `description` que veio dentro do template**. Este é o vazamento que já existe hoje (ver §2).

### Telas e bot

- `apps/web/src/pages/StaffRoles.tsx:19-33` — catálogo global; o comentário do arquivo já prevê "a página de build por role (`/staff/roles/:id`)" como coisa futura, e diz que a descrição é lida "em todo lugar onde a role aparece".
- `apps/web/src/pages/StaffTemplates.tsx:31-62` — o rascunho do template (`DraftRole`) é só `{ roleId, slots }`. Não há onde escrever nada por par.
- `apps/server/src/domain/event-embed.ts:33-41, 81-110` — `roleGuideField` monta **um** campo "O que cada role faz" no embed, concatenando as descrições, truncadas em 120 caracteres (`ROLE_GUIDE_DESCRIPTION_MAX`), com teto de 25 campos. É o consumidor mais apertado de qualquer texto de role.
- `apps/server/src/bot/event-signup.interactions.ts:40-58` — o botão de inscrição resolve `slot_id` e cria a inscrição. Não pede nada além da role; é aqui que uma escolha de build entraria.
- `apps/server/src/templates/templates.controller.ts:62-97` (`/api/event-roles`) e `:99-175` (`/api/event-templates`, incluindo export/import YAML).
- `packages/shared/src/event-templates.ts:40-47, 108-135` — `eventRoleInputSchema` e os DTOs `EventRoleDto` / `EventTemplateRoleDto` (este último já carrega `description`, herdada do catálogo).
- `packages/shared/src/event-template-yaml.ts:14-22, 64-68, 129-131` — no arquivo YAML a `description` aparece **dentro de `roles:` do template**. O formato de arquivo já é por par (template, role); o banco é que não é.

### Onde se agrega por role

- Split: `packages/db/src/loot-split-repo.ts:93-102, 179, 202, 231-237` — copia `role_name` da inscrição para a linha do split. É texto, não FK: qualquer ranking por role hoje agruparia por string.
- **Ranking não existe** no código: `grep -rn "ranking"` em `apps/` e `packages/` não retorna nada. Ele é a F10 do doc "Roadmap pós-v1" (participação, moeda ganha, moeda gasta, tempo jogado; top 10 premiado).
- A F6 já decidiu (doc "Decisões v1", F6-8) **faixa obrigatória de Buffunfa por role no template**. Isto é o dado decisivo: `event_template_roles` **já vai** ganhar colunas por par na TASK-057, quer esta decisão saia ou não.

---

## 2. O achado que decide quase tudo

O YAML já trata a descrição como propriedade **do par (template, role)** — `roles: [{ name: Tank, slots: 1, description: segura o dano }]`. Mas o import (`event-templates-repo.ts:191`) não tem onde guardá-la por par, então ela **escorre para o catálogo global**: importar um template de ZvZ hoje pode sobrescrever a ideia de "Tank" para todo mundo. O formato de arquivo já está no modelo certo; o banco está um nível acima do que deveria.

E o mesmo par já foi vendido para a F6-8 (faixa de Buffunfa por role no template). Duas features independentes pedindo a mesma linha é o sinal de que a linha é o lugar.

---

## 3. Opções de modelagem

### Opção A — Manter como está: uma descrição global por role

O que muda: nada. A staff escreve um texto que sirva para DG, Raid e ZvZ.

- **Migration**: nenhuma.
- **O que quebra**: nada hoje; o problema da task continua inteiro. O vazamento do import YAML (§2) continua e piora conforme templates forem importados.
- **O que fica fácil depois**: nada. Quando builds entrarem, elas entram sem casa e a pressão volta para o nome ("Tank ZvZ").
- **Estatística por role**: perfeita e inútil — agrega certo, mas sobre um conceito que a staff não consegue descrever.

### Opção B — Role global + texto por par (template, role)

`event_template_roles` ganha `description` (e, quando builds existirem, `build_url`/`build_notes`) anulável. Leitura é `coalesce(par.description, catalogo.description)`: o catálogo vira o **default**, o par vira o **específico**.

- **Migration**: aditiva, uma coluna anulável. Sem backfill, sem risco: tudo que existe continua lendo o catálogo pelo `coalesce`.
- **O que quebra**: nada em runtime. Tocam-se `EventTemplateRoleDto` (shared), o join de `events-repo.ts:85-87` (passa a resolver pelo `template_id` do evento + `role_id` do slot), o formulário de `StaffTemplates.tsx` (ganha um campo por linha de role) e o import YAML, que **para de vazar** para o catálogo — vira a correção de um bug, não uma quebra.
- **O que fica fácil depois**: builds entram na mesma linha que a F6-8 já vai abrir; e a Opção C continua possível depois, porque uma tabela `role_builds` referenciando `(template_id, role_id)` é aditiva sobre esta.
- **Estatística por role**: intacta. `role_id` continua sendo a identidade única para a F10 — "quantas vezes você foi Tank este mês" soma DG, Raid e ZvZ, que é o que um ranking de participação quer.

### Opção C — Role global + entidade `role_builds` própria, N builds por par

Tabela nova `event_role_builds(id, template_id, role_id, name, gear/link, active, version)`, várias por par, e a inscrição grava qual build foi escolhida (`event_signups.build_id`).

- **Migration**: tabela nova + coluna em `event_signups` + provavelmente snapshot no evento (senão editar a build move o chão de quem já se inscreveu, exatamente o motivo pelo qual `event_role_slots` existe).
- **O que quebra**: o fluxo de inscrição por **botão** do Discord. Hoje é um clique (`event-signup.interactions.ts:40-58`); com escolha de build vira clique → select → confirmar, dois passos, e o embed já está no limite de 25 campos (`event-embed.ts:74`). Também exige tela nova de gestão de build.
- **O que fica fácil depois**: exigir build para inscrever, estatística "qual build foi levada", faixa de Buffunfa por build. É o modelo final se o produto for nessa direção.
- **Estatística por role**: intacta, e ganha um eixo a mais. O custo não é estatístico, é de UX e de escopo.
- **Veredito**: é a Opção B com mais uma camada. Não há motivo para pagar por ela **antes** de existir uma única build cadastrada.

### Opção D — Role deixa de ser global e passa a existir por conteúdo

`event_roles` ganha `content_type_id` e o índice único vira `(content_type_id, lower(name))`. "Tank de ZvZ" é outra linha, legitimamente.

- **Migration**: destrutiva na prática. Precisa de uma entidade "tipo de conteúdo" que não existe (hoje o que existe é template), precisa duplicar as 6 roles do seed por conteúdo e reapontar `event_template_roles`, `event_role_slots.role_id` e o `role_name` já congelado em `event_signups` e `loot_split_lines`.
- **O que quebra**: a F10 antes de nascer. Ranking por role passa a somar `role_id` diferentes para a mesma palavra; ou se agrupa por `lower(name)`, e aí a chave voltou a ser string, que é o que o catálogo global existia para evitar. Quebra também o delete protegido por `templateCount` e a tela de catálogo, que vira uma matriz.
- **O que fica fácil depois**: nada que a B não dê, exceto "esta role só existe em ZvZ" — que a B expressa simplesmente não colocando a role no template.
- **Estatística por role**: é o que ela custa. É exatamente a saída ruim descrita na task ("Tank DG", "Tank Raid"), só que formalizada no schema.

### Opção E — Build só no evento, sobrescrita pelo caller (como a taxa)

Nada no template; o caller escreve a build no evento, e ela é copiada para `event_role_slots` na criação.

- **Migration**: aditiva (`event_role_slots.description`).
- **O que quebra**: nada, mas inverte o padrão do projeto. A taxa tem default no template e cópia no evento (`events-repo.ts:155-157`); esta opção é só a metade de baixo, sem default — o caller reescreve a mesma build de DG toda semana.
- **O que fica fácil depois**: nada; é camada, não base.
- **Veredito**: não é alternativa à B, é **complemento** dela — e um complemento que só vale a pena se o usuário disser que o caller precisa mesmo desviar da build padrão (pergunta P4).

---

## 4. Recomendação

**Opção B: role continua identidade global, o texto (e depois a build) mora no par (template, role), com o catálogo como default via `coalesce`.**

Três motivos, em ordem de peso:

1. **A linha já vai ser aberta de qualquer jeito.** A F6-8 obriga `event_template_roles` a ganhar faixa de Buffunfa por role. Guardar build e descrição no mesmo lugar é uma migration, não duas, e as duas features passam a ter a mesma forma: *o que é global mora na role, o que é específico do conteúdo mora no par*.
2. **É a única opção que não custa nada à F10.** Ranking mensal por participação precisa de `role_id` estável ao longo do tempo; A e B preservam, D destrói, C preserva mas cobra UX de inscrição por algo que ainda não existe.
3. **Conserta um bug em vez de criar trabalho.** O YAML já é por par (§2) e hoje escorre para o catálogo. A coluna nova dá destino a um dado que o formato de arquivo já produz.

Encaminhamento sugerido para builds: `build_url` + `build_notes` no par, uma build por par, **sem** escolha na inscrição. A Opção C (N builds, escolha do inscrito) fica registrada como evolução aditiva e só é construída quando a staff tiver builds cadastradas e reclamar do limite de uma — não antes.

Numeração proposta para o doc "Decisões v1" quando o usuário aprovar: bloco novo `RB-1` a `RB-5` (o doc já usa blocos por tema: `Q1–Q31`, `N1–N7`, `F6-1–F6-29`). Nada foi escrito lá ainda.

### Caminho de migração das descrições atuais

1. `alter table event_template_roles add column description text` (anulável). Nada mais na primeira migration.
2. Leitura passa a ser `coalesce(etr.description, er.description)` em `event-templates-repo.ts:99-110` e `events-repo.ts:82-93`. Enquanto ninguém escrever no par, **a saída é byte a byte a mesma de hoje** — este é o teste de regressão da migração.
3. As descrições hoje no catálogo **ficam onde estão**: viram o default, não lixo. Nada é apagado, nada é copiado.
4. O import YAML para de escrever `description` no catálogo ao criar role nova e passa a escrever no par. Role que ainda não existe continua sendo criada, só que sem descrição global.
5. `event_role_slots` continua **sem** copiar descrição: a leitura ao vivo pelo par `(template_id do evento, role_id do slot)` preserva o comportamento já decidido em `events-repo.ts:82` (corrigir o texto alcança evento aberto). Com `role_id` null, cai no nome congelado, como já cai hoje.

### Impacto por superfície (matéria-prima das tasks, ainda não criadas)

| Superfície | O que muda |
|---|---|
| `packages/db` | Uma coluna anulável em `event_template_roles`; dois joins passam a `coalesce`; import YAML grava no par. |
| `packages/shared` | `EventTemplateRoleDto.description` passa a significar "a do par, com fallback"; `eventTemplateRoleInputSchema` ganha `description` opcional; YAML fica igual (já tem o campo). |
| Tela de templates | Cada linha de role ganha campo de descrição, com placeholder mostrando o default do catálogo. É onde a staff descreve o Tank **daquele** conteúdo. |
| Tela de roles (`/staff/roles`) | A copy muda de "o que se espera de quem pega" para "descrição padrão, usada quando o template não disser outra coisa". Ganha eventualmente a contagem de quantos templates sobrescrevem. |
| Embed do Discord | `roleGuideField` (`event-embed.ts:86-90`) passa a receber a descrição já resolvida — **zero mudança de código**, o resolver é upstream. O teto de 120 caracteres e os 25 campos continuam mandando. |
| Inscrição | Nenhuma mudança na Opção B. Só a Opção C mexeria aqui. |
| Split e ranking | Nenhuma mudança. `role_name` continua copiado; `role_id` continua sendo a identidade. |

---

## 5. Perguntas que só o usuário responde

Nenhuma destas tem resposta técnica; a recomendação acima assume o caminho mais barato em cada uma e precisa ser confirmada ou corrigida.

- **P1 — Uma build por (template, role), ou várias alternativas com o inscrito escolhendo?** É a diferença entre a Opção B e a Opção C, e é a que mais muda escopo (a C mexe no botão de inscrição do Discord).
- **P2 — O que é "build" na prática para a guilda?** Link para site externo (Albion Online 2D, Murder Ledger), lista de itens digitada à mão, ou imagem? Muda se a build é um campo de texto ou uma entidade com itens.
- **P3 — Build é exigência para se inscrever, ou orientação?** Se for exigência, existe um estado "sem build cadastrada" que bloqueia o botão, e isso é regra de negócio, não tela.
- **P4 — O caller pode sobrescrever a build no evento específico, como já faz com a taxa?** Se sim, a Opção E entra como camada; se não, o template é a palavra final e o caller fala no chat.
- **P5 — A descrição global da role continua existindo como default, ou some assim que o par existir?** A recomendação mantém como default (nada se perde). Se o usuário preferir que a descrição só exista por conteúdo, o catálogo vira só nome + ordem, e a migração passa a ter uma etapa de esvaziamento.
- **P6 — A faixa de Buffunfa da F6-8 (TASK-057) é por role do template ou por build?** Se for por build, a TASK-057 **depende** desta decisão e a ordem de merge da F6 muda. A recomendação assume "por role do template", que é o texto literal da F6-8.
- **P7 — Existe tipo de conteúdo como entidade, separado de template?** Hoje "DG de grupo", "Raid do Dragão" e "ZvZ" são templates. Se a guilda pensa em conteúdo com vários templates dentro (ZvZ de 20 e ZvZ de 50), a build talvez pertença ao conteúdo, não ao template — e aí a modelagem ganha um nível antes de ganhar a coluna.
