---
id: doc-004
title: Roadmap
type: other
created_date: '2026-09-15 02:46'
updated_date: '2026-09-15 02:46'
---

Status: rascunho, aguardando aprovação. Cada fase vira milestone + tasks no Backlog.md.
Critério de corte: entregar valor pro servidor o quanto antes; tudo que não bloqueia uso real fica pra depois.

## MVP (ordem de entrega)

### F0 — Fundação
- Nest + Necord (bot conecta, `/ping`), Vite + React + Tailwind + shadcn, Nest serve SPA.
- `packages/db` com Drizzle + migrations; `packages/shared`.
- Docker multi-stage + docker-compose (Postgres) local. Lint, typecheck, test no Turbo.
- **Pronto quando:** `docker run` sobe bot + API + SPA num processo.

### F1 — Auth + RBAC
- Discord OAuth2, checagem de membro do servidor, sessão.
- Tabelas users/roles/permissions; abilities CASL em `shared`, guard no Nest, gate no front.
- Skills: `security-review`, `emil-design-eng`.

### F2 — Entrada de membros
- Registro de nick in-game → fila de aprovação staff (painel + botão embed).
- Cargos de ping opt-in (select menu no Discord).
- Skills: `revenue-centric-design` (activation).

### F3 — Voice
- Voice sessions (join/leave/move) persistidas; fechar sessões órfãs no boot.
- Canal temporário com dono (controle total).

### F4 — Templates + Eventos
- CRUD template no painel (faixa de valor por role, taxa de entrada).
- Criar evento, inscrição, canal de voz do evento, iniciar (serviço único: comando/painel/embed), fechar e travar valores.
- Participação calculada via voice sessions.

### F5 — Ledger + Moeda temática
- Ledger append-only, estorno, saldo derivado.
- Crédito por participação no fechamento do evento; débito de taxa de entrada.
- Extrato no painel e `/saldo` no Discord.
- Skills: `security-review`.

### F6 — Loot split + Prata + Saque
- Draft proporcional ao tempo → staff ajusta % → confirmar → lançamentos.
- Saque: pending → approved/rejected → settled.
- Skills: `security-review`.

**Marco v1 = F0–F6.** Servidor já roda eventos pagos com prata.

## Pós-v1 (engajamento)
- F7 Streak (dia pingado, bônus em marco, zera ao faltar).
- F8 Ranking mensal (4 rankings, premiação top 10 participação, cargo temporário, histórico).
- F9 Loja (itens, estoque opcional, fila de fulfillment).
- F10 Giveaway (bilhete valor fixo).
- F11 Indicação (link, bônus na ativação, teto 10/mês, estorno por fraude).
- Skills: `revenue-centric-design`, `animate` (feedback de recompensa).

## Fora da v1
Realtime, cosméticos/cargos na loja, jackpot, teto/decaimento de moeda, buffs de streak, recuperar streak pago, evento beneficente (reavaliar após F9).

## Decisões pendentes antes de F4/F5
- Valores de moeda por tipo (começar DG grupo e Raid do Dragão).
- Participação mínima (tempo) pra contar crédito de evento?
- Nome final do projeto.
