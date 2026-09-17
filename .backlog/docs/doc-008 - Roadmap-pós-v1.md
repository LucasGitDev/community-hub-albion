---
id: doc-008
title: Roadmap pós-v1
type: other
created_date: '2026-09-17 14:25'
---

Status: **rascunho para debate** (2026-09-17). Sucede o doc "Roadmap", cuja v1 (F0–F5) está
entregue e no ar. Aqui ficam as features já desejadas no doc "Contexto do Produto" que a
primeira fase deixou de fora, organizadas em fases com ordem defendida.

Critério de corte que vale de novo: **cada fase entrega algo que a guilda usa sozinha**. Fase
que só existe para habilitar a próxima não entra sozinha no board — entra colada na que a usa.

---

## O que sobrou da v1 (dívida, não fase)

| # | Item | Por que ficou |
|---|---|---|
| TASK-052 | Permissões separadas dos papéis | Hoje `staff` é um bloco (banir, gerenciar membro, ler extrato, aprovar saque). Só dá pra recortar direito conhecendo as capacidades que a loja e a moeda trazem: quem define preço, quem publica item, quem entrega pedido, quem estorna compra. **Decisão do usuário: fica depois da loja e da moeda.** |

---

## F6 — Moeda temática, taxa de entrada e loja

**Entram juntas de propósito.** Moeda sem onde gastar é número morto na tela; loja sem moeda não
tem o que cobrar. O sink precisa nascer no mesmo dia que a fonte.

**Moeda**
- Segunda moeda no ledger, **sem saque**, regras próprias. O doc "Arquitetura" já previa tabela por
  tipo de moeda; a F5 deliberadamente não criou a coluna `currency` (migration aditiva barata).
- Fontes previstas no produto: participação em ping/evento, streak, ranking mensal, giveaway,
  indicação. **Na F6 entra só a participação em evento** — as outras chegam com suas fases.
- Valor por role definido pelo caller até o fechamento, dentro da faixa do template; staff pode
  intervir; o valor trava no fechamento e vale para todos.

**Taxa de entrada**
- Conteúdo disputado: template nasce zerado, caller define até fechar inscrições, sem teto.
- **Sink puro** — a moeda cobrada some, não vai para ninguém. É o que diferencia da taxa do split
  (prata), que vai para o caller/dono.

**Loja**
- Fulfillment manual, com fila para a staff, no molde da fila de saques que já existe.
- Estoque opcional por item.
- Cargos e cosméticos do Discord ficam **mapeados, não automatizados** (decisão da v1).

**Pronto quando:** um membro ganha moeda participando de um evento, paga taxa de entrada num
conteúdo disputado, compra um item na loja e a staff entrega pela fila.

**Perguntas a grelhar antes de começar:** nome e símbolo da moeda; se a taxa de entrada é cobrada
na inscrição ou no início do evento (e o que acontece com quem desiste); se compra na loja pode
ficar negativa; se estorno de compra é estorno de ledger ou devolução de item ao estoque.

---

## F7 — Permissões separadas dos papéis (TASK-052)

Vem **logo depois** da F6, não antes: só aí as capacidades reais estão todas na mesa. Hoje o
projeto tem duas permissões provisórias esperando esta fase — staff na gestão de usuários e staff
banindo member/caller.

**Pronto quando:** dar a alguém "aprovar saque" não dá junto "banir" nem "ler extrato".

---

## F8 — Cargos de ping opt-in

Auto-atribuição de cargo por tipo de conteúdo, para o caller pingar quem quer ser pingado.
**Até aqui, usar o Onboarding nativo do Discord** — é a decisão da v1 e continua valendo enquanto
a fase não chega.

**Pronto quando:** o membro escolhe no painel ou por embed quais conteúdos quer ser chamado, e o
ping do caller alcança só esse grupo.

---

## F9 — Streak

Qualquer conteúdo pingado conta como dia. Bônus fixo em marco (ex.: 7 dias). Faltar um dia zera.
Depende da moeda existir (F6) para ter o que pagar.

Fora do radar, registrado para não voltar como novidade: marco virar buff, e pagar moeda para
recuperar streak perdido.

**Pronto quando:** participar hoje mantém o streak, o marco paga sozinho e faltar um dia zera.

---

## F10 — Ranking mensal

Participação, moeda ganha, moeda gasta e tempo jogado. **Só participação premia** (top 10): moeda
mais o cargo temporário "Participante do Mês". Histórico mensal e all-time.

Depende de F6 (prêmio em moeda) e se apoia nas voice sessions da F3, que já medem tempo.

**Pronto quando:** o mês vira, o top 10 recebe sozinho e o histórico fica consultável.

---

## F11 — Giveaway e indicação

Duas features pequenas que fecham o ciclo da moeda, e que juntas dão uma leva só.

**Giveaway:** bilhete comprado com moeda temática (mais um sink). Staff cria; prêmio variável
(moeda, cosmético/cargo, prata). Valor fixo por bilhete; jackpot está fora do radar.

**Indicação:** link único por indicador, chave é o ID da conta. Bônus fixo quando o indicado ativa
a conta pelo site. Teto de 10 recompensadas por mês; o excedente registra sem pagar. Fraude ou erro
se corrige por estorno da staff — o ledger é append-only e continua sendo.

**Pronto quando:** um membro compra bilhete, a staff sorteia e paga; e um indicado que ativa conta
gera bônus ao indicador dentro do teto.

---

## Canal de voz temporário com dono

Ficou no pós-v1 do roadmap original e **não tem fase atribuída** — é independente da economia.
Encaixa em qualquer intervalo, inclusive antes da F6, se a guilda pedir. Aproveita a máquina de
canais que a F4 já construiu.

---

## Fora do radar (registrado para não voltar como novidade)

Realtime, cosméticos na loja, jackpot, teto e decaimento de moeda, buff e recuperação de streak,
evento beneficente, multi-guild, i18n, upload de comprovante de saque.

---

## Como este doc vira trabalho

Uma fase por vez: grelhar as decisões abertas dela, registrar no doc "Decisões v1", quebrar em
tasks e executar. Fase seguinte só começa com a anterior mergeada na `main` — foi o que manteve a
v1 inteira em ordem.
