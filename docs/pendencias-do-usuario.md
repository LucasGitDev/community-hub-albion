# Pendências do usuário

Tudo que depende de uma decisão ou de uma ação do Lucas, em um lugar só. O agent
não resolve nada daqui sozinho: são escolhas de produto, de segurança ou de
operação. O backlog (`backlog task list --plain`) fica reservado para trabalho
que o agent executa.

Atualizado em 2026-09-16, com a milestone F5 (economia) fechada e no ar.

---

## 1. Decisões de produto em aberto

### 1.1 Evento cancelado deve ser imutável?

**Situação.** O guard `eventEditBlocked` (`packages/shared/src/events.ts`) só barra
edição em `archived`. Na prática dá para renomear um evento **cancelado** pela API.

**Por que ficou assim.** É o padrão que já existia no projeto: `transferOwner` e
`setFee` se comportam do mesmo jeito. A tela de acerto (TASK-029) só oferece o
formulário quando o status é `finished`, então ninguém esbarra nisso pelo painel.

**O que muda se você decidir que sim.** Uma linha no guard, mas afeta os endpoints
das TASK-027/028 juntos — por isso não foi feito por conta própria.

**Decisão:**

---

### 1.2 Gestão de usuários: só admin ou staff também?

**Situação.** A lista de membros e as ações da TASK-045 (buscar nick na API do
Albion, editar nick e tag, notas internas) estão atrás da permissão `UserRole`,
que só o `admin` alcança. **Staff recebe 403**, e existe teste garantindo isso.

**Por que ficou assim.** O pedido foi "staff/admin", mas essa tela nasceu na
TASK-043 inteira atrás de `UserRole`. Abrir dados de membro para staff é decisão
de produto, então o caminho estreito foi o escolhido.

**O que muda se você decidir abrir.** Criar um subject `MemberProfile` no CASL com
leitura e edição para staff. Mudança pequena.

**Decisão:**

---

### 1.3 Nick duplicado na edição

**Situação.** Editar um membro para um nick que outro já usa devolve 409.

**Por que ficou assim.** Não estava escrito na task. Entrou porque nick repetido
deixa a lista de membros e a validação na API do Albion ambíguas — apareceu na
prática como colisão real entre as execuções de teste.

**O que muda se a guilda tiver caso legítimo de nick repetido.** Remover a
checagem de unicidade na edição.

**Decisão:**

---

### 1.4 Fila de saques sem mínimo

**Situação.** Não existe valor mínimo de saque (sua decisão, revoga o antigo 1M).
Um pedido de 1 de prata dá o mesmo trabalho manual que um de 10M: transferir
in-game e marcar a entrega com nota.

**Sugestão registrada, não implementada.** Se a fila encher de pedido minúsculo, o
remédio barato é **um saque pendente por membro de cada vez**, não voltar com
mínimo.

**Decisão:** (só vale a pena depois de ver a fila real em uso)

---

## 2. Segurança

### 2.1 Semear prata pelo login de desenvolvimento

**Situação.** Para os testes automatizados criarem saldo, o endpoint de dev-login
(`apps/server/src/auth/dev-login.controller.ts`) aceita um campo `silver` que
insere lançamentos no ledger.

**Por que é aceitável.** É o mesmo portão `AUTH_DEV_LOGIN`, que o schema de env
**proíbe em produção** — não abre superfície nova. A inserção passa pelo repo
normal do ledger, então o append-only continua valendo.

**O incômodo legítimo.** Ainda é prata sendo criada por uma rota HTTP.

**Alternativa se preferir.** Semear direto no banco, fora da API, num helper de
teste.

**Decisão:**

---

### 2.2 Riscos baixos ainda não decididos (de antes da F5)

- **Sessão de 30 dias sem revalidar** se a pessoa continua no servidor do Discord.
  Quem sai da guilda mantém acesso ao painel até a sessão expirar.
- **Remover um id de `BOOTSTRAP_ADMIN_DISCORD_IDS` não revoga admin** de quem já
  logou: o papel já foi concedido no banco. Revogar é manual, pela tela de papéis.
- **Staff pode aprovar o próprio nick.**

**Decisão:**

---

## 3. Design

### 3.1 Âmbar de "Em análise" versus o dourado do CTA

**Situação.** A pílula de estado "Em análise" usa o token `warning` (âmbar), que
divide atenção com o dourado `--brand`, reservado ao botão principal e ao
número-chave.

**Por que não foi mexido.** `StatusBadge` é compartilhado com as telas do membro;
trocar o token sairia do escopo da task que notou o problema.

**Decisão:**

---

## 4. Operação e infraestrutura

### 4.1 Proteção de branch na `main`

Não há branch protection configurada. Todo merge hoje depende do agent seguir a
regra de abrir PR e esperar o check `summary`. Uma regra no GitHub tornaria isso
obrigatório de verdade.

**Decisão:**

### 4.2 Credenciais de registry no Easypanel

Já resolvido na prática, mas registrando: o pull anônimo do Docker Hub bate em
rate limit. As credenciais precisam continuar configuradas no Easypanel.

---

## 5. Testes que só você pode fazer

- [ ] **Ciclo completo com prata de verdade**: criar evento, abrir, rodar,
      finalizar, acertar a taxa na tela de acerto, dividir o loot, confirmar, e um
      membro pedindo saque com a staff aprovando e entregando. É o primeiro teste
      em que o ledger recebe lançamento real e onde a interface de acerto encosta
      na forma como você fecha evento na prática.
- [ ] **Importação de membros já registrados** no servidor, conferindo quem teve o
      nick validado na API do Albion e quem não teve.
- [ ] **Conferir o embed e os botões** de inscrição por role depois das mudanças da
      F5.

---

## 6. Como responder

Responda por número (ex.: "1.1 sim, cancelado também trava; 1.2 abre pra staff").
O que virar trabalho vira task no backlog; o que for decisão registrada vai para o
doc "Decisões v1" (`backlog doc list --plain`), que é a fonte de verdade das
regras do produto.
