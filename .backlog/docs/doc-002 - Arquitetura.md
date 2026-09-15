---
id: doc-002
title: Arquitetura
type: specification
created_date: '2026-09-15 02:46'
updated_date: '2026-09-15 02:46'
---

```
apps/
  server/   NestJS + Necord. Bot Discord + API REST + serve apps/web/dist
  web/      Vite + React SPA, Tailwind, shadcn/ui
packages/
  db/       Drizzle schema + migrations (Postgres)
  shared/   tipos, zod schemas, abilities CASL
```

## Princípios
- Processo único: bot, API e SPA estática no mesmo Nest. Uma imagem Docker multi-stage.
- Módulos Nest por domínio: `auth`, `members`, `voice`, `events`, `templates`, `economy` (ledger), `loot-split`, `withdrawals`, `shop`, `streak`, `ranking`, `referral`, `giveaway`.
- Entradas (slash command, botão embed, painel HTTP) são adapters finos sobre services de domínio.
- Voice sessions: tabela única entrada/saída → base de estatística e participação em evento/loot split.
- Ledger: tabela única append-only, coluna `currency` (`theme` | `silver`). Correção só por estorno.
- Saque: tabela própria, só prata. `pending → approved|rejected → settled`.
- Templates: DB é fonte de verdade; YAML só import/export.
- Auth: Discord OAuth2 + checagem de membro do servidor. RBAC CASL próprio.
- Realtime: v1 polling.

Decisões registradas via `backlog decision create`.
