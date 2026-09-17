# Pendências do usuário

Tudo que depende de uma decisão ou de uma ação do Lucas, em um lugar só. O agent
não resolve nada daqui sozinho. O backlog (`backlog task list --plain`) fica
reservado para trabalho que o agent executa.

Atualizado em 2026-09-17, depois da grelha que resolveu N1–N7.

Responda por número (ex.: "N1 mantém; N3 muda pra staff-only"). O que virar
trabalho vira task; o que for decisão vai para o doc "Decisões v1" do backlog.

---

## Decisões novas: todas resolvidas em 2026-09-17

As sete (N1–N7) foram respondidas na grelha e estão no doc "Decisões v1" do
backlog, bloco "Grelha de 2026-09-17". Resumo: autoria da manutenção fica sem
usuário de sistema; staff não bane staff nem admin; membro vê o autor do ajuste no
próprio extrato; quem sai e volta não recupera papéis; "papéis" na limpeza é RBAC;
o filtro de quem saiu virou a TASK-054, junto com uma passada em todos os filtros;
e mudança só de visibilidade exige revisão visual por screenshot no papel afetado,
não as skills de design (já escrito no CLAUDE.md).

**Nenhuma decisão em aberto.**

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
