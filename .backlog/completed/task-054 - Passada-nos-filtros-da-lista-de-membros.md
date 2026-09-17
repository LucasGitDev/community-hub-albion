---
id: TASK-054
title: Passada nos filtros da lista de membros
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 12:15'
updated_date: '2026-09-17 14:39'
labels:
  - web
  - admin
dependencies: []
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Hoje a lista de membros filtra por todos / não encontrados / sem nick / banidos. Faltou 'Saiu do servidor' (TASK-049 entregou só o selo) e, com cinco chips, a pergunta certa deixa de ser 'qual estado' e passa a ser 'quem precisa de atenção'. Rever o conjunto de filtros e as contagens junto, não adicionar chip isolado (decisão N6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Filtro de quem saiu do servidor existe e a contagem bate com a lista
- [x] #2 Conjunto de filtros revisto como um todo, sem chip solto
- [x] #3 Filtros seguem no servidor (nada filtrado no cliente) e a paginação continua correta
- [x] #4 Revisão visual em 1280 e 400 nos papéis staff e admin
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
1. shared/members-admin.ts: trocar o conjunto plano de 4 filtros por 6 em dois níveis. Chaves: todos, atencao, sem_nick, nao_encontrados, saiu, banidos. Exportar MEMBER_FILTERS (parse), MEMBER_FILTERS_PRIMARY = [todos, atencao, banidos], MEMBER_FILTERS_ATTENTION = [sem_nick, nao_encontrados, saiu] e isAttentionFilter(). parseMemberFilter segue caindo em 'todos'.
2. Semântica (decisão desta task, escrita nas notas): filtros são EXCLUSIVOS (um valor só na URL e na query). 'atencao' = (nao encontrado OU sem nick OU saiu) E NAO banido; os três chips de refino também excluem banido. Banimento é estado administrativo resolvido, nao pendencia acionavel: com isso 'Precisam de atenção' e 'Banidos' nao se sobrepoem e a fila de trabalho nao mistura conta morta com nick pra corrigir. Quem esta banido E saiu aparece so em 'Banidos' (e em 'Todos').
3. packages/db/admin-members-repo.ts: filterCondition ganha os novos casos; o select de counts ganha 'atencao' e 'saiu' com os mesmos predicados (count(*) filter (where ...)), garantindo contagem == linhas devolvidas. total segue counts[filter].
4. apps/server/admin-members.controller.ts: sem mudança de rota nem de permissão; o DTO de counts acompanha o tipo do repo.
5. apps/web/AdminMembers.tsx: chips em dois níveis. Linha 1 sempre visível (Todos / Precisam de atenção / Banidos); linha 2 de refino aparece só quando o filtro ativo é da família atenção. StatCards caem de 4 para 3 (Membros no painel com o número-chave dourado, Precisam de atenção, Banidos) — os quatro cartões repetiam os chips. changeFilter continua zerando a página.
6. Testes: unit em shared (parse + grupos), integration em packages/db (contagem == linhas para cada filtro, incluindo banido+saiu), e2e novo cobrindo o filtro 'Saiu do servidor', a exclusão do banido da fila de atenção e a paginação ao trocar de filtro; snapshots 1280/400 em staff e admin.
7. security-review, pnpm quality completo, task-done-check, PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisão de desenho (AC#2)

Não pendurei um quinto chip. Com cinco rótulos longos lado a lado a pergunta da tela deixa de ser respondida: o admin lê tudo para descobrir onde tem trabalho. Os chips passaram a ter **dois níveis**:

- **Em cima, sempre visível:** `Todos` · `Precisam de atenção` · `Banidos` — "tem trabalho aqui?"
- **Dentro da atenção:** `Sem nick` · `Não encontrados no Albion` · `Saiu do servidor` — "que trabalho?". A linha de refino só existe quando o filtro ativo é da família atenção; fora dela seriam três chips sem pergunta que respondam. Clicar de novo no refino ligado volta para o grupo inteiro.
- **Cartões de número caíram de 4 para 3**, um por chip de cima. Os quatro cartões antigos repetiam os chips; o detalhe agora mora no hint do cartão de atenção (`Sem nick 1 · não encontrados 0 · saíram 1`) e no refino.

### Exclusivos ou combináveis
**Exclusivos**: um filtro por vez, um valor na query. A lista é fila de trabalho, não montagem de interseção. Combinar viraria estado composto na URL e contagem por chip dependente do que mais está ligado; exclusivo mantém a promessa simples de que **o número do chip é o número de linhas que ele abre**.

### O caso banido + saiu do servidor
`atencao` = (não encontrado OU sem nick OU saiu) **E não banido** — e os três refinos repetem esse `e não banido`. Banimento é estado administrativo já resolvido: ninguém vai corrigir o nick de uma conta banida. Consequências, todas testadas:
- `atencao` e `banidos` não se sobrepõem;
- quem está banido **e** saiu aparece **uma vez só**, em `Banidos`, com os dois selos preservados na linha;
- `Todos` segue sendo o único filtro que não esconde ninguém;
- dentro da atenção os três refinos **podem** se sobrepor entre si (sem nick + saiu), então a soma deles passa do total do grupo — cada um continua honesto sobre as próprias linhas, que é o que o chip promete.

### Servidor, sempre (AC#3)
Nada filtrado no cliente. Os seis predicados moram em `filterCondition` (`packages/db/src/admin-members-repo.ts`) e **as contagens usam os mesmos objetos SQL** (`count(*) filter (where ...)`), numa varredura só — é impossível o chip e a lista divergirem por escrita duplicada. `total` = `counts[filter]`, que é o que a paginação da tela usa. O `changeFilter` continua zerando a página no handler.

## Gate

| Métrica | Resultado | Status |
|---|---|---|
| Linting | 0 issues | ✅ |
| Race conditions | 0 | ✅ |
| Typecheck | ok | ✅ |
| Testes + coverage (branch) | 89.26% (≥ 79%) | ✅ |
| E2E + screenshots (1280/400) | 116 ok, 0 falha, 0 flaky | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ✅ |
| Vulnerabilidades (high+) | 0 | ✅ |
| Duplicação | 1.77% (≤ 15%) | ✅ |
| Dead code | 6 (advisory, todos primitivos shadcn pré-existentes) | ⚠️ |

## Evidência por AC

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 filtro de quem saiu, contagem bate | e2e `admin-member-filters.spec.ts` "os chips de dois níveis batem com a lista" (abre cada chip e compara contagem × linhas); integration `admin-members-filters.integration.test.ts` "a contagem de cada chip é exatamente o número de linhas" e "'Saiu do servidor' traz quem a limpeza marcou, e só"; http `admin-members.http.test.ts` "agrupa a atenção, filtra quem saiu..."; screenshots `filtros-saiu-do-servidor` | ✅ |
| AC#2 conjunto revisto, sem chip solto | shared "os dois níveis cobrem o conjunto inteiro, sem chip solto nem repetido"; integration "'Precisam de atenção' é a união exata dos três refinos" e "banido e fora do servidor aparece uma vez só, em 'Banidos'"; e2e assere ausência do refino fora da atenção; screenshots `filtros-nivel-de-cima` e `filtros-atencao-com-refino` | ✅ |
| AC#3 filtro no servidor, paginação correta | integration "a paginação anda dentro do filtro escolhido, sem repetir nem pular linha"; e2e "trocar de filtro volta para a página 1 e a paginação continua do servidor" (páginas via API com pageSize=2, página além do fim vazia com total estável, e a tela volta pra 'página 1 de') | ✅ |
| AC#4 visual 1280 e 400, staff e admin | screenshots lidos pelo agent: admin `filtros-nivel-de-cima`, `filtros-atencao-com-refino`, `filtros-saiu-do-servidor`, `filtros-banidos-e-fora-do-servidor`; staff `filtros-staff-nivel-de-cima`, `filtros-staff-atencao-com-refino`, `filtros-staff-saiu-do-servidor` — todos nos projetos desktop (1280) e mobile (400). Sem overflow horizontal (asserido nos dois testes). Staff sem o botão de import e sem 'Papéis' no menu; ações da linha (conferir, gerenciar, extrato, banir) intactas | ✅ |
| DoD#1 gate | tabela acima, `.quality/summary.md` | ✅ |
| DoD#2 evidência objetiva | tabela acima; nenhum AC marcado por leitura de código | ✅ |
| DoD#3 skills | abaixo | ✅ |
| DoD#4 e2e + screenshots | `e2e/admin-member-filters.spec.ts` (4 testes × 2 projetos), 7 `snap()` por projeto | ✅ |
| DoD#5 doc-005 | N6 (esta task é a passada que a decisão pediu); N7 aplicada — há UI de verdade, então skills de design + revisão visual nos dois papéis; G9 respeitada (banido continua na lista, marcado, saldo intocado); TASK-049 preservada (selo e autoria da limpeza) | ✅ |
| DoD#6 security-review | rodada no diff do worktree: **nenhum achado**. Traçado: predicados só com helpers tipados do Drizzle (sem interpolação de string), `parseMemberFilter` é allowlist estrita e filtro desconhecido cai em `todos` (não alarga), `@Authorize` e guards intocados, `leftGuildAt`/`ban` já existiam no DTO — os filtros novos só permitem filtrar, não expõem campo novo | ✅ |
| DoD#7 commits | 2 commits Conventional atômicos, sem co-autor | ✅ |

## Skills
`emil-design-eng` (chips e a linha de refino: estado ligado preenchido e não só colorido, `.press` no toque, entrada de 150ms `ease-out` com `@starting-style` e `prefers-reduced-motion`), `frontend-design` (dois níveis em vez de fileira única; cartões de 4 para 3), `ask-sonner` (avaliado: troca de filtro **não** gera toast — a mudança é auto-evidente na tela; toasts são para o que o usuário não vê. Toasts existentes intocados), `marclou-review` (uma tela uma ideia ✅; um CTA primário ✅ 'Importar membros do Discord'; números em vez de adjetivos ✅ no hint da atenção; três cores ✅ dourado só no número-chave e no CTA), `security-review` ✅, `task-done-check` ✅.

## Guardrails
Sem `any`, `@ts-ignore` ou `eslint-disable` novos; sem hex solto (cores só por token); nada de `update`/`delete` em ledger; nenhuma permissão alterada.

## Observação não bloqueante
`Não encontrados no Albion` é o rótulo mais longo e ocupa quase uma linha inteira do refino em 400px. Legível e sem overflow, mas se incomodar na prática, encurtar para `Não encontrados` (a coluna Albion já dá o contexto) é uma troca de uma linha.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Os filtros da lista de membros viraram dois níveis e ganharam 'Saiu do servidor'. Em cima Todos / Precisam de atenção / Banidos; dentro da atenção os refinos Sem nick / Não encontrados no Albion / Saiu do servidor. Cartões de número de 4 para 3, um por chip de cima. Filtros seguem exclusivos e no servidor, e cada contagem sai do mesmo predicado SQL que monta a lista. Atenção exclui conta banida, então banido que saiu aparece uma vez só em Banidos, com os dois selos na linha. Verificado com 5 testes de integração contra Postgres, 1 teste HTTP novo, testes unitários do conjunto de filtros no shared, 4 testes e2e novos em desktop 1280 e mobile 400, 7 screenshots por projeto revisados nos papéis staff e admin, security-review sem achado e pnpm quality completo verde (coverage 89.26%, 116 e2e ok).
<!-- SECTION:FINAL_SUMMARY:END -->
