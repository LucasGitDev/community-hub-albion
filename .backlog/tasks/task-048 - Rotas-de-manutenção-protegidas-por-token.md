---
id: TASK-048
title: Rotas de manutenção protegidas por token
status: To Do
assignee: []
created_date: '2026-09-17 02:19'
labels:
  - backend
  - security
dependencies: []
priority: high
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Namespace de manutenção (dev e produção) atrás de um guard de header com segredo vindo do env. Sem sessão: chamada por curl. Libera ajuste de prata (lançamento adjustment no ledger, motivo obrigatório), revalidação de nick e disparo manual da limpeza agendada. NÃO inclui login como outro usuário em produção (o dev-login segue proibido em prod pelo env e inalterado em dev). Toda ação grava autor de manutenção, motivo e data, auditável no extrato. Token nunca aparece em log nem em mensagem de erro.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Guard de header recusa requisição sem token, com token errado e com token vazio; resposta não revela se o token existe
- [ ] #2 Ajuste de prata gera lançamento adjustment com motivo obrigatório e autor de manutenção, visível no extrato
- [ ] #3 Revalidação de nick e disparo da limpeza funcionam pelo mesmo namespace
- [ ] #4 Nenhuma rota do namespace permite agir como outro usuário nem ler sessão alheia
- [ ] #5 Token ausente no env desliga o namespace por completo
- [ ] #6 Token nunca é registrado em log, erro ou telemetria
- [ ] #7 security-review sem achados críticos
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
