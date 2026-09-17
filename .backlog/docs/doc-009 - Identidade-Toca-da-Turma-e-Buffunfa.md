---
id: doc-009
title: 'Identidade: Toca da Turma e Buffunfa'
type: other
created_date: '2026-09-17 16:08'
---

Status: **decidido pelo usuário** (2026-09-17). Vale para painel, bot e qualquer texto voltado à
comunidade. Precede a F6 (moeda, taxa de entrada e loja) do doc "Roadmap pós-v1".

## Nomes
- **Servidor / comunidade:** Toca da Turma.
- **Bot:** Javali da Turma.
- **Moeda temática:** **Buffunfa** (buff + bufunfa). Abreviação na UI: `BUF`.
- **Alias aceito:** "bufunfa" (um `f`) em comandos e buscas. Só entrada — a saída sempre escreve
  **Buffunfa**, para o nome oficial não se diluir.

## Cores
| Uso | Cor |
|---|---|
| Prata (a moeda com saque) | cinza / prateado |
| Buffunfa | dourado |
| Âmbar | **só** CTA e destaque |

**Conflito com o tema atual, a resolver na F6:** hoje o token `--brand` é o dourado e está reservado
ao CTA primário e ao número-chave (decisão da TASK-036), enquanto `warning` é âmbar e já foi
apontado como concorrente do CTA na fila de saques. Com esta identidade, **dourado passa a
significar Buffunfa** e o destaque de ação migra para âmbar. Mexer nisso toca todas as telas, então
entra junto com a F6, que é quando a Buffunfa passa a existir de verdade — não antes, e não como
task solta de cosmética.

Consequência direta: prata deixa de usar o dourado onde ele ainda aparece como valor em destaque, e
passa a cinza/prateado. As duas moedas ficam distinguíveis por cor, não só por rótulo.

## Assets
Versionados em `assets/`:
- `buffunfa_simples_512.png` — site.
- `buffunfa_emoji_simples_128.png` — emoji do Discord.
- `buffunfa_512.png` — versão detalhada, guardada como origem.

## Emoji no bot
O ID do emoji vem de **env/config, nunca fixo no código** — emoji é por servidor, e chumbar o ID
quebra em qualquer outra instalação e vira mentira silenciosa se o emoji for recriado.

Formato de exibição: `340 <:buffunfa:ID>` (valor, espaço, emoji).

Sem o ID configurado, a saída cai para o texto puro (`340 BUF`), nunca para um emoji quebrado.
