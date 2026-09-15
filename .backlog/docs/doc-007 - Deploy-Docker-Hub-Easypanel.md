---
id: doc-007
title: Deploy (Docker Hub + Easypanel)
type: guide
created_date: '2026-09-15 12:56'
updated_date: '2026-09-15 12:56'
---
Deploy de produção: **GitHub Actions → Docker Hub → Easypanel**.

## Pipeline
1. PR: quality gate completo (não publica).
2. Push na `main`: gate completo → se `summary` verde, job `publish` faz build `linux/amd64` e push para o Docker Hub com tags `latest` e `sha-<commit>`.
3. Opcional: se o secret `EASYPANEL_DEPLOY_WEBHOOK` existir, o job chama o webhook e o Easypanel redeploya.

## Configuração no GitHub (Settings > Secrets and variables > Actions)
| Tipo | Nome | Valor |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | usuário do Docker Hub |
| Secret | `DOCKERHUB_TOKEN` | Access Token do Docker Hub (Read & Write) |
| Variable | `DOCKERHUB_IMAGE` | `usuario/albion-hub` |
| Secret (opcional) | `EASYPANEL_DEPLOY_WEBHOOK` | URL do Deploy Webhook do serviço no Easypanel |

Sem os obrigatórios, o job `publish` falha com mensagem dizendo o que falta.

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

Nunca definir `AUTH_DEV_LOGIN` em produção (a app recusa subir).

### Discord
- Redirect OAuth2: `<PUBLIC_URL>/api/auth/discord/callback`.
- Convite do bot com escopos `bot` + `applications.commands` e permissões: Ver canais, Enviar mensagens, Inserir links, Conectar, Mover membros, Gerenciar apelidos, Gerenciar cargos (bitfield `420498432`). O cargo do bot precisa ficar acima do cargo Membro.
