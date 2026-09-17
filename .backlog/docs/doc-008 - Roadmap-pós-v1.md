---
id: doc-008
title: Roadmap pós-v1
type: other
created_date: '2026-09-17 14:25'
updated_date: '2026-09-17 22:17'
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

## F6 — Moeda Buffunfa, taxa de entrada e loja — **entregue (2026-09-17)**

As seis tasks estão na `main`. Decisões em doc-005 (F6-1 a F6-57), identidade em doc-009.

| Task | Entregou |
|---|---|
| TASK-055 | Três papéis, três matizes: ouro = Buffunfa, âmbar = CTA, prata = neutro |
| TASK-056 | Coluna `currency` no ledger, saldo e extrato por moeda, `/api/maintenance/buffunfa`, emoji do bot |
| TASK-057 | Ganho por presença: faixa por role, valor do fechamento, corte de 90% |
| TASK-058 | Taxa de entrada cobrada na inscrição, sink puro, devolução por estorno |
| TASK-059 | Loja: catálogo de item de texto livre, estoque opcional, compra que reserva |
| TASK-060 | Fila de pedidos: `reserved → claimed → delivered`, entrega lança o débito |

**Pronto, verificado:** um membro ganha Buffunfa participando de um evento, paga taxa de entrada num
conteúdo disputado, compra um item na loja e a staff entrega pela fila.

**Duas coisas que a fase deixou para o usuário decidir quando usar:** a prata passou a ser abreviada
no chip do header (F6-30, saiu de um estouro real de layout em 400px) e quem começa o evento ainda
na espera recebe a taxa de volta (F6-42).

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

**Indicação — desenho revisto pelo usuário em 2026-09-17, sem link:** o indicado **declara** quem o
indicou, por dois caminhos que gravam a mesma coisa: um campo opcional no **comando de registro** de
nick, e um **comando próprio** para quem já se registrou e esqueceu. Uma vez só, e não se troca.

O link único saiu de cena de propósito: ele obriga o jogador novo a chegar por um caminho
específico, e quem entrou pelo convite normal do servidor perde a atribuição para sempre. Declarar
é o gesto que a pessoa já está fazendo — ela está registrando o nick de qualquer jeito — e não cria
tela nenhuma no site, que é atrito para o jogador comum.

O que muda em relação ao desenho antigo, e que precisa valer: a chave passa a ser **digitada**, não
clicada. Isso troca o problema de cobertura pelo de digitação — nick errado, nick de quem saiu,
autoindicação. O pagamento continua **fixo**, e continua acontecendo só quando o indicado **existe
de verdade**: nick aprovado pela staff, que é o portão que já existe. Teto de 10 recompensadas por
mês; o excedente registra sem pagar. Fraude ou erro se corrige por estorno da staff — o ledger é
append-only e continua sendo.

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
multi-guild, i18n, upload de comprovante de saque.

**Adiados com fase conhecida, não descartados:** ping comprado com Buffunfa (vai com a F7, que é
quando permissão vira coisa de primeira classe — caminho paralelo na F6 seria construir duas
vezes) e **transações entre jogadores**, que precisa de fase própria depois da loja rodar: ela
abre lavagem de taxa de entrada (dois membros se financiando) e exige limite e rastro próprios.

---

## Como este doc vira trabalho

Uma fase por vez: grelhar as decisões abertas dela, registrar no doc "Decisões v1", quebrar em
tasks e executar. Fase seguinte só começa com a anterior mergeada na `main` — foi o que manteve a
v1 inteira em ordem.
