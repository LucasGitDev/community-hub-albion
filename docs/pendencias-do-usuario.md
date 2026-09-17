# Pendências do usuário

Tudo que depende de uma decisão ou de uma ação do Lucas, em um lugar só. O agent
não resolve nada daqui sozinho. O backlog (`backlog task list --plain`) fica
reservado para trabalho que o agent executa.

Atualizado em 2026-09-16, depois da grelha que zerou as decisões em aberto.

---

## Decidido em 2026-09-16

Todas as onze pendências anteriores foram resolvidas na grelha. As decisões estão
no doc "Decisões v1" do backlog (bloco "Grelha de 2026-09-16"), que é a fonte de
verdade. Resumo do que virou trabalho:

| Decisão | Virou |
|---|---|
| Staff alcança a gestão de usuários | TASK-047 |
| Rotas de manutenção com token no header (dev e prod) | TASK-048 |
| Limpeza diária de quem saiu do servidor | TASK-049 |
| Banimento com acesso cortado na hora e saldo congelado | TASK-050 |
| Staff e admin leem o extrato de um jogador | TASK-051 |
| Permissões separadas dos papéis (torna 047 e 050 definitivas) | TASK-052 |

O que foi decidido e **não** gera trabalho: evento cancelado segue editável, nick
continua único, admin não é revogado pelo env, staff pode aprovar o próprio nick,
saque sem mínimo confirmado, e as duas escolhas de interface (descrição fora do
formulário de criação da role; perfil com disponível e reservado).

`main` protegida por ruleset (PR + check `summary`, sem push forçado, sem deleção,
sem exceção). Falta você testar que a regra pega.

---

## Aviso que continua valendo

**O token de manutenção (TASK-048) é a chave mais forte do sistema.** Ele ajusta
prata em produção. Se vazar, quem tiver imprime dinheiro, e como o ledger é
imutável o conserto é estorno manual, um por um. As mitigações embutidas — motivo
obrigatório, autor registrado em cada lançamento, sem agir como outro usuário,
token nunca em log — tornam tudo rastreável e limitam o estrago, mas não mudam
isso. Se o token aparecer em qualquer lugar fora do env, troque.

---

## Testes que só você pode fazer

- [ ] **Ciclo completo com prata de verdade**: criar evento, abrir, rodar,
      finalizar, acertar a taxa na tela de acerto, dividir o loot, confirmar, e um
      membro pedindo saque com a staff aprovando e entregando. É o primeiro teste
      em que o ledger recebe lançamento real.
- [ ] **Importação de membros já registrados**, conferindo quem teve o nick
      validado na API do Albion e quem não teve.
- [ ] **Embed e botões de inscrição** depois das mudanças da F5 e da descrição por
      role.
- [ ] **Ruleset da `main`**: tentar um push direto e confirmar que a regra recusa.

---

## Plano B registrado, não implementado

**Saque sem mínimo** está confirmado. Se a fila entupir de pedido minúsculo, o
remédio é **um pedido pendente por membro**, nunca ressuscitar o mínimo.

---

## Depois da v1

O roadmap (doc "Roadmap" no backlog) já lista o pós-v1: moeda temática com taxa de
entrada e loja juntas (pra ter sink), cargos de ping opt-in, canal de voz
temporário com dono, streak, ranking mensal, giveaway e indicação. Nada virou task
ainda.

---

## Como responder daqui pra frente

Decisão nova entra aqui como pergunta, com situação, recomendação e um campo em
branco. Respondida, vai pro doc "Decisões v1" e, se gerar trabalho, vira task.
