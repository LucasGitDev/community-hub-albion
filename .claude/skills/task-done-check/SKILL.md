---
name: task-done-check
description: Verificação do agent antes de marcar AC/DoD ou fechar task do backlog no albion-hub — roda quality gate, confere visual com Playwright (desktop 1280 e mobile 400), valida produto contra doc-005, confirma skills do doc-003 e monta tabela de evidências. Use antes de `--check-ac`, `--check-dod`, status Done, commit final de feature, ou quando o usuário perguntar "está pronto?", "verifica", "done check".
---

# Task done check

Objetivo: provar, com evidência, que a task está certa **técnica e produto**. Sem evidência = não marca.
Rode também no meio da task (loop curto) pra corrigir rota cedo.

## 0. Contexto
1. `backlog task view <TASK> --plain` — ler AC, DoD, plano, notas.
2. `backlog doc view doc-005` — decisões (Q). `backlog doc view doc-003` — skills por módulo.
3. `git diff --stat main...HEAD` (ou `git status`) — arquivos tocados.

## 1. Escopo
- Cada arquivo alterado se explica por um AC ou pelo plano. Sobrou algo → reverter ou perguntar ao usuário (não expandir escopo calado).
- Nada de pós-v1 do doc-004 entrou.

## 2. Técnico
- Loop rápido durante a task: `pnpm quality lint,typecheck,coverage`.
- Antes de fechar: `pnpm quality` completo. Colar `.quality/summary.md` nas notas.
- Regra de negócio nova → teste unitário em `src/lib`, `src/domain` ou `packages/*/src` (dentro do include de coverage), nome do teste cita a Q quando existir.
- Guardrails por grep no diff:
  - dinheiro: `bigint`, nunca `Number(`/`parseFloat` sobre valor de prata fora de formatação;
  - ledger: nenhum update/delete de lançamento (só insert/estorno);
  - sem `any`, sem `// @ts-ignore`, sem `eslint-disable` novo sem justificativa;
  - cores só via tokens de `index.css` (`bg-ink`, `text-silver`...), sem hex solto em componente.

## 3. Visual (toda task que muda UI)
Use Playwright MCP com o app rodando (`pnpm --filter @albion-hub/web dev` em background):
1. `browser_resize` 1280×860 → percorrer o fluxo da task → `browser_take_screenshot` (salvar em `.playwright-mcp/`) → **Read da imagem**.
2. Repetir em 400×860.
3. Checar e anotar:
   - hierarquia: informação principal da tela é o elemento mais forte (ex.: saldo);
   - estados distinguíveis sem depender só de cor (ícone + texto + borda);
   - sem overflow horizontal: `browser_evaluate` → `document.documentElement.scrollWidth <= innerWidth`;
   - teclado: Tab chega nos controles com foco visível; diálogo fecha com Esc;
   - console sem erro (`browser_console_messages`);
   - copy PT-BR, voz ativa, CTA diz o que acontece, erro diz como resolver.
4. Garantir que `e2e/*.spec.ts` cobre o fluxo e anexa `snap()` nos estados-chave (vira artifact no CI).

## 4. Produto
- Tabela AC → evidência (abaixo). Cada linha aponta teste, spec e2e, screenshot ou saída de comando.
- Cruzar comportamento com Qs do doc-005 citadas na task. Divergência → parar e perguntar.
- UI/copy/escopo: invocar `marclou-review` na tela ou fluxo (um CTA principal, números em vez de adjetivos, uma ideia por tela).
- Onboarding, ativação, retenção: invocar `revenue-centric-design`.

## 5. Skills
- Listar skills do doc-003 que se aplicam aos módulos tocados; confirmar que foram invocadas nesta task.
- Obrigatórias: `security-review` quando toca auth, ledger, prata ou saque; `emil-design-eng` quando cria/altera componente.
- Registrar nas notas: `Skills: emil-design-eng, marclou-review, ...`.

## 6. Fechamento (seguir `backlog instructions task-finalization`)
```bash
backlog task edit <TASK> --append-notes "<resumo gate + tabela de evidência + skills>"
backlog task edit <TASK> --check-ac <n>     # só os provados
backlog task edit <TASK> --check-dod <n>    # só os provados
backlog task edit <TASK> --final-summary "Mudou X; verificado com Y."
```
Commits Conventional, atômicos, sem co-autor.

## 7. PR, merge e limpeza (Done = merged na main)
```bash
git push -u origin <branch>
gh pr create --title "<conventional>" --body "TASK-XXX ... resumo do gate + tabela de evidências"
gh pr checks <pr> --watch                  # esperar summary verde; falhou → corrigir e push
gh pr merge <pr> --rebase --delete-branch
git switch main && git pull --ff-only && git branch -d <branch> && git fetch --prune
git worktree remove <path> && git worktree prune   # se usou worktree
backlog task edit <TASK> -s Done --append-notes "Merged: <url do PR>"
```
Status Done só depois do merge. Commit do backlog (notas/status) vai no próprio PR antes do merge; o `-s Done` pós-merge entra no próximo PR ou em `chore(backlog)` direto via PR curto.

## Formato de saída
```
Task: TASK-XXX — <título>
Gate: ✅/⚠️/❌ (resumo)

| AC/DoD | Evidência | Status |
|---|---|---|
| AC#1 ... | e2e/panel.spec.ts "membro vê saldo" + screenshot carteira-desktop | ✅ |
| DoD#4 visual | .playwright-mcp/x-1280.png, x-400.png revisados; sem overflow | ✅ |

Skills usadas: ...
Pendências / perguntas ao usuário: ...
```
Se algo ❌: corrigir e rodar de novo. Não marcar parcial como feito.
