---
id: TASK-048
title: Rotas de manutenção protegidas por token
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-17 02:19'
updated_date: '2026-09-17 02:47'
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
- [x] #1 Guard de header recusa requisição sem token, com token errado e com token vazio; resposta não revela se o token existe
- [x] #2 Ajuste de prata gera lançamento adjustment com motivo obrigatório e autor de manutenção, visível no extrato
- [x] #3 Revalidação de nick e disparo da limpeza funcionam pelo mesmo namespace
- [x] #4 Nenhuma rota do namespace permite agir como outro usuário nem ler sessão alheia
- [x] #5 Token ausente no env desliga o namespace por completo
- [x] #6 Token nunca é registrado em log, erro ou telemetria
- [x] #7 security-review sem achados críticos
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
1. Env: MAINTENANCE_TOKEN opcional (mín. 32 chars, trim); ausente/vazio = namespace desligado. Nunca ecoado em erro de parse.
2. MaintenanceTokenGuard: lê header x-maintenance-token, compara sha256 via crypto.timingSafeEqual; qualquer recusa vira NotFoundException com o mesmo corpo do 404 de rota inexistente (method + url), então token ausente/vazio/errado e namespace desligado são indistinguíveis.
3. MaintenanceModule.register(env) só entra no AppModule quando o token existe; nenhuma rota registrada sem ele.
4. Rate limit em memória no namespace (janela fixa, poucas ops/min) aplicado depois do guard; excesso = 429.
5. POST /api/maintenance/silver: {userId, amount (string inteira != 0), reason obrigatório}. Grava via LedgerService.record com kind=adjustment, reference {type: manual, id: maintenance}, createdBy=null (autoria de manutenção) e memo 'Manutenção: <motivo>'; também escreve nota system no perfil do membro. Aparece no extrato como qualquer lançamento.
6. POST /api/maintenance/albion-check: extrai a revalidação do AdminMemberProfileController para um AlbionCheckService reaproveitado pelos dois caminhos (um comportamento, duas portas).
7. POST /api/maintenance/cleanup: chama o token MAINTENANCE_CLEANUP (ponto de extensão da TASK-049); sem provider registrado responde 503 com texto claro. Documentado nas notas para a TASK-049 plugar.
8. Nenhuma rota lê cookie, cria sessão ou aceita identidade de sessão: só userId explícito no corpo, e nunca vira ator.
9. Testes: unit do guard (tempo constante, recusas idênticas, token fora de log), http do namespace (ligado/desligado, três operações, rate limit, ausência de sessão) e env.
10. Docs: .env.example + CLAUDE.md com curl usando placeholder e aviso de rotação. security-review como bloqueante.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Gate (pnpm quality completo, commit 83345035)

| Métrica | Resultado | Threshold | Status |
|---|---|---|---|
| Linting | 0 issue(s) | 0 | ✅ |
| Race conditions | 0 | 0 | ✅ |
| Typecheck | ok | 0 erros | ✅ |
| Testes + coverage (branch) | 89.51% (1024 testes, 76 arquivos) | ≥ 79% | ✅ |
| E2E + screenshots | 80 ok, 0 falha, 0 flaky (porta 4193) | 0 falhas | ✅ |
| Imagem Docker (build + smoke) | build ok, SPA 200, /api 404 JSON, health ok | ok | ✅ |
| Duplicação | 1.74% | ≤ 15% | ✅ |
| Dead code | 6 (todos pré-existentes em apps/web/src/components/ui) | advisory | ⚠️ |
| Vulnerabilidades (high+) | 0 | 0 | ✅ |

Resultado: **Passou com avisos** (aviso é dead code pré-existente da UI, não tocado por esta task).
Postgres do gate: docker compose -p task048 na porta 55443.

## Evidência por AC

| AC | Evidência | Status |
|---|---|---|
| AC#1 guard recusa sem token, com token errado e vazio; resposta não revela nada | maintenance.http.test.ts "token ausente, vazio e errado devolvem exatamente a mesma resposta" (6 variantes, 1 corpo único) e "a recusa é idêntica à de uma rota que não existe"; maintenance.test.ts "recusa ausente, vazio e errado do mesmo jeito" | ✅ |
| AC#2 ajuste adjustment com motivo obrigatório e autor de manutenção, visível no extrato | maintenance.http.test.ts "credita e debita pelo ledger, com motivo no memo, e aparece no extrato" (kind=adjustment, reference manual/maintenance, createdBy null, memo 'Manutenção: ...', nota system) e "recusa sem motivo, com valor zero e com usuário inexistente"; maintenance.test.ts parseSilverAdjustment | ✅ |
| AC#3 revalidação de nick e disparo da limpeza no mesmo namespace | maintenance.http.test.ts "consulta o Albion e grava o resultado no membro" (grava albionStatus/albionPlayerId) e os dois testes de cleanup (503 sem provider, 200 com o módulo dublê da TASK-049) | ✅ |
| AC#4 nenhuma rota permite agir como outro usuário nem ler sessão alheia | maintenance.http.test.ts "não devolve cookie de sessão, não cria sessão e ignora cookie enviado" (contagem de sessions igual antes/depois) e "não existe rota de login, de sessão nem de agir como outro usuário"; o controller injeta só DB_HANDLE, LedgerService e AlbionCheckService — nenhum SessionService | ✅ |
| AC#5 token ausente no env desliga o namespace por completo | maintenance.http.test.ts "sem MAINTENANCE_TOKEN no env o namespace inteiro não existe" (404 nas três rotas **com o token certo**, e corpo idêntico ao do namespace ligado com token errado); env.test.ts "ausente ou vazio deixa o namespace desligado" | ✅ |
| AC#6 token nunca em log, erro ou telemetria | maintenance.http.test.ts "o token não aparece na resposta nem em log" (espia console.log/warn/error/debug/info e varre corpo + headers das respostas recusada e aceita); env.test.ts "token curto é recusado sem aparecer na mensagem" | ✅ |
| AC#7 security-review sem achados críticos | security-review: **zero achados** com severidade HIGH/MEDIUM e confiança ≥ 8. As cinco promessas do design foram verificadas uma a uma no código (namespace ausente sem env, 404 indistinguível, timingSafeEqual sobre SHA-256, token sem vazamento, sem sessão). Confirmou também que não há enableCors no app (CSRF de navegador não alcança) e que o refactor do AlbionCheckService **não** derrubou SameOriginGuard nem Authorize('update','UserRole') na rota do painel | ✅ |

## Decisões de implementação

- **Desligado = inexistente**: `MaintenanceModule.register` devolve null sem `MAINTENANCE_TOKEN`; o AppModule não importa nada. Sem controller, sem handler, sem superfície pra sondar.
- **Recusa = 404 de rota inexistente** (`Cannot POST /api/...`), não 401/403: um 401 já contaria que existe algo ali.
- **Tempo constante**: SHA-256 dos dois lados e `timingSafeEqual` sobre digests de 32 bytes — comparar bytes crus exigiria checar tamanho antes e vazaria o tamanho do segredo.
- **Autoria**: `createdBy` fica null porque a coluna guarda *pessoa logada* e aqui não há sessão; a autoria de manutenção é explícita na origem `manual/maintenance`, no memo e numa nota `system` no perfil do membro.
- **Rate limit** de 20/min por janela fixa, aplicado **depois** do token: quem não tem o segredo não gasta a cota nem descobre o 429.
- **Guardrails**: diff sem `any`, sem @ts-ignore, sem eslint-disable novo, sem Number()/parseFloat sobre prata, sem update/delete de lançamento.

## Ponto de extensão para a TASK-049

`POST /api/maintenance/cleanup` já existe e chama o token Nest `MAINTENANCE_CLEANUP` (apps/server/src/maintenance/maintenance.tokens.ts). Sem provider registrado ela responde 503 dizendo que a limpeza não existe — nunca 200 fingindo trabalho feito.

Para plugar, a TASK-049 só precisa registrar um provider com esse token num módulo global:
`@Module({ providers: [{ provide: MAINTENANCE_CLEANUP, useValue: minhaLimpeza }], exports: [MAINTENANCE_CLEANUP] })`, global no AppModule. Nada do namespace muda. O teste "com o ponto de extensão registrado chama a limpeza e devolve o resumo" usa exatamente esse formato como dublê.

Contrato de `run()`: idempotente, não lança pra erro esperado, devolve contadores livres e **nunca toca em saldo ou ledger** (G6).

## Skills
Skills: security-review (obrigatória: toca ledger e prata; sem achados), task-done-check.
Não se aplicam: emil-design-eng / frontend-design / marclou-review / revenue-centric-design / animate — esta task não tem UI (namespace de curl, zero arquivo em apps/web). Por isso DoD#4 fica marcado como não aplicável.

## Nota de processo
O arquivo desta task veio da branch chore/grill-decisions (onde ela nasceu junto com a grelha de 2026-09-16). Se aquela branch entrar na main antes desta, o rebase resolve o arquivo duplicado.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Namespace /api/maintenance atrás de MAINTENANCE_TOKEN no header, válido em dev e produção, sem sessão (G5): ajuste de prata (adjustment pelo LedgerService, motivo obrigatório, autoria de manutenção, visível no extrato), revalidação de nick no Albion e disparo da limpeza da TASK-049 por ponto de extensão. Sem o segredo no env o módulo não é registrado e nenhuma rota existe; token ausente, vazio e errado devolvem o mesmo 404 de rota inexistente, comparado em tempo constante (timingSafeEqual sobre SHA-256), com rate limit de 20/min aplicado só depois do token. Nada de sessão: o userId é sempre alvo, nunca ator. Verificado com 13 testes HTTP do namespace, 11 unitários do domínio, 3 de env, security-review sem achados HIGH/MEDIUM e pnpm quality completo verde (coverage 89.51%, e2e 80/80, docker smoke ok). DoD#4 não se aplica: a task não tem UI.
<!-- SECTION:FINAL_SUMMARY:END -->
