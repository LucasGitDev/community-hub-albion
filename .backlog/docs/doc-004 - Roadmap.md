---
id: doc-004
title: Roadmap
type: other
created_date: '2026-09-15 02:46'
updated_date: '2026-09-15 03:22'
---
Status: **aprovado** (grill R1–R3, 2026-09-15). Cada fase = milestone no Backlog.md. Decisões detalhadas: doc "Decisões v1".
Critério de corte: v1 faz uma coisa — **eventos de Albion com prata dividida por presença**.

## v1

### F0 — Fundação
- Nest + Necord (bot conecta, `/ping`), Vite + React + Tailwind + shadcn, Nest serve SPA.
- `packages/db` (Drizzle + migrations), `packages/shared`.
- Docker multi-stage + compose (app + Postgres). Lint, typecheck, test via Turbo.
- GitHub privado + Actions (lint, typecheck, test, build imagem).
- **Pronto quando:** um container sobe bot + API + SPA; CI verde.

### F1 — Auth + RBAC
- Discord OAuth2, checagem de membro do `GUILD_ID`, sessão.
- Papéis `member`, `caller`, `staff`, `admin` com permissões granulares (seed em código). CASL em `shared`, guard Nest, gate no front.

### F2 — Entrada de membros
- Registro de nick → fila de aprovação staff (painel + botão embed).
- Aprovado: bot muda apelido + dá cargo "Membro". Troca de nick: fica pendente, mantém acesso e apelido antigo até aprovar.
- Validação opcional do nick via API Albion (`ALBION_REGION`), não bloqueante.

### F3 — Voice sessions
- Sessões join/leave/move persistidas; heartbeat 1 min; no boot fecha abertas no último heartbeat e reabre pelo estado atual.

### F4 — Templates + Eventos
- Catálogo global de roles; template define roles + vagas.
- Só `caller` cria evento; `owner` único transferível por staff.
- Estados `draft → open → closed → running → finished` (+ `cancelled` antes de `finished`).
- Inscrição por botões de role no embed; role lotada → lista de espera; caller move entre role/espera.
- `start` (comando, painel ou embed — mesmo serviço) fecha inscrições, cria canal na categoria configurada, arrasta inscritos confirmados que estão em "Aguardando Evento". `finish` devolve pra "Aguardando Evento" e apaga canal.
- Cancelar: antes de running marca inscrições; em running devolve pessoas, apaga canal, fecha sessões. Cancelado não aceita split.

### F5 — Loot split + Prata + Saque
- Ledger append-only (`bigint`, prata inteira), correção só por estorno, saldo pode ficar negativo.
- N splits por evento. Draft proporcional ao tempo no canal do evento entre start e finish; não inscrito entra com 0%. Staff edita %; confirmar bloqueado se ≠ 100%. Sobra de arredondamento de cada split → `owner`.
- Confirmar: `event:distribute` ou owner.
- Saque (membro no painel): mínimo configurável (default 1M), sem taxa. `pending` reserva saldo → `approved` lança débito / `rejected` libera → `settled` manual com `settled_by` + nota.
- Painel do membro: saldo, extrato, pedir saque.

**Marco v1 = F0–F5.**

## Pós-v1
Moeda temática + taxa de entrada + loja (juntas, pra ter sink) · cargos de ping opt-in (usar Onboarding nativo do Discord até lá) · canal de voz temporário com dono · streak · ranking mensal · giveaway · indicação.

## Fora do radar
Realtime, cosméticos na loja, jackpot, teto/decaimento de moeda, buffs/recuperação de streak, evento beneficente, multi-guild, i18n, upload de comprovante de saque.
