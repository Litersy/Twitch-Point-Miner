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

## Download (Local Version)

These are direct download links for the **local version** of **TPF Panel**:

* **Installer (recommended)**
  https://github.com/Litersy/Twitch-Point-Miner/releases/download/v0.1.0/TPM.Panel.Setup.0.1.0.Win64.exe

* **Portable version (no installation required)**
  https://github.com/Litersy/Twitch-Point-Miner/releases/download/v0.1.0/TPM-Panel-portable-0.1.0.exe

## Notes

* These builds are designed to run **locally on your PC/server**.
* The installer version provides a smoother setup experience and automatic configuration.
* The portable version can be launched instantly without installation.
* On first launch, default admin credentials are set via `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

Choose the version that fits your workflow and run the panel locally.


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
