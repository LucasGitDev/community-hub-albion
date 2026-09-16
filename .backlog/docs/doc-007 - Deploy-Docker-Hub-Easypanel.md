---
id: doc-007
title: Deploy (Docker Hub + Easypanel)
type: guide
created_date: '2026-09-15 12:56'
updated_date: '2026-09-16 01:36'
---
Deploy de produção: **GitHub Actions → Docker Hub → Easypanel**.

## Pipeline
1. PR: workflow `quality-gate` (não publica).
2. PR mergeado = push na `main`: roda `quality-gate`.
3. Gate verde → workflow `deploy` (`workflow_run`): checkout do commit aprovado, build `linux/amd64`, push `latest` + `sha-<commit>` no Docker Hub, chama o webhook do Easypanel.
4. Manual: Actions > deploy > Run workflow (publica a `main` atual).

Gate vermelho na `main` não publica nada.

## Configuração no GitHub (Settings > Secrets and variables > Actions)
| Tipo | Nome | Valor |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | usuário do Docker Hub |
| Secret | `DOCKERHUB_TOKEN` | Access Token do Docker Hub (Read & Write) |
| Secret | `EASYPANEL_DEPLOY_WEBHOOK` | URL do Deploy Webhook do serviço no Easypanel (sem ele, só publica a imagem) |
| Variable (opcional) | `DOCKERHUB_IMAGE` | padrão `<DOCKERHUB_USERNAME>/albion-hub` |

## Easypanel
- **Postgres**: serviço Postgres 17 do Easypanel; usar a URL interna em `DATABASE_URL`.
- **App**: serviço do tipo imagem Docker `usuario/albion-hub:latest`, porta interna `3000`, domínio com HTTPS.
- **Healthcheck**: `GET /api/health` (200 ok; 503 quando o banco cai).
- **Migrations**: aplicadas no boot (`RUN_MIGRATIONS=true`, padrão da imagem).

### Variáveis do app
| Variável | Exemplo / nota |
|---|---|
| `DATABASE_URL` | URL interna do Postgres do Easypanel |
| `DISCORD_TOKEN` | token do bot |
| `GUILD_ID` | ID do servidor |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | app OAuth2 |
| `PUBLIC_URL` | `https://dominio-do-painel` (https obrigatório em produção) |
| `BOOTSTRAP_ADMIN_DISCORD_IDS` | IDs Discord dos primeiros admins |
| `SESSION_TTL_DAYS` | `30` |
| `ALBION_REGION` | `americas` (TASK-016) |
| `DISCORD_MEMBER_ROLE_ID` | `1547413631627698327` (TASK-014) |
| `DISCORD_STAFF_CHANNEL_ID` | `1549401951924650025` (TASK-015) |
| `DISCORD_EVENTS_CHANNEL_ID` | canal onde o bot publica o embed de inscrição dos eventos (TASK-022) |

Nunca definir `AUTH_DEV_LOGIN` em produção (a app recusa subir).

### Discord
- Redirect OAuth2: `<PUBLIC_URL>/api/auth/discord/callback`.
- Convite do bot com escopos `bot` + `applications.commands` e permissões: Ver canais, Enviar mensagens, Inserir links, Conectar, Mover membros, Gerenciar apelidos, Gerenciar cargos (bitfield `420498432`). O cargo do bot precisa ficar acima do cargo Membro.
