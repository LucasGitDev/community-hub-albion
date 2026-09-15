---
id: doc-001
title: Contexto do Produto
type: specification
created_date: '2026-09-15 02:46'
updated_date: '2026-09-15 02:46'
---

## Visão geral
Servidor Discord de conteúdo de Albion Online (comunidade independente, não guilda). Bot + API + painel web.
Nome provisório: **albion-hub** ("CallBot" e "guild-hub" descartados).

## Estrutura do servidor
- Duas trilhas: callers oficiais (responsabilidade do servidor) e conteúdo livre.
- Canais de ping por tipo de conteúdo, canais de builds, chat geral, categoria privada de callers, categoria gestão/staff.
- Cargos de ping com auto-atribuição opt-in.
- Entrada: verificação + registro de nick in-game aprovado pela staff.

## Voice management (módulo compartilhado)
- Canal de voz temporário: dono tem controle total. Reusado por eventos.
- Sessões de voz: tabela única entrada/saída por canal — estatística geral + participação em evento (entrar/sair no meio permitido).

## Eventos e templates
- Template: fonte de verdade = DB (editável no painel). YAML só import/export.
- Cada evento tem canal de voz próprio gerenciado pelo bot. Início arrasta inscritos em call pro canal do evento; fim devolve pra "Aguardando Evento".
- Início: comando Discord, botão no painel ou botão em embed — mesmo serviço.
- Caller define valor final de moeda por role até fechamento (dentro da faixa do template); staff pode intervir. Valor travado no fechamento vale pra todos.
- Taxa de entrada (conteúdo disputado): template zerado; caller define até fechar inscrições, sem teto; sink puro.

## Economia — duas moedas
**Moeda temática** (sem saque)
- Fontes: participação em ping/evento, streak diário, ranking mensal, giveaways, indicação.
- Gastos: loja, evento beneficente, taxa de entrada, bilhete de giveaway.

**Prata** (com saque)
- Só via loot split, proporcional ao tempo de presença (voice sessions).
- Fluxo: draft (cálculo auto) → staff edita % → confirma → ledger imutável (correção via estorno).
- Confirmar/distribuir: staff com `event:distribute` OU criador do evento.
- Sobra da divisão (arredondamento) → organizador.
- Saque: `pending → approved|rejected → settled` (aprovação manual staff).

**Ledger**: tabela única por tipo de moeda, regras por moeda. Saque em tabela separada, só prata.

## Loja
- Fulfillment manual (fila staff). Estoque opcional.
- Cargos/cosméticos Discord: mapeados, não implementados na v1.

## Streak
- Qualquer conteúdo pingado conta como dia. Bônus fixo em marco (ex: 7 dias). Falta 1 dia zera.
- Futuro: marco vira buff; pagar moeda pra recuperar.

## Ranking mensal
- Participação, moeda ganha, moeda gasta, tempo jogado.
- Só participação (top 10) premia: moeda + cargo temporário "Participante do Mês".
- Histórico mensal + all-time.

## Indicação
- Link único por indicador; chave = ID da conta.
- Bônus fixo quando indicado ativa conta via site.
- Teto 10 recompensadas/mês; excedente só registra.
- Fraude/erro: correção manual da staff no ledger (via estorno).

## Giveaway
- Bilhete com moeda temática (sink). Staff cria; prêmio variável (moeda, cosmético/cargo, prata).
- V1 valor fixo. V2 jackpot.

## Inflação
- V1: só sinks definidos. Sem teto de saldo/decaimento.

## Tipos de conteúdo
DG grupo (4-9), DG Avalon (9-20), Raid do Dragão (15-20), Caçada (3-7), DG Fixa/Estática (5-9), Rato de Fixa (2-5), PvP Roaming (2-∞).
Valores de moeda: calibrar começando por DG grupo e Raid do Dragão.

## Auth e RBAC
Discord OAuth2 (garante membro). Stack de permissão: RBAC próprio (CASL), separado de cargos Discord.

## Em aberto
- Nome final.
- Valores de moeda por tipo.
- Cargos/cosméticos na loja.
- Giveaway jackpot (v2).
- Teto/decaimento de moeda.
