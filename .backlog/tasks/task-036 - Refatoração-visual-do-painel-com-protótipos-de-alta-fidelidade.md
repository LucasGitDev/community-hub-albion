---
id: TASK-036
title: Refatoração visual do painel com protótipos de alta fidelidade
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-15 21:14'
updated_date: '2026-09-15 22:16'
labels:
  - frontend
milestone: m-2
dependencies: []
priority: high
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Feedback do usuário (2026-09-15): painel 'clean igual necrotério' — vazio, cinza/fosco, fonte estranha, tamanhos inconsistentes, layout fraco. Refazer visual com base shadcn preto e branco (tema shadcnthemer 418a8650...), 3 variações no app rodando pra escolha, depois aplicar direção escolhida. Skills: revenue-centric-design, emil-design-eng, apple-design, animate, improve-animations, review-animations, frontend-design, prototype.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tema preto e branco do shadcn aplicado como base com escala tipográfica única e fonte sans legível
- [x] #2 Carteira, /nick, fila de membros e fila de saques redesenhadas com layout denso e hierarquia clara
- [x] #3 Três variações (A P&B puro, B P&B + cor de destaque, C mais jogo com feedback animado) alternáveis no app e com screenshots 1280/400
- [x] #4 Usuário escolhe uma direção e ela fica como padrão, variações removidas
- [x] #5 e2e existentes continuam passando
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
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Variações (TASK-036, escolha pendente do usuário: AC#4)
Troca: `?v=a|b|c` (ou 1/2/3) em qualquer rota; persiste em localStorage `albion-hub:ui-variant`. Picker (skill prototype, PICKER.md verbatim, topo) aparece em dev ou depois de abrir uma URL com `?v=`; teclas 1-3, ←/→, R remonta a página. Sem `?v`, vale A e não há picker (e2e roda em A).
- A · Papel: tema P&B shadcn claro, primary preto, estados em tom leve.
- B · Ouro: P&B escuro + ouro (oklch .8 .15 80) só em CTA principal, número-chave, ícone ativo e ring.
- C · Arena: escuro com mais contraste (cards .17, bordas .34), pílulas de estado preenchidas, linhas mais densas (--row-py .5rem), count-up do saldo (1ª visita da sessão), check desenhado no toast de aprovação + linha desliza 12px/180ms antes de sair, Sonner richColors.
Mesmos componentes/páginas; variação só muda tokens em [data-variant] + custom variants v-b:/v-c: + flag rewardMotion.

## Decisões
- Tema shadcnthemer 418a8650 instalado via CLI; ponte de tokens antiga (ink/stone/brass...) removida; tokens extras só success/warning/info/brand + --row-py.
- Fonte Geist Variable (@fontsource), tabular-nums em .num. Escala única em @theme: xs 12/16, sm 13/20, base 14/22, lg 16/24, xl 20/28, 2xl 28/32, 3xl 40/44 (tracking negativo nos grandes).
- shadcn add: button, dialog, table, tabs, skeleton, input, textarea, label, progress (removidos card/badge/avatar/separator/tooltip não usados; import "cn" quebrado do CLI corrigido; dep "cn" removida).
- Shell: sidebar com grupos e contadores (Meus saques, Fila de saques), header sticky com breadcrumb + saldo disponível sempre à vista; mobile mantém topo + chips de gestão + barra inferior com contador.
- Carteira: 4 stat cards (disponível, reservado, ganhos do mês líquido de estornos, último split), barra disponível/reservado, extrato em tabela com pílulas de tipo, painéis Saques em andamento e Histórico de saques. Regras em src/lib/wallet.ts (bigint, testado).
- /nick: estado à esquerda, "Como funciona" com passo atual à direita, badge de estado no título.
- /staff/membros: cards Pendentes/Primeiro nick/Mais antiga + fila em linhas tipo tabela (li mantidos pros e2e).
- Fila de saques: cards com soma por estado, Tabs shadcn (line) com contadores, linhas densas.

## Skills aplicadas (regras concretas)
- revenue-centric-design (dashboards-and-data-viz, onboarding-and-activation, behavioral-science-toolkit): KPI principal no topo-esquerda (F-pattern); dado com significado (hint "1 saque em análise", "5 splits recebidos"); números precisos (3.065.050, não "3M"); Von Restorff (um primário por tela, Recusar outline); empty state com próximo passo e progresso já começado (checklist 1 de 4, "Never ship a blank dashboard"); peak-end na aprovação (C).
- emil-design-eng: scale .97 no :active (140ms ease-out), nada de transition-all (trocado no button/tabs/progress), nunca scale(0) (dialog entra de .97 + 6px), curvas custom --ease-out, modal centralizado, UI < 300ms.
- apple-design: tracking negativo em tamanhos grandes, hierarquia por peso+tamanho; header e barra inferior translúcidos (backdrop-blur) com conteúdo por baixo; reduced-motion vira fade/instantâneo.
- animate: gate de frequência (troca de variação e navegação sem animação; count-up e check só em ação ocasional/recompensa), transform/opacity apenas, transitions pra UI disparada rápido, reduced-motion junto.
- improve-animations (auditoria sem gerar plans/ por escopo): achado aplicado = count-up rodava a cada montagem da carteira (frequência) → só na 1ª visita da sessão e em mudança de valor; tabs/progress/button sem transition-all; shadcn dialog/tooltip dependiam de tw-animate-css não instalado → dialog com @starting-style, tooltip removido.
- frontend-design: sem serif/Hanken/stone azulado; brand única na B; sem eyebrow caps; numeração só onde é sequência (passos).
- prototype: 3 direções com eixo nomeado (A tema claro, B acento, C contraste+motion+densidade), picker verbatim, sem pré-escolher.
- review-animations: NÃO pôde ser invocado pelo agent (disable-model-invocation); pedir ao usuário rodar /review-animations.

## Evidência
Screenshots (Playwright MCP, servidor compilado :4180, dev-login ravenmoor admin + 5 nicks semeados via API; picker oculto na captura; 1280 full page, 400 viewport; sem overflow horizontal e console sem erro em todas):
.playwright-mcp/ui036-{a,b,c}-{carteira,nick,membros,saques}-{1280,400}.png + ui036-c-saques-aprovando-1280.png (toast com check e linha saindo).
Nota: texto do passo 3 de "Como funciona" mudou depois das capturas (e2e strict mode em "Nick aprovado").

Gate (pnpm quality, TEST_DATABASE_URL :55451):
| Linting 0 ✅ | Race 0 ✅ | Typecheck ok ✅ | Coverage branch 95.08% ✅ | E2E 28 ok 0 falha ✅ | Docker build+smoke ✅ | Duplicação 0% ✅ | Dead code 9 (advisory: exports não usados de ui shadcn) ⚠️ | Vulns 0 ✅ |

## Decisão do usuário (AC#4)
Variação A vira o tema CLARO e B o tema ESCURO; padrão escuro, com toggle. C, picker e `?v=` removidos por completo (count-up, check animado, saída de linha, richColors, densidade C). Count-up removido (não agregava nos dois temas).
- Tema: classe `dark` no <html> já no index.html + script inline lê localStorage `albion-hub:theme` antes do 1º paint (sem flash; verificado: classe correta no `commit` da navegação). ThemeProvider/ThemeToggle em src/theme/theme.tsx; parseTheme em src/lib/theme.ts (testado). Toggle no header do shell (desktop e mobile) e no canto da tela de login; troca instantânea (gate de frequência do animate). Toaster segue o tema.
- Ouro reduzido no escuro: só CTA primário, número-chave (stat emphasis) e ícone do item ativo. Contadores da sidebar/tabs/barra inferior, chip ativo de gestão mobile, passo atual do /nick, barra de progresso/disponível, logo e toggles de papel viraram neutros (foreground/muted). Valor da linha da fila de saques neutro.
- Mobile 400: avatar saiu do header (logout e toggle ficam) pra não quebrar "albion-hub".
- E2E: suíte roda no padrão escuro; novo teste "tema escuro é o padrão e a troca pra claro persiste no reload (TASK-036)" em e2e/panel.spec.ts (desktop+mobile).
- Security (DoD#6): tela de saque só mudou visual; script inline estático sem dado do usuário; localStorage guarda só "light". Sem achado.

## Screenshots finais (sobrescrevem as das variações, removidas)
.playwright-mcp/ui036-{dark,light}-{carteira,nick,membros,saques}-{1280,400}.png — 1280 full page, 400 viewport; sem overflow horizontal; console sem erro.

## Gate final (pnpm quality, :55451)
| Lint 0 ✅ | Race 0 ✅ | Typecheck ok ✅ | Coverage branch 94.97% ✅ | E2E 30 ok 0 falha ✅ | Docker smoke ✅ | Duplicação 0% ✅ | Dead code 9 advisory ⚠️ | Vulns 0 ✅ |
(1ª execução completa acusou coverage "—" com 412/412 testes passando isolados; reexecução completa passou — tratado como flake de recurso.)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Painel refeito sobre o tema P&B do shadcn (Geist, escala tipográfica única, tokens de estado): shell com sidebar/header e saldo, carteira com stat cards e extrato em tabela, /nick com trilha de passos, filas de nick e saque densas com contadores. Após protótipo de 3 variações, usuário escolheu A=claro e B=escuro (padrão), com toggle persistido e sem flash; C e picker removidos, ouro restrito a CTA, número-chave e item ativo. Verificado com pnpm quality verde (E2E 30/30, incluindo teste de toggle) e screenshots claro/escuro 1280/400.
<!-- SECTION:FINAL_SUMMARY:END -->
