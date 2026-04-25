# TWF Panel

Web panel for managing Twitch accounts and tracking channel-points activity.

- **Backend:** Node.js 20 + Fastify + Prisma + Postgres + Redis + BullMQ
- **Frontend:** React 18 + Vite + Tailwind + shadcn/ui + TanStack Query + Recharts
- **Deploy:** single `docker compose up -d` on Ubuntu

See [DEPLOY.md](./DEPLOY.md) for full Ubuntu deployment instructions.

## One-command install (Ubuntu 22.04 / 24.04)

```bash
curl -fsSL https://raw.githubusercontent.com/Litersy/Twitch-Point-Miner/main/install.sh | bash
```

Скрипт ставит Docker, клонит репу в `/opt/twf-panel`, генерирует `.env` (рандомные секреты), поднимает compose. По умолчанию логин — `admin / admin`, порт — `8080`. Повторный запуск = обновление.

## Quick start (local)

```bash
cp .env.example .env
# по желанию — поправить ADMIN_PASSWORD
# секреты можно сгенерить:
#   sed -i "s/^APP_JWT_SECRET=.*/APP_JWT_SECRET=$(openssl rand -hex 32)/" .env
#   sed -i "s/^APP_ENCRYPTION_KEY=.*/APP_ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
docker compose up -d --build
# панель: http://localhost:8080
```

Default admin login is set via `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` (first start only).

## Features

- Single-user authentication (JWT, bcrypt), protected API routes
- Manage Twitch accounts — add/delete, support for `auth_token` or `login+password`, encrypted at rest (AES-256-GCM)
- Group accounts (many-to-many tags)
- Manage streamers — add manually, import from followed list, live online/offline + viewer count
- Statistics — points per account / per streamer / total, history by day/week/month, charts
- Activity tracking — watch minutes per streamer
- Action logs with filters
- Automation toggles (make predictions, claim drops, claim moments, follow raid, watch streak)
- Modern SaaS-style UI, responsive, RU/EN i18n
- Rate limiting, zod validation, helmet

## Project layout

```
twf-panel/
├── backend/              # Fastify API + miner worker
│   ├── src/
│   │   ├── modules/      # auth, accounts, streamers, groups, stats, automation, logs
│   │   ├── miner/        # Twitch GQL + PubSub client, per-account session
│   │   ├── plugins/      # fastify plugins (auth, prisma, etc.)
│   │   └── lib/          # crypto, env, logger
│   ├── prisma/
│   │   └── schema.prisma
│   └── Dockerfile
├── frontend/             # Vite + React SPA
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── i18n/         # RU/EN translations
│   │   └── lib/          # api client, utils
│   └── Dockerfile
├── docker/
│   └── nginx/            # nginx config
├── docker-compose.yml
├── .env.example
├── DEPLOY.md
└── README.md
```
