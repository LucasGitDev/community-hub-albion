---
id: TASK-085
title: Menu de gestão da call no Discord
status: To Do
assignee: []
created_date: '2026-09-21 12:57'
updated_date: '2026-09-21 13:02'
labels: []
milestone: m-12
dependencies: []
priority: medium
type: feature
ordinal: 6850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decisões PE9 a PE11 no doc-005. Ao criar o canal de voz do evento, o bot publica no chat de texto dele um menu de gestão.

Opções: **finalizar o evento**, **fechar a call**, **abrir a call** e **chamar os ausentes** (ping em quem se inscreveu e não entrou). Iniciar evento e encerrar inscrições não entram — a call só existe depois disso.

Fechar a call é tirar a permissão de entrar de quem não está inscrito, deixando quem já está dentro (PE10). O menu é visível para todos, então a checagem é no clique: só caller do evento e staff executam (PE11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ao criar a call, o bot publica o menu no chat de texto do canal de voz
- [ ] #2 Finalizar o evento pelo menu faz o mesmo que finalizar pelo painel, passando pelo mesmo serviço
- [ ] #3 Fechar a call impede a entrada de quem não está inscrito e não remove ninguém que já está dentro
- [ ] #4 Abrir a call desfaz o fechamento
- [ ] #5 Quem não é caller do evento nem staff recebe recusa ao clicar, e nada é executado
- [ ] #6 Cada ação do menu publica na timeline com quem clicou
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Operação nova que muda estado publica na timeline depois do commit (ator, alvo, valor, ID), com teste que comprova; falha ao publicar nunca derruba a operação
- [ ] #8 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #9 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Escopo reduzido em 2026-09-21: 'chamar os ausentes' saiu do menu e virou a TASK-087 (privado para cada confirmado ausente, com queda para menção, intervalo de 5 min e gatilho também no painel — PE12 a PE16). O menu fica com finalizar o evento, fechar a call e abrir a call.
<!-- SECTION:NOTES:END -->
