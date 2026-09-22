---
id: doc-011
title: Arquitetura do Quality Gate
type: guide
created_date: '2026-09-22 17:06'
updated_date: '2026-09-22 17:07'
---
Como o quality gate do albion-hub é montado por dentro, o que cada etapa existe para pegar, e por onde
evoluir. Operação do dia a dia (comandos, DoD, como escrever AC) fica no doc-006.

## 1. Ideia central

O gate é um **contrato**, não uma ferramenta. Cada verificação é um plugin que devolve sempre a mesma
forma, e um agregador decide o veredito. Trocar ESLint por outro linter não muda o resto do sistema.

```
check() → { id, label, status: pass|fail|warn, value, threshold, blocking, details? }
```

Quatro invariantes sustentam tudo:

| Invariante | Efeito prático |
|---|---|
| Thresholds num arquivo só (`quality.config.json`) | Mudar barra vira diff revisável, nunca edição escondida no YAML do CI |
| Mesmo script local e no CI (`scripts/quality-gate.mjs`) | Elimina "passou na minha máquina" |
| Falha fechada | Check que não rodou vira `fail`, nunca verde silencioso |
| Bloqueante vs aviso explícito | Métrica ruidosa informa sem travar entrega |

## 2. Arquitetura

```
                 quality.config.json  (fonte única dos thresholds)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  scripts/quality-gate.mjs            vitest.config.ts
  ├─ registry `checks{}`: lint, typecheck, coverage, e2e,
  │                       image, audit, duplication, deadcode
  ├─ run <check>  → .quality/<check>.json        (unidade isolada, paralelizável)
  └─ summary      → .quality/summary.md + exit code
                    (JSON ausente = "não executado" = bloqueante falhou)
        │
   ┌────┴──────────────────────┬───────────────────────────────┐
   ▼                           ▼                               ▼
 Loop do dev            local-pipeline.mjs               GitHub Actions
 pnpm quality           gate --report (ship:pr):         matriz: 1 job por check
   [lista de checks]    árvore limpa + commit no         + job e2e + job image
                        remoto → gh api statuses         → artifacts → job summary
                        context=summary                  → comentário sticky no PR
                        deploy: imagem + webhook         (push na main e PR de fork)
        │
        ▼
   Ruleset da main exige o check `summary`
        │
        ▼
   Camadas humanas por cima: DoD do backlog (9 itens) + skill task-done-check
   (escopo do diff, guardrails de domínio, visual 1280/400, produto vs doc-005)
```

**Separar execução de agregação é o que dá flexibilidade.** `run` é uma unidade isolada, então o CI
distribui em matriz e o dev roda um subconjunto; `summary` só lê os JSON, então local e CI produzem o
mesmo veredito e o mesmo markdown.

## 3. Objetivo de cada etapa

Cada etapa existe para pegar uma classe de erro que nenhuma outra pega. Se duas pegam a mesma coisa,
uma sobra.

| Etapa | Pega | Bloqueia | Custo |
|---|---|---|---|
| Lint tipado | Erro de uso e race condition (promise solta, `no-misused-promises`) | sim | segundos |
| Typecheck | Contrato quebrado entre módulos e pacotes | sim | segundos |
| Testes + coverage (branch, só `lib`/`domain`/`packages`) | Regra de negócio errada e caso-limite esquecido | sim | ~1 min |
| E2E 1280 + 400 | Fluxo real quebrado, regressão visual, layout mobile | sim | minutos |
| Imagem Docker + smoke | Quebra de empacotamento, env e config: coisas que só aparecem no artefato de produção | sim | minutos |
| Audit `--prod` | Vulnerabilidade high/critical em dependência que vai para produção | sim | segundos |
| Duplicação (jscpd) | Cópia que vai divergir | não (aviso) | segundos |
| Dead code (knip) | Código órfão e export não usado | não (aviso) | segundos |
| DoD + `task-done-check` | O que máquina não vê: escopo vs AC, invariante de domínio, hierarquia visual, produto vs doc-005 | sim (humano) | minutos |

Coverage **não** mede componente visual de propósito: UI é garantida por e2e mais revisão visual do
agent. Medir onde o bug custa, não no projeto inteiro.

## 4. Pirâmide de latência

O gate inteiro é caro demais para rodar a cada edição. A regra é: quanto mais rápido o sinal, mais
cedo ele roda.

| Quando | O que roda | Alvo |
|---|---|---|
| Por edição | Lint e typecheck do que mudou | < 5s |
| Loop da task | `pnpm quality lint,typecheck,coverage` | < 2 min |
| Antes do PR | `pnpm ship:pr` (tudo + publica o status) | < 15 min |
| Depois do merge | Actions no push da main, ambiente neutro | assíncrono |

## 5. Paralelismo

Três eixos, com armadilha em cada um.

**Entre checks (CI).** O contrato `run <check>` → JSON permite matriz: cada check é um job, o
`gate-summary` junta os artifacts. Ganho quase linear; o caminho crítico vira o check mais lento
(hoje e2e e imagem).

**Dentro do e2e.** Playwright em workers. Em máquina disputada (cliente do jogo aberto, `uptime` com
load alto), `E2E_WORKERS=2` — sem isso, specs sem relação com a mudança estouram os 30s e o gate
reprova por ambiente, não por regressão.

**Entre worktrees (tasks em paralelo).** O conflito é por recurso compartilhado, não por CPU:
- Porta do e2e: `E2E_PORT=41XX` por worktree; vale para as specs, o `webServer` e o `PUBLIC_URL` que o
  `SameOriginGuard` valida. O Playwright **não** reusa servidor existente, para nunca pegar o build de
  outra branch; só o loop rápido dentro do próprio worktree liga `E2E_REUSE_SERVER=true`.
- Postgres: `docker compose -p <task>` com projeto por task, porta própria.

**Regra de leitura de falha:** timeout espalhado por specs sem relação = ambiente. Falha igual com
banco limpo e máquina livre = regressão. Confundir os dois ensina o time a ignorar vermelho.

## 6. Melhorias mapeadas

Ordenadas por retorno sobre esforço.

| # | Melhoria | Resolve |
|---|---|---|
| 1 | **Lint custom de domínio**: proibir UPDATE/DELETE em lançamentos e `number` em valor monetário | Hoje as invariantes do ledger só existem em doc e na checagem manual do agent. Regra em doc quebra |
| 2 | **Hooks no loop do agent**: lint e typecheck por edição; `Stop` hook que barra "pronto" com gate vermelho | Feedback chega no fim. Erro barato descoberto tarde |
| 3 | **Reviewer independente**: subagent com contexto limpo lendo só diff e spec | Hoje o mesmo agent implementa e aprova o próprio trabalho |
| 4 | **Mutation testing** (ledger, distribuição, saque) | Coverage de 79% prova execução, não afirmação |
| 5 | **Cache e ordenação no CI**: cache de build e de browser, checks rápidos primeiro com fail-fast | Corta o caminho crítico e mata o PR ruim em segundos |
| 6 | **Detecção de ambiente**: gate mede load e ajusta workers sozinho, e marca a falha como suspeita de ambiente | Tira o ajuste manual de `E2E_WORKERS` do caminho |
| 7 | **Mensagem de erro orientada a quem conserta**: cada falha diz o quê, onde e como corrigir | Com agent, a mensagem de erro é o prompt de correção |
| 8 | **Ratchet nos avisos**: duplicação e dead code travados no valor atual, só podem melhorar | Aviso que ninguém lê vira dívida silenciosa |

## 7. Para replicar em outro projeto

A arquitetura acima não depende de linguagem. Ordem de construção num projeto sem gate:

0. Entrypoint único, saída JSON por check, agregador com exit code.
1. Formatter, lint, typecheck/compile, build.
2. Testes do domínio, coverage com **ratchet** (trava no valor atual, só sobe) — nunca exigir 80% no dia 1.
3. Check obrigatório no PR. Sem isso o gate é sugestão.
4. Audit de dependência e scan de segredo.
5. Build e smoke do artefato real que vai para produção.
6. E2E só dos fluxos críticos (dinheiro, login).
7. Invariantes de negócio como regra executável.
8. Avisos (duplicação, dead code, complexidade), depois com ratchet.

Diagnóstico de gate existente — cada "não" é um item de backlog:
local e CI rodam o mesmo comando? · thresholds num arquivo só? · check não executado falha? · é check
obrigatório no PR? · alguma invariante de negócio é verificada por máquina? · o feedback chega antes do
fim? · existe verificador independente do autor? · a qualidade dos testes é medida, não só a execução? ·
falha flaky é tratada ou todos já aprenderam a rodar de novo?
