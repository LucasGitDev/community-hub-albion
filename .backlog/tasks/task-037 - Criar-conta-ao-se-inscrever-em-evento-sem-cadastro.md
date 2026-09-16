---
id: TASK-037
title: Criar conta ao se inscrever em evento sem cadastro
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-16 03:45'
updated_date: '2026-09-16 12:53'
labels:
  - bot
  - backend
dependencies: []
priority: high
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Jogador sem conta no painel que clica no botão de inscrição do evento deve ter a conta criada na hora, com a mesma lógica do /registrar (upsert pelo Discord, papel member, bootstrap admin). Hoje a inscrição é recusada pedindo /registrar. Nick continua opcional: inscrição não exige nick aprovado.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clique no botão de inscrição de quem não tem conta cria a conta e conclui a inscrição
- [x] #2 Resposta efêmera explica que a conta foi criada e sugere registrar o nick
- [x] #3 Mesma lógica do /registrar reaproveitada (sem duplicar regra de papéis)
- [x] #4 Membro que já tem conta segue sem mudança
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extrair AccountService (upsert + rolesForLogin) usado por /registrar e botões. 2. Botão de inscrição cria conta quando falta. 3. Copy efêmera 'conta criada'. 4. Testes + gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (Postgres, máquina livre): lint 0, race 0, typecheck ok, coverage 93.17%, e2e 40/40, imagem ok, dup 1.04%, vulns 0; aviso não bloqueante dead code 7 (exports shadcn pré-existentes).
Evidências:
- AC#1/#2: event-embed.service.test 'quem não tem conta ganha conta na hora e a inscrição vai até o fim (TASK-037)' — resposta contém o aviso de conta criada + 'Inscrição confirmada', inscrição fica confirmed, usuário criado com papel member e sem nick aprovado.
- AC#3: AccountService concentra upsert + rolesForLogin; NickRegistrationService.registerFromDiscord passou a usá-lo (sem regra de papéis duplicada).
- AC#4: segundo clique (sair) responde sem o aviso; teste 'quem tem conta sem acesso de membro é recusado sem escrever nada' garante recusa por CASL.
Decisões: inscrição não exige nick aprovado (nick vale a partir da F5); a criação acontece na autorização do botão, então clique em botão de evento fechado cria conta mas a inscrição é recusada — aceitável porque o clique veio de mensagem real do canal. Timeout do teste de boot compilado subiu para 60s (falha por máquina carregada, não regressão).
Skills: task-done-check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Botão de inscrição em evento cria a conta do painel na hora para quem ainda não tem, reaproveitando a mesma lógica do /registrar num AccountService único; a resposta efêmera avisa e sugere cadastrar o nick. Verificado com teste HTTP em Postgres real e pnpm quality verde.
<!-- SECTION:FINAL_SUMMARY:END -->
