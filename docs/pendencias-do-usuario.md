# Pendências do usuário

Tudo que depende de uma decisão ou de uma ação do Lucas, em um lugar só. O agent
não resolve nada daqui sozinho. O backlog (`backlog task list --plain`) fica
reservado para trabalho que o agent executa.

Atualizado em 2026-09-17, com as tasks 047 a 051 mergeadas.

Responda por número (ex.: "N1 mantém; N3 muda pra staff-only"). O que virar
trabalho vira task; o que for decisão vai para o doc "Decisões v1" do backlog.

---

## Decisões novas (leva de 047 a 051)

### N1 — Autoria "manutenção" no banco

O ajuste de prata feito pelo namespace de manutenção registra a autoria na origem
do lançamento (`manual/maintenance`), no motivo e numa nota no perfil do jogador —
mas o **campo de autor no banco fica vazio**, porque ele aponta para um usuário
real e não existe um usuário "manutenção".

**Está rastreável assim.** A alternativa é criar um usuário de sistema no banco
para figurar como autor. É task curta.

**Decisão:**

---

### N2 — Staff não bane staff nem admin

Veio do security-review da TASK-050, não do seu pedido: sem essa trava, uma conta
de staff comprometida bane todos os admins menos um e neutraliza quem poderia
reagir. **Staff continua banindo member e caller**, como você decidiu.

**Decisão:** (confirmar ou derrubar)

---

### N3 — Membro vê quem fez o ajuste na prata dele

O extrato do jogador lido pela staff (TASK-051) mostra o autor de cada lançamento.
Como a mesma rota aceita o próprio id, **um membro consultando o próprio extrato
por ali vê qual staff fez um ajuste** — algo que `/api/me/ledger` não expõe.

É dado dele e não vaza nada sobre terceiros, então ficou. Se a intenção for que
autoria seja coisa de staff, é uma linha.

**Decisão:**

---

### N4 — Quem sai e volta ao servidor perde os papéis

A limpeza diária remove os papéis de RBAC (staff, caller) de quem saiu. Voltar ao
servidor **limpa a marca de saída, mas não devolve os papéis**: devolver acesso é
ato de alguém, nunca de um timer.

Efeito prático: um caller que saiu e voltou precisa de nova concessão pela tela de
papéis.

**Decisão:**

---

### N5 — "Papéis" na limpeza = RBAC, não cargo do Discord

A limpeza remove `user_roles` (as permissões do painel). Não mexe no cargo Membro
do Discord — quem já saiu da guild não tem cargo nenhum para remover.

**Decisão:** (só confirmar que é o entendimento certo)

---

### N6 — Sem filtro "Saiu do servidor" na lista

Quem saiu ganhou selo na linha, mas **não** ganhou um chip de filtro próprio, para
não mexer no filtro compartilhado e nas contagens. Se você quiser filtrar por isso,
vira task.

**Decisão:**

---

### N7 — Skills de design em mudança de visibilidade

Na TASK-047 o agent não invocou as skills de design, porque nenhum componente ou
texto foi escrito — só mudou **quem enxerga** controles que já existiam. Faz
sentido, mas a tela renderizada muda para um papel inteiro.

**Decisão:** exigir as skills sempre que a tela muda para algum papel, ou manter o
critério atual (só quando há componente/texto novo)?

---

## Configuração que só você pode fazer

- [ ] **`MAINTENANCE_TOKEN` no Easypanel.** Sem ele, o namespace de manutenção não
      existe (estado seguro). Gere com `openssl rand -base64 48`. **Se vazar,
      troque o valor e reinicie** — não há revogação, o valor É o acesso.

---

## Testes que só você pode fazer

- [ ] **Ciclo completo com prata de verdade**: evento → finalizar → acertar taxa →
      dividir → confirmar → membro pede saque → staff aprova e entrega. Primeiro
      lançamento real no ledger.
- [ ] **Importação de membros já registrados**, conferindo nick validado na API.
- [ ] **Embed e botões de inscrição** depois da F5 e da descrição por role.
- [ ] **Ruleset da `main`**: tentar push direto e confirmar que a regra recusa.
- [ ] **Banir e desbanir** um jogador de teste, conferindo que o acesso cai na hora
      e que o saldo dele continua intacto.
- [ ] **Extrato de um jogador** pela lista de membros, como staff.

---

## Decidido antes (não reabrir sem motivo)

Grelha de 2026-09-16, no doc "Decisões v1" (bloco G1–G13): evento cancelado segue
editável, nick único, admin não revogado pelo env, staff pode aprovar o próprio
nick, saque sem mínimo, sessão de 30 dias com limpeza diária, e as escolhas de
interface da role e do perfil.

---

## Plano B registrado, não implementado

**Saque sem mínimo** confirmado. Se a fila entupir de pedido minúsculo: **um pedido
pendente por membro**, nunca ressuscitar o mínimo.

---

## Depois da v1

Roadmap (doc "Roadmap" no backlog): moeda temática com taxa de entrada e loja
juntas (pra ter sink), cargos de ping opt-in, canal de voz temporário com dono,
streak, ranking mensal, giveaway e indicação. Nada virou task ainda.

A única task aberta no board é a **TASK-052** (permissões separadas dos papéis),
que torna definitivo o que hoje staff recebe em bloco. Desenho a combinar.
