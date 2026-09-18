---
id: TASK-070
title: Deploy no Actions leva horas por emular arm64
status: Done
assignee: []
created_date: '2026-09-17 19:16'
updated_date: '2026-09-18 13:55'
labels: []
milestone: m-12
dependencies: []
priority: high
type: bug
ordinal: 7040
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
O workflow `deploy.yml` constrói `linux/amd64,linux/arm64` num runner x86 da GitHub, com `docker/setup-qemu-action`. O build arm64 sai **emulado**, e um monorepo Node emulado leva horas: a run #68 ficou 2h40 presa no `docker/build-push-action` em 2026-09-17 e só saiu com `force-cancel` (o `cancel` normal não pega job sem heartbeat do runner).

O efeito é pior do que a lentidão. O grupo de concorrência do deploy é `cancel-in-progress: false`, então **toda run posterior fica na fila atrás da travada** — as runs #69 a #77 foram canceladas ou ficaram `pending` sem nunca alocar job. Um deploy lento entope o caminho de todos os seguintes.

Três saídas, em ordem de preferência:
1. Construir **só amd64** no Actions se a VPS aceitar, ou publicar arm64 apenas quando for de fato necessário;
2. Usar runner ARM nativo (`ubuntu-24.04-arm`), que dispensa QEMU;
3. Manter o deploy local (`pnpm ship`), que é nativo e rápido, e deixar o Actions só como verificação de gate.

Enquanto isso não for decidido, o deploy vem sendo feito pelo pipeline local.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Um deploy completo pelo Actions termina em tempo comparável ao build local, ou o caminho do Actions é desativado explicitamente
- [ ] #2 Deploy lento ou travado não bloqueia os deploys seguintes: a fila não acumula atrás dele
- [ ] #3 A arquitetura publicada continua compatível com a VPS de produção, comprovada por smoke da imagem
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
Resolvido com build nativo por arquitetura (ubuntu-latest para amd64, ubuntu-24.04-arm para arm64), cada um publicando por digest, e um job final montando o manifest multi-arch. Primeira run na main (#90): sucesso em 2min22s, contra horas de emulação QEMU e a falha por SIGILL (exit 132) da run #89.
<!-- SECTION:NOTES:END -->
