---
id: doc-005
title: Decisões v1
type: specification
created_date: '2026-09-15 03:22'
updated_date: '2026-09-16 14:29'
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
| Q26 | Estados draft→open→closed→running→finished (+cancelled). Inscrição fecha manual ou no horário; `start` fecha. Cancelar em running devolve pessoas, apaga canal, fecha sessões; cancelado não aceita split; split confirmado impede cancelar. |
| Q27 | Inscrição por botões de role; lotou → lista de espera; caller move. |
| Q28 | Canal por evento criado no start (categoria configurada), apagado no finish. "Aguardando Evento" = canal fixo em config. |
| Q29 | Start arrasta só inscritos confirmados que estão em "Aguardando Evento". |
| Q30 | Heartbeat 1 min; boot fecha sessões abertas no último heartbeat e reabre pelo estado atual. |

## Prata e saque

| # | Decisão |
|---|---|
| Taxa do split | Taxa configurável **por evento** (herda default do template, editável pelo caller/dono até confirmar o split). Aplicada antes da divisão entre participantes (2026-09-16). |
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
