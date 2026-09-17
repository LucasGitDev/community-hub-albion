---
id: TASK-071
title: Buffunfa com ícone no painel e identidade visual do servidor
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 19:59'
updated_date: '2026-09-17 21:07'
labels: []
milestone: m-12
dependencies: []
documentation:
  - .backlog/docs/doc-009 - Identidade-Toca-da-Turma-e-Buffunfa.md
priority: high
type: feature
ordinal: 7010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Os assets versionados em `assets/` foram entregues pelo usuário para o site e para o Discord, mas só o emoji do Discord os usa (`BUFFUNFA_EMOJI_FILE`). No painel, a Buffunfa aparece apenas como o texto ` BUF`, e o doc-009 diz o contrário: "no painel, o PNG como ícone inline junto do número".

Além disso o painel ainda não é a Toca da Turma: o favicon é um SVG genérico embutido no `index.html` e o `<title>` é "albion-hub".

Escopo: usar `assets/buffunfa_simples_512.png` como ícone da moeda no painel, junto de todo valor em Buffunfa, e vestir a identidade do servidor (favicon e título). O helper de formatação já existe em `packages/shared/src/currency.ts` e o componente único de valor é `<Amount>` — o ícone entra lá, num lugar só, não espalhado por tela.

Cuidado com o peso: 318 KB para um ícone de 16px é desperdício. Gerar versões pequenas a partir do PNG de origem, ou converter para um formato adequado ao tamanho de uso.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Todo valor em Buffunfa no painel aparece com o ícone da moeda ao lado do número
- [x] #2 O ícone vem dos assets versionados, em tamanho adequado ao uso (não o PNG de 512 px cru)
- [x] #3 O favicon e o título do painel são os da Toca da Turma, não o placeholder
- [x] #4 Prata continua sem ícone e neutra: a distinção entre as moedas não depende só da cor
- [x] #5 Revisão visual por screenshot em 1280 e 400 nas telas com saldo, extrato e loja
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
1. Gerar assets pequenos a partir de assets/buffunfa_simples_512.png com sips (macOS): apps/web/src/assets/buffunfa.png (64px, icone inline @2x ate 30px) e apps/web/public/favicon.png (64px) + apple-touch-icon.png (180px).
2. <Amount> (apps/web/src/components/display.tsx): quando currency === 'buffunfa', renderizar <img> inline antes do numero, dimensionado em 1em (size-[1em]) com align baseline. Um lugar so; formatAmount/formatAmountShort (compartilhados com o bot) nao mudam.
3. Texto ' BUF' fica: e a ancora de acessibilidade e o formato do F6-5; o icone soma identidade sem que a distincao dependa de cor nem de imagem carregada. Prata segue sem icone e neutra (foreground).
4. index.html: favicon PNG da Toca da Turma no lugar do SVG embutido, <title> 'Toca da Turma', apple-touch-icon, theme-color.
5. Teste unitario do <Amount> (icone presente em buffunfa, ausente em prata) + assercao e2e do icone na loja/carteira.
6. Screenshots Playwright 1280 e 400 em /carteira, /loja e extrato; pnpm quality completo com E2E_PORT=4171.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementação

**Assets gerados** (commit `ac6a911`), com `sips -Z` do macOS a partir de `assets/buffunfa_simples_512.png` (318 KB), o mesmo PNG versionado que o bot usa para o emoji:
- `apps/web/src/assets/buffunfa.png` — 64px, 9 KB. É @2x do maior uso (o número-chave de 30px). Entra no bundle pelo import do Vite, então vira arquivo com hash no `dist/` e **não** é dependência de runtime do servidor (o `assets/` do repo continua existindo só para o emoji do Discord, F6-35).
- `apps/web/public/favicon.png` — 64px, 9 KB. `apps/web/public/apple-touch-icon.png` — 180px, 54 KB.

**Onde o ícone entra**: só no `<Amount>` (`apps/web/src/components/display.tsx`). `formatAmount`/`formatAmountShort` não mudaram — são compartilhados com o bot, onde a moeda é o emoji do Discord, não o PNG.

**Decisões minhas, fora dos docs:**
1. O texto ` BUF` **fica** junto do ícone. É ele que garante que a distinção entre as moedas não dependa da cor nem da imagem ter carregado (AC#4, motivo da TASK-055), e é o formato do F6-5. O ícone é `aria-hidden`: com `alt` o leitor de tela repetiria a moeda em cada linha do extrato.
2. O ícone é um `<span>` com `background-image`, não um `<img>`. O Chrome não conta a largura de um `<img>` ao medir a coluna da tabela do extrato, e o `+1.340 BUF` vazava a borda do card em 400px.
3. O `<Sparkles>` que marcava a Buffunfa no chip do header **saiu**. Eram dois símbolos para a mesma moeda, e os 24px dele eram a diferença entre o header caber e a página rolar de lado em 400px (o estouro da F6-30).
4. O nome "Toca da Turma" no header some abaixo de 640px (fica só o brasão), em vez de aparecer cortado. Continua na aba, no login e na barra lateral do desktop.
5. A marca do shell continua o brasão de espadas: o javali dourado é a **moeda**, e usá-lo também como símbolo do servidor misturaria as duas coisas na mesma tela.
6. Nos cards esgotados da loja o ícone recua junto com o resto (`grayscale` + opacidade): F6-18 manda o card inteiro recuar, e uma moeda dourada acesa num card cinza chamaria atenção para o que não dá pra comprar.
7. Os `BUF` que são **adorno de campo de formulário** (preço no `ShopItemDialog`, faixa no `StaffTemplates`) ficaram sem ícone: são unidade de um input, não valor exibido.

**Skills invocadas** (doc-003): `emil-design-eng`, `frontend-design`, `task-done-check`.

## Quality gate (commit `5bb4ff2`, local, porta 4171)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 88.76% | ≥ 79% | ✅ |
| E2E + screenshots (desktop/mobile) | 144 ok, 0 falha, 0 flaky | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | build + smoke ok | ✅ |
| Duplicação | 2,34% | ≤ 15% | ✅ |
| Dead code | 6 (advisory, todos pré-existentes em `components/ui`) | 0 advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| #1 ícone junto do número | `e2e/shop.spec.ts:51` (preço do card) e `e2e/wallet.spec.ts:48` (chip do header), ambos verdes em desktop e mobile; screenshots de `/carteira`, `/loja` e `/eventos` em 1280 e 400 revisados. O ícone mora no `<Amount>`, que é o único renderizador de valor — cobre extrato, saldo, loja, evento e template de uma vez. | ✅ |
| #2 tamanho adequado | `apps/web/src/assets/buffunfa.png` tem 64px/9 KB, gerado com `sips -Z 64` do PNG de 512px/318 KB. Favicon 64px/9 KB, apple-touch 180px/54 KB. `git diff --stat` mostra os três binários. | ✅ |
| #3 favicon e título | `e2e/wallet.spec.ts:50-51`: `toHaveTitle("Toca da Turma")` e `link[rel=icon][href="/favicon.png"]`, verdes nos dois projetos. | ✅ |
| #4 prata sem ícone e neutra | `e2e/wallet.spec.ts:48`: o chip mostra as duas moedas lado a lado e tem **exatamente um** ícone — prova que a Buffunfa ganhou o seu e a prata não tem nenhum. O texto ` BUF` continua sendo o rótulo, então a distinção não depende de cor nem da imagem carregar. | ✅ |
| #5 revisão visual 1280 e 400 | Screenshots de `/carteira` (saldo + extrato), `/loja` e `/eventos` nas duas larguras, no tema escuro e no claro, lidos por mim. `document.documentElement.scrollWidth <= innerWidth` = true nas quatro rotas × duas larguras. Console sem erro além do 401 esperado do `/api/auth/me` antes do login. Tab chega em "Meus saldos" com outline de 2px. | ✅ |

## Três defeitos encontrados pela própria revisão (commit `d219649`)

1. `<Amount>` como `inline-flex` encolhia a linha e o card de evento passou a cobrir o `<summary>` de baixo: 3 e2e mobile viraram clique interceptado. Confirmado que era regressão minha rodando as mesmas specs com `apps/web` da `origin/main` (passavam).
2. O ícone como `<img>` não era contado na largura da coluna do extrato pelo Chrome, e o `+1.340 BUF` vazava a borda do card em 400px. Medido no navegador: sobra de 13px = a largura do ícone. Virou `<span>` com `background-image`, sobra 0.
3. O chip do header levou a página a 427px de largura em 400px de viewport (o estouro da F6-30). Medido contra a `origin/main` (400px). Resolvido tirando o `<Sparkles>` redundante do chip.

DoD#6 não se aplica: o diff é 100% de apresentação (`apps/web` + 2 specs), não toca auth, ledger, prata nem saque — nenhuma rota, serviço ou schema mudou. DoD#8 fecha no merge.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A Buffunfa passou a aparecer com a moeda do servidor junto do número em todo o painel, e o painel passou a abrir como Toca da Turma.

O ícone entrou no `<Amount>`, o único renderizador de valor do sistema, então extrato, saldo, chip do header, loja, card de evento e template ganharam a moeda de uma vez, sem nenhuma tela desenhá-la por conta própria. Os helpers compartilhados com o bot (`formatAmount`/`formatAmountShort`) não mudaram: lá a moeda é o emoji do Discord. O texto ` BUF` ficou, porque é ele que garante que a diferença entre prata e Buffunfa não dependa de cor nem de a imagem ter carregado; prata segue neutra e sem ícone.

Os arquivos servidos saíram do PNG de 512px versionado, reduzidos com `sips`: 318 KB viraram 9 KB no ícone e no favicon.

Verificado com o gate completo verde (144 e2e, 0 falha; coverage 88,76%), assertivas novas em `e2e/shop.spec.ts` e `e2e/wallet.spec.ts` para o ícone, o título e o favicon, e revisão visual em 1280 e 400 nos temas claro e escuro. A revisão achou três regressões de layout que o ícone tinha causado — linha encolhida no card de evento, valor vazando a célula do extrato e a página rolando de lado em 400px — todas corrigidas e medidas contra a `origin/main`.
<!-- SECTION:FINAL_SUMMARY:END -->
