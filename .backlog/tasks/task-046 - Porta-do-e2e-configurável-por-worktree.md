---
id: TASK-046
title: Porta do e2e configurável por worktree
status: In Progress
assignee:
  - '@lucas'
created_date: '2026-09-16 19:27'
updated_date: '2026-09-16 23:16'
labels:
  - e2e
  - dx
dependencies: []
priority: medium
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As specs do Playwright têm 'const ORIGIN = "http://localhost:4173"' hardcoded e o SameOriginGuard rejeita outra origem, então dois worktrees rodando e2e ao mesmo tempo disputam a porta 4173 e produzem falhas fantasma (observado nas TASK-027 e TASK-030). Tornar a porta/origem configurável por variável de ambiente nas specs, no webServer do Playwright e no SameOriginGuard, para permitir rodadas paralelas.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Specs usam a origem derivada de env em vez de 4173 hardcoded
- [x] #2 Dois worktrees rodam e2e ao mesmo tempo em portas diferentes sem falha
- [x] #3 SameOriginGuard aceita a origem configurada e segue recusando origem estranha
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
1. Criar e2e/origin.ts como ponto único: E2E_PORT (env E2E_PORT, default 4173) e ORIGIN derivada.
2. playwright.config.ts passa a importar E2E_PORT/ORIGIN: baseURL, webServer.url, webServer.env.PORT e PUBLIC_URL.
3. reuseExistingServer desligado por padrão (era !CI); opt-in explícito via E2E_REUSE_SERVER=true, para nunca reusar servidor de outra branch.
4. e2e/session.ts re-exporta ORIGIN; remover o const ORIGIN duplicado das 7 specs e importar de ./session.
5. Guard: manter isSameOriginRequest contra env.PUBLIC_URL (já configurável) e adicionar same-origin.guard.test.ts provando que aceita a origem configurada e recusa origem estranha (AC#3).
6. scripts/quality-gate.mjs continua sem mudança (repassa o ambiente ao playwright); validar rodada sem env setada.
7. Evidência AC#2: duas rodadas e2e simultâneas em portas diferentes (E2E_PORT distintos, bancos distintos), colar saída.
8. pnpm quality completo + task-done-check + PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação

Ponto único novo: `e2e/origin.ts` exporta `E2E_PORT` (lê `process.env.E2E_PORT`, valida inteiro 1–65535, default **4173**) e `ORIGIN = http://localhost:${E2E_PORT}`. Consomem: `playwright.config.ts` (`baseURL`, `webServer.url`, `webServer.env.PORT`, `webServer.env.PUBLIC_URL`) e `e2e/session.ts`, que reexporta `ORIGIN`. As 7 specs que declaravam o próprio `const ORIGIN = "http://localhost:4173"` (admin-members, events, nick, panel, settlement, staff-members, staff-templates) passaram a importar de `./session`; wallet e staff-withdrawals já importavam. Zero ocorrências de 4173 fora do default em `e2e/origin.ts`.

### Decisão: `reuseExistingServer`

Era `!process.env.CI`. Passou a `!process.env.CI && process.env.E2E_REUSE_SERVER === "true"` — ou seja, **desligado por padrão, opt-in explícito**.

Por quê, e não "desliga só quando a porta vem do env": o pior caso da task acontece justamente quando ninguém configurou nada. Com a 4173 compartilhada e reuse ligado, o Playwright anexa ao servidor da outra branch, que serve um build diferente, e a spec falha com 404 em rota que existe no próprio código — falha silenciosa, sem nenhum sinal de que o servidor é estranho. Condicionar o desligamento à presença de `E2E_PORT` deixaria o caminho default exatamente com o bug que a task existe para matar. A alternativa de "validar que o servidor existente é o desta execução" exigiria um endpoint de identidade do build no servidor de produção só para o e2e — mudança de produto para resolver problema de infra de teste, descartada. O custo do desligamento é baixo: o `command` do `webServer` é `turbo run build`, que é cacheado (FULL TURBO quando nada mudou), então o reinício é de segundos. Quem quer o loop rápido dentro do próprio worktree liga `E2E_REUSE_SERVER=true` de propósito, sabendo o que está reusando.

### Segurança (AC#3)

`same-origin.guard.ts` e `isSameOriginRequest` **não foram alterados**. A origem esperada já vinha de `env.PUBLIC_URL`, validada pelo schema zod (`^https?://[^/?#\s]+$`, e `https://` obrigatório em produção). Configurar a origem ≠ aceitar qualquer uma: `apps/server/src/auth/same-origin.guard.test.ts` (9 casos) prova que, com `PUBLIC_URL=http://localhost:4199`, o guard aceita essa origem e `sec-fetch-site: same-origin`, e lança `ForbiddenException` para outra porta (4173), outro host (evil.exemplo), outro esquema (https), `sec-fetch-site: cross-site` mesmo com Origin igual, e requisição sem Origin nem sec-fetch-site.

### Quality gate

`scripts/quality-gate.mjs` não precisou mudar para funcionar: `sh()` já repassa `process.env` ao `pnpm exec playwright test`, então `E2E_PORT` flui sozinha. A única alteração é cosmética — o resumo passa a citar a porta quando ela veio do ambiente, e nada muda quando não veio. O `pnpm quality` abaixo rodou **sem `E2E_PORT` setada**, provando que o caminho default segue idêntico.

Documentado em `CLAUDE.md` (seção Quality gate e DoD).

## Evidência AC#2 — dois e2e ao mesmo tempo, portas diferentes

Duas suítes completas lançadas em paralelo no mesmo worktree (`&` + `wait`), portas e bancos distintos:

```
$ (E2E_PORT=4181 TEST_DATABASE_URL=.../albion_hub_par_a pnpm exec playwright test --reporter=list --output=test-results-a > runA.log 2>&1) &
  (E2E_PORT=4182 TEST_DATABASE_URL=.../albion_hub_par_b pnpm exec playwright test --reporter=list --output=test-results-b > runB.log 2>&1) &
  wait

== runA (E2E_PORT=4181)
Running 76 tests using 7 workers
  76 passed (28.9s)
A exit=0

== runB (E2E_PORT=4182)
Running 76 tests using 7 workers
  76 passed (29.4s)
B exit=0
```

152 testes, 0 falha, 0 flaky, os dois processos vivos ao mesmo tempo. Antes desta task isso era impossível: o segundo processo reusaria o servidor do primeiro na 4173.

### Prova de que a porta configurada é mesmo a usada

`lsof` durante uma rodada com `E2E_PORT=4190`:

```
$ (E2E_PORT=4190 pnpm exec playwright test e2e/nick.spec.ts &) ; sleep 12 ; lsof -nP -iTCP -sTCP:LISTEN | grep -E "4173|4190"
node      15755 lucas   16u  IPv6 0x28014655e1180ab7      0t0  TCP *:4190 (LISTEN)
```

Só a 4190 escutando; nada na 4173. O `PUBLIC_URL` do servidor e o `Origin` que as specs enviam acompanham, senão o `SameOriginGuard` recusaria o dev-login e nenhum teste passaria — ou seja, os 76 verdes em 4181/4182 são também prova de ponta a ponta do AC#3 na porta configurada.

## Evidência DoD#1 — `pnpm quality` completo (exit 0, sem E2E_PORT setada)

Postgres: `POSTGRES_PORT=55440 docker compose -p task046`, `TEST_DATABASE_URL=postgres://albion:albion@localhost:55440/albion_hub`.

| Métrica | Resultado | Threshold | Bloqueia | Status |
|---|---|---|---|---|
| Linting | 0 issue(s) | 0 | sim | ✅ |
| Race conditions | 0 detectada(s) | 0 | sim | ✅ |
| Typecheck | ok | 0 erros | sim | ✅ |
| Testes + coverage (branch) | 89.22% | ≥ 79% | sim | ✅ |
| E2E + screenshots (desktop/mobile) | 76 ok, 0 falha(s), 0 flaky | 0 falhas | sim | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | sim | ✅ |
| Duplicação | 1.80% | ≤ 15% | não | ✅ |
| Dead code | 6 item(s) | 0 (advisory) | não | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | sim | ✅ |

Dead code: os mesmos 6 exports de `apps/web/src/components/ui/*` de antes da task (advisory, não bloqueia, não regrediu — nenhum símbolo novo entrou na lista).

## Tabela AC → evidência

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 specs usam origem de env | `e2e/origin.ts` + `grep -rn 4173 e2e/` retorna só o default; 76 e2e verdes em 4181, 4182 e 4190 — se a origem fosse fixa o guard recusaria o dev-login | ✅ |
| AC#2 dois e2e simultâneos | runA 76 passed / runB 76 passed em paralelo, exit 0 nos dois; `lsof` confirma bind em 4190 | ✅ |
| AC#3 guard aceita configurada, recusa estranha | `same-origin.guard.test.ts`, 9 casos (4 de aceite, 5 de recusa) + e2e real em porta não-default | ✅ |
| DoD#1 gate | `pnpm quality` exit 0, tabela acima | ✅ |
| DoD#2 evidência objetiva por AC | saída de comando e testes acima, nenhum AC marcado por leitura de código | ✅ |
| DoD#3 skills | `security-review`, `task-done-check` | ✅ |
| DoD#4 UI | n/a — nenhum arquivo de `apps/web/src` alterado | n/a |
| DoD#5 doc-005 | n/a — sem mudança de comportamento de produto; diff é infra de teste, um teste e docs | ✅ |
| DoD#6 security-review | sem achado; guard e `isSameOriginRequest` inalterados, `E2E_PORT` só é lida pelo processo do Playwright e validada como inteiro 1–65535 | ✅ |
| DoD#7 notas e commits | 4 commits Conventional atômicos, sem co-autor | ✅ |
| DoD#8 PR merged | pendente do merge | ⏳ |

**Skills:** `security-review`, `task-done-check`.

**Guardrails no diff:** nenhum `any`, `@ts-ignore` ou `eslint-disable` novo; nenhum hex de cor; nenhum arquivo de ledger, prata ou saque tocado.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Porta e origem do e2e passam a sair de E2E_PORT (default 4173) por um ponto único, e2e/origin.ts, consumido pelo playwright.config (baseURL, webServer.url, PORT, PUBLIC_URL) e pelo e2e/session.ts, que as specs importam no lugar dos 7 const ORIGIN duplicados. reuseExistingServer ficou desligado por padrão, com opt-in E2E_REUSE_SERVER=true, porque o pior caso — reusar silenciosamente o servidor de outra branch e falhar com 404 fantasma — acontecia justamente no caminho default. O SameOriginGuard não mudou: continua exigindo PUBLIC_URL, agora com same-origin.guard.test.ts provando em 9 casos que aceita a origem configurada e recusa outra porta, outro host, outro esquema, cross-site e requisição sem Origin. Verificado com duas suítes completas em paralelo (76 passed em 4181 e 76 passed em 4182, exit 0 nas duas), lsof confirmando o bind em 4190 e nada na 4173, e pnpm quality completo exit 0 sem E2E_PORT setada (coverage 89.22%, e2e 76 ok, 0 vuln).
<!-- SECTION:FINAL_SUMMARY:END -->
