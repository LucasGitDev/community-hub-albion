---
id: TASK-034
title: Cargo Membro em toda aprovação de nick
status: Done
assignee: []
created_date: '2026-09-15 13:59'
updated_date: '2026-09-15 20:49'
labels:
  - bot
  - backend
milestone: m-2
dependencies:
  - TASK-014
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mudança pedida pelo usuário (2026-09-15): toda aprovação de nick, inclusive troca, garante o cargo Membro além de trocar o apelido (substitui a regra da Q31 de dar cargo só na primeira aprovação). Base: TASK-014 (DiscordMemberSync).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Primeira aprovação troca apelido e concede cargo Membro
- [x] #2 Aprovação de troca de nick troca apelido e concede cargo Membro se ausente
- [x] #3 Rejeição continua sem alterar apelido nem cargos
- [x] #4 Falha no Discord continua registrada sem desfazer a aprovação
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
1. planMemberSync: toda aprovação gera setNickname + addRole (idempotente)
2. Atualizar testes puros e DiscordMemberSync (troca agora espera cargo)
3. Docs/comentários e notas; gate
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Gate local (pnpm quality, commit eda26665): lint 0, race 0, typecheck ok, coverage branch 94.7% (>=79), e2e 28 ok/0 falha, imagem Docker build+smoke ok, duplicação 0%, dead code 0, audit high+ 0. Passou.

AC -> evidência:
- #1 primeira aprovação: domain/member-sync.test.ts 'primeira aprovação: apelido + cargo Membro'; bot/discord-member-sync.service.test.ts 'primeira aprovação aplica apelido e concede cargo Membro' (Postgres real + gateway falso).
- #2 troca: teste puro 'troca de nick aprovada: apelido + cargo Membro' e service test 'troca de nick aprovada altera o apelido e garante o cargo Membro' (addRole chamado com ROLE e id do pedido).
- #3 recusa: 'recusa não gera ação' e 'recusa não altera apelido nem cargos'.
- #4 falha Discord: 'falha de permissão é logada, não lança e a aprovação fica gravada' (inalterado, segue verde).

Decisões:
- planMemberSync não usa mais previousGameNick: toda aprovação = setNickname + addRole. Idempotente: roles.add de cargo existente é no-op no Discord. previousGameNick fica no evento só como informação.
- Limitação de apelido do dono da guild (GUILD_OWNER_NICKNAME) mantida; cada ação independente, cargo é aplicado mesmo se apelido falhar.
- Q31 revisada (doc-005) conferida. Sem UI (DoD#4 N/A). Não toca auth/ledger (DoD#6 N/A, security-review feito no PR conjunto sem achados).

Verificação manual Discord (pendência do usuário): aprovar uma troca de nick de membro que já tem o cargo e outro que perdeu o cargo; conferir apelido novo e cargo Membro presente.
Skills: task-done-check (checklist), security-review.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Toda aprovação de nick (primeira ou troca) agora troca o apelido e garante o cargo Membro (addRole idempotente); recusa segue sem ação e falha do Discord só é logada. Regra pura e testes atualizados. Pendente: merge e verificação real no Discord.
<!-- SECTION:FINAL_SUMMARY:END -->
