---
id: doc-005
title: Decisões v1
type: specification
created_date: '2026-09-15 03:22'
updated_date: '2026-09-17 18:40'
---
Resultado do grill (R1–R3, 2026-09-15). Referência pra specs e tasks.

## Produto
| # | Decisão |
|---|---|
| Q1 | v1 enxuta: fundação, auth, nick, voice, eventos, loot split/saque. Moeda temática, cargos ping e canal temp pós-v1 (moeda sem sink = inflação sem valor). |
| Q2 | Nome no código/infra: `albion-hub`. Nome público do bot separado. |
| Q3 | Painel pra todos. Membro comum: login, saldo/extrato, pedir saque. |
| Q4 | Single-guild, `GUILD_ID` em env. |
| Q18 | UI e bot só PT-BR, sem i18n. Código, commits, tabelas em inglês. |

## Eventos e voice
| # | Decisão |
|---|---|
| Q5 | Sem presença mínima pra prata (split já é proporcional). |
| Q6 | Janela de presença = start→finish, só no canal do evento. |
| Q7 | Presente não inscrito entra no draft marcado, 0% default. |
| Q8 | Roles por template, a partir de catálogo global. |
| Q9 | Só callers oficiais criam evento na v1. |
| Q21 | `owner` único por evento, transferível por staff; recebe sobras. |
| Q26 | Estados draft→open→closed→running→finished→**archived** (+cancelled). `finished` encerra o jogo mas ainda permite editar dados, taxa e splits; `archived` é o estado final de fato e bloqueia edição (revisado 2026-09-16). Inscrição fecha manual ou no horário; `start` fecha. Cancelar em running devolve pessoas, apaga canal, fecha sessões; cancelado não aceita split; split confirmado impede cancelar. |
| Q27 | Inscrição por botões de role; lotou → lista de espera; caller move. |
| Q28 | Canal por evento criado no start (categoria configurada), apagado no finish. "Aguardando Evento" = canal fixo em config. |
| Q29 | Start arrasta só inscritos confirmados que estão em "Aguardando Evento". |
| Q30 | Heartbeat 1 min; boot fecha sessões abertas no último heartbeat e reabre pelo estado atual. |

## Prata e saque

| # | Decisão |
|---|---|
| Taxa do split | Taxa configurável **por evento**, em **porcentagem ou valor fixo** (herda default do template, editável pelo caller/dono até confirmar o split, **sem teto**). Aplicada antes da divisão; o valor retido vai **para o caller/dono** por enquanto (caixa da comunidade fica para depois). Decidido 2026-09-16. |
| # | Decisão |
|---|---|
| Q10 | Tesouraria da comunidade guarda a prata in-game; saldo no sistema = dívida com o membro; saque = staff transfere in-game. |
| Q11 | `settled` manual com `settled_by` + nota. |
| Q12 | **Sem saque mínimo** e sem taxa de saque (revisado 2026-09-16; antes: mínimo 1M). |
| Q20 | Prata inteira em `bigint`; UI formata. |
| Q22 | Confirmar split bloqueado se soma ≠ 100%. |
| Q23 | N splits por evento; cada um fecha 100%. Sobra é rara; quando houver, fica com o caller/dono do evento (confirmado 2026-09-16). |
| Q24 | Saldo negativo permitido (estorno pós-saque); bloqueia novo saque; lançamento nunca editado/apagado. |
| Q25 | `pending` reserva saldo; débito no ledger no `approved`; `rejected` libera. |

## Auth e entrada
| # | Decisão |
|---|---|
| Q13 | Papéis `member`, `caller`, `staff`, `admin`; permissões granulares seed em código na v1. |
| Q14 | Entrada = nick + aprovação staff; validação via API Albion é ajuda, não bloqueio. |
| Q31 | Aprovação muda apelido + garante cargo "Membro" (toda aprovação, inclusive troca — revisado 2026-09-15). Troca de nick: pendente, mantém acesso e apelido antigo até aprovar. Registro/troca também por slash command do bot, sem precisar do painel. |

## Infra
| # | Decisão |
|---|---|
| Q16 | VPS própria + docker compose (app + Postgres). |
| Q17 | GitHub privado + Actions desde F0. |

## Pendentes (não bloqueiam)
- Q15: servidor Albion → `ALBION_REGION` em env; confirmar com staff. Bloqueia só validação opcional de nick.
- Q16: proxy/orquestrador da VPS → rodar `docker ps --format '{{.Names}}\t{{.Image}}'` antes do deploy.

## Grelha de 2026-09-16 (pendências do usuário)
| # | Decisão |
|---|---|
| G1 | Evento `cancelled` **continua editável** pela API (só `archived` trava). Sem exploit, sem valor em travar. |
| G2 | Nick **único**: edição recusa nick já usado por outro membro. |
| G3 | Staff alcança a gestão de usuários (buscar nick, editar nick/tag, ler e escrever notas). `/admin/papeis` segue só admin. Provisório até TASK-052. |
| G4 | Semear prata pelo dev-login **fica** (mesmo portão `AUTH_DEV_LOGIN`, proibido em produção pelo env). |
| G5 | **Rotas de manutenção** (TASK-048) atrás de guard de header com token do env, sem sessão, válidas em dev e produção: ajuste de prata (`adjustment` com motivo), revalidação de nick, disparo da limpeza. **Não** permitem agir como outro usuário em produção. |
| G6 | Sessão de 30 dias mantida; quem saiu da guilda é removido pela **limpeza diária** (TASK-049): sessões e papéis caem, conta vira inativa. **Saldo e ledger nunca são tocados.** |
| G7 | `BOOTSTRAP_ADMIN_DISCORD_IDS` é semente: tirar id do env **não** revoga admin; revogação é manual pela tela de papéis. |
| G8 | Staff **pode** aprovar o próprio nick. |
| G9 | **Banimento** (TASK-050): corta acesso na hora (login, inscrição pelo embed, cargo Membro), **não** expulsa do Discord, soft delete com motivo/autor/data e desbanir, nick segue ocupado, **saldo congelado** (não zera, não saca, saque pendente não é aprovado). Staff e admin banem — provisório até TASK-052. |
| G10 | Staff e admin **leem o extrato** de qualquer jogador (TASK-051); ajuste de prata só pelo namespace de manutenção. |
| G11 | `main` protegida por ruleset do GitHub (PR + check `summary`, sem push forçado, sem deleção, sem exceção). |
| G12 | **Saque sem mínimo** confirmado. Plano B, se a fila entupir: um pedido pendente por membro — nunca ressuscitar o mínimo. |
| G13 | UI: descrição da role não entra no formulário de criação (criar é em lote, descrever é reflexivo); perfil mostra saldo disponível **e** reservado. |

## Grelha de 2026-09-17 (leva 047-051)
| # | Decisão |
|---|---|
| N1 | Ajuste da manutenção **não** ganha usuário de sistema no banco: autoria fica na origem `manual/maintenance`, no motivo e na nota do perfil. Usuário de sistema seria entidade a proteger sem ganho. |
| N2 | **Staff não bane staff nem admin** (confirmado): impede conta de staff comprometida de derrubar todos os admins. Staff bane member e caller. |
| N3 | Membro **vê o autor** do ajuste no próprio extrato lido pela rota de staff. Prata é dele; motivo sem responsável gera desconfiança. Autoria de terceiros continua fora. |
| N4 | Quem sai e volta ao servidor **não recupera papéis** automaticamente: reconceder é ato de alguém. Evita que sair-e-voltar vire caminho de recuperação de acesso. |
| N5 | "Papéis" na limpeza = `user_roles` (RBAC), não cargo do Discord. |
| N6 | Filtro "Saiu do servidor" **fica para depois**, junto com uma passada em todos os filtros da lista de membros (TASK-053). Hoje só o selo. |
| N7 | Mudança apenas de **visibilidade** não exige as skills de design; exige **revisão visual por screenshot no papel afetado**. Ritual não pega bug; olhar a tela no papel novo pega. |


## Grelha de 2026-09-17 (F6 — Buffunfa, taxa de entrada e loja)

Antecede a F6 do doc "Roadmap pós-v1". Nomes e cores já vinham decididos no doc "Identidade:
Toca da Turma e Buffunfa"; aqui ficam as regras de economia e de fila.

### Moeda no ledger
| # | Decisão |
|---|---|
| F6-1 | Buffunfa entra na **mesma** `ledger_entries`, com coluna `currency` (`silver` \| `buffunfa`). Tabela separada duplicaria triggers, estorno e telas. Risco assumido: query que esquecer o filtro soma moedas diferentes — por isso saldo e extrato passam a exigir moeda explícita na assinatura. |
| F6-2 | A coluna nasce `NOT NULL DEFAULT 'silver'` **e o default cai na mesma migration**. Não é preferência: as triggers append-only (`0011_nosy_leopardon.sql:25-33`) recusam UPDATE, então backfill é impossível — o default na criação é o único caminho, e derrubá-lo em seguida devolve a proteção contra insert sem moeda. |
| F6-3 | Índice novo de extrato com `currency` antes de `created_at`. O atual (`user_id, created_at, id`) faria toda leitura varrer as duas moedas. |
| F6-4 | `formatSilver`/`<Silver>` viram **genéricos** (`formatAmount`/`<Amount currency>`). Motivo é identidade, não código: "prata prateada, Buffunfa dourada com emoji" precisa morar num lugar só. |
| F6-5 | **Buffunfa nunca abrevia**: `340 BUF`, nunca `0,3K`. Ganhos são de unidade/dezena, gastos chegam a milhares — o valor cheio cabe. Prata continua abreviando. |
| F6-6 | **Sem saque** de Buffunfa. **Com** ajuste da staff, por `/api/maintenance/buffunfa`, mesmo guard de token da prata — sem ele, erro de taxa não tem conserto, e o ledger é append-only. |
| F6-7 | Saldo **nunca fica negativo** por compra ou taxa (recusa na transação, com `FOR UPDATE`, igual ao saque). Exceção única: **ajuste/estorno da staff pode cravar negativo** — quem ganhou por engano e já gastou precisa poder ficar devendo. |

### Ganho por evento
| # | Decisão |
|---|---|
| F6-8 | Valor **por role**, faixa **obrigatória** no template (não pode ser aberta), caller ajusta dentro dela até o fechamento. Serve para forçar o preenchimento de vaga escassa: faltam tanks, o caller sobe tank. Faixa obrigatória porque Buffunfa é criada do nada — caller generoso demais fura o sink e o ledger não volta atrás. |
| F6-9 | **Vale o valor do fechamento, para todos daquela role**, inclusive quem se inscreveu antes da subida. Pagar menos a quem se comprometeu cedo ensinaria a esperar o preço subir. |
| F6-10 | Recebe quem teve **presença ≥ 90% do tempo de vida da call** (mesmo relógio que a prata já usa). Regra **binária**: bateu os 90%, recebe o valor cheio. Proporcional em número de uma casa vira "2,7" e arredonda para nada — a prata é divisão de bolo, a Buffunfa é prêmio de comparecimento. |
| F6-11 | Evento **sem canal de voz carimbado** (`presence_channel_id` nulo) **não paga Buffunfa**, e a tela de fechamento avisa. Sem medição não há comparecimento provado. |

### Taxa de entrada
| # | Decisão |
|---|---|
| F6-12 | Cobrada em **Buffunfa**, nunca em prata. Em prata viraria barreira de dinheiro contra o membro novo, que é justamente quem tem pouca prata. |
| F6-13 | Cobrada **na inscrição**. Desistir **antes do início devolve**; depois do início, não. É o único desenho que filtra de verdade (inscrever-se de graça mantém a lista inflada) sem punir quem avisa cedo. |
| F6-14 | **Evento cancelado devolve a todos**, automático, por estorno apontando para o lançamento da taxa. |
| F6-15 | Um evento **pode cobrar e pagar**, em lançamentos separados no extrato (`−20` na inscrição, `+15` no fechamento). O líquido negativo é o ponto: é o que faz o conteúdo disputado ser disputado. Juntar num lançamento só esconderia do membro o que ele pagou. |
| F6-16 | **Sink puro**: a Buffunfa cobrada some, não vai para ninguém. É o que a diferencia da taxa do split, que vai para o caller/dono. |

### Loja
| # | Decisão |
|---|---|
| F6-17 | Item de **texto livre** (nome, descrição, preço, estoque opcional) — não catálogo tipado. Categorias tipadas na F6 seriam adivinhação; três meses de uso dizem quais existem. Itens previstos: itens do jogo, ping/criação de evento, beneficente. |
| F6-18 | Item **esgotado aparece cinza**, não some. Sumir esconde o que existe e faz o item voltar como novidade. Aparecer esgotado cria fila de espera — é o que sustenta gasto de milhares com ganho de dezenas. |
| F6-19 | Estorno de compra devolve **moeda e estoque, sempre na mesma transação**. Separar os dois faz item sumir do estoque sem ninguém receber. |
| F6-20 | Cargos e cosméticos seguem **mapeados, não automatizados** (decisão da v1). "Ping comprado com Buffunfa" fica para a F7, junto das permissões — construir um caminho paralelo agora seria construir duas vezes. |

### Fila de pedidos
| # | Decisão |
|---|---|
| F6-21 | Estados: `pending → claimed → delivered`, mais `cancelled` (comprador) e `rejected` (staff). **Sem confirmação do comprador e sem disputa** — a staff é confiável, e exigir clique do comprador encheria a fila de pedidos eternamente abertos. |
| F6-22 | `claimed` existe para a staff sinalizar "peguei este" antes de entrar no jogo: sem ele, dois membros da staff entregam o mesmo item. **`claimed` volta para `pending`** se ela desistir — o membro não pode ficar preso a um staff que sumiu. |
| F6-23 | Buffunfa **reservada** em `pending` (fora do ledger) e **lançada** em `delivered`. Mesmo desenho da fila de saques, incluindo `RESERVING_*`, trava por usuário e revalidação dentro da transação. |
| F6-24 | O comprador **cancela enquanto estiver `pending`**; depois de `claimed`, só a staff. Sem isso, clique errado vira ticket, e a fila manual já é o gargalo da fase. |

### Permissões e UI
| # | Decisão |
|---|---|
| F6-25 | `shop:manage` (publicar item, definir preço) e `shop:fulfill` (entregar pedido) ficam **no bloco `staff`**, provisórios, com os nomes já registrados para a F7. Ter a lista pronta é o motivo de a F7 ter sido adiada para depois da loja. |
| F6-26 | Chip do header mostra **as duas moedas**, Buffunfa em destaque. Buffunfa só visível dentro da loja seria invisível até o membro já ter decidido comprar — ver o número subir é o que faz voltar ao evento. |
| F6-27 | **Um** extrato, com filtro por moeda (default "todas"), cada linha marcando a moeda e o cabeçalho trazendo **os dois saldos separados, nunca somados**. A ordem cronológica é que conta a história. |
| F6-28 | Emoji: o **bot tenta criar** no boot a partir do PNG versionado, procurando por nome. Falhou (permissão, slot cheio), loga aviso e segue com `340 BUF`; o usuário cria à mão e põe a env. Precedência: **env > descoberto > texto puro**. Bot não sobe por causa de emoji é inaceitável. |
| F6-29 | A **inversão de cores** (dourado = Buffunfa, âmbar = CTA, prata = prateada) é a **primeira** task da fase, antes de qualquer tela nova: as telas novas nascem certas, e o diff isolado é revisável por screenshot (N7), o que um diff misturado com feature não seria. |

### Fora da F6 (registrado para não voltar como novidade)
Transações entre jogadores (traz lavagem de taxa de entrada e precisa de limite e rastro próprios),
ping comprado com Buffunfa (vai com a F7), automação de cargo do Discord.

### Decisões tomadas durante a TASK-056 (não vieram da grelha)
| # | Decisão |
|---|---|
| F6-30 | **Prata é abreviada no chip do header** (`1,9M`); Buffunfa continua por extenso (F6-5). Não é estética: com as duas moedas por extenso o chip estourava o header em 400px e derrubava dois e2e mobile — elementos ficavam inclicáveis em `/eventos`. O valor exato da prata está a um clique, na Carteira. |
| F6-31 | Os dois saldos viajam no `/api/me/withdrawals` (campo `balances`), sem rota nova: é a chamada que o painel já repete no polling, então o chip do header não custa uma segunda ida ao servidor. |
| F6-32 | O filtro de moeda do extrato vale **só para a tabela**. Os números do topo leem sempre a lista cronológica completa — senão o saldo sumiria da tela só porque alguém filtrou por Buffunfa. Custa uma segunda request apenas quando há filtro ativo. |
| F6-33 | `spendCurrency` (débito com `for update` + releitura na transação) nasceu na TASK-056 **sem consumidor**: é a porta que a taxa de entrada (058) e a loja (059) vão usar, e sem ela o critério de "nunca fica negativo" não teria como ser provado. |
| F6-34 | O seed do dev-login passou de `silver` para `ledger` (com `currency`), e o extrato lido pela staff também mostra os dois saldos, já que a tabela ganhou a coluna Moeda. |
| F6-35 | `BUFFUNFA_EMOJI_FILE` é env com default apontando para `assets/` do repo (mesmo padrão do `WEB_DIST_DIR`), e o Dockerfile passou a copiar `assets/`. Sem isso o bot não teria o PNG dentro da imagem para criar o emoji (F6-28). |

**Bug encontrado e corrigido no caminho:** "Ganhos no mês" e "Último split" da Carteira somavam o extrato inteiro e passaram a incluir Buffunfa no instante em que ela existiu. É exatamente o esquecimento que a F6-1 previu ao assumir o risco da tabela única — apareceu no primeiro dia, e é por isso que saldo e extrato passaram a exigir moeda explícita na assinatura (F6-3).

### Decisões tomadas durante a TASK-059 (loja)
| # | Decisão |
|---|---|
| F6-36 | **Um pedido = uma unidade**, sem coluna de quantidade. Quantidade obrigaria decidir cancelamento parcial (devolver 2 de 3?), que ninguém pediu. Comprar duas vezes resolve o caso real. |
| F6-37 | A loja **não tem coluna de moeda**: `SHOP_CURRENCY` é constante (Buffunfa). Loja aceitando prata competiria com o saque, que é a única saída de valor real do sistema. |
| F6-38 | **Nome e preço ficam congelados no pedido**, e item **nunca é apagado** — despublicar é o caminho, porque os pedidos antigos apontam para ele. Preço que muda depois não reescreve o que alguém já comprou. |
| F6-39 | A compra **não passa pelo `spendCurrency`**: aquela porta é do débito, e na loja o débito é da entrega (F6-23). A compra reserva; o lançamento nasce em `delivered`. |
| F6-40 | Trava sempre na ordem **usuário → item**. Ordem fixa evita deadlock entre dois compradores do mesmo item e de itens diferentes ao mesmo tempo. |
| F6-41 | **Teto de preço de 1e9 BUF**, com 400 explicado. Origem: o `security-review` apontou que preço acima do `int8` virava 500 mudo. Não é regra de economia, é limite de tipo. |

**Contrato que a TASK-060 consome:** `shop_orders.status = 'reserved'` — Buffunfa reservada (soma dos `reserved` em `getShopBalance`) e estoque já decrementado. Transições em `ALLOWED_SHOP_ORDER_TRANSITIONS` (`reserved → delivered | cancelled`), com checks no banco: `ledger_entry_id` not null **se e somente se** `delivered`; `handled_by`/`handled_at` sempre juntos e nunca em `reserved`; nota obrigatória no cancelamento. O kind `purchase` e o reference_type `shop_order` já existem no ledger sem consumidor — mesmo precedente do `spendCurrency` (F6-33).
