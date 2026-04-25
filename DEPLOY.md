# Deploy on Ubuntu (22.04 / 24.04)

## Установка одной командой

На чистом VPS под root или sudo-юзером:

```bash
curl -fsSL https://raw.githubusercontent.com/Litersy/Twitch-Point-Miner/main/install.sh | bash
```

Скрипт:
- ставит Docker и docker-compose-plugin (если их нет);
- клонит репу в `/opt/twf-panel`;
- генерирует `.env` с рандомными секретами и дефолтным админом `admin / admin`;
- билдит и поднимает все контейнеры;
- открывает порт в `ufw` (если активен).

После 3–5 минут билда панель доступна по `http://<IP-сервера>:8080`.
**Логин/пароль по умолчанию: `admin` / `admin`** — поменяй сразу через UI → Настройки.

## Параметры

Переопределяются перед `bash`:

```bash
curl -fsSL .../install.sh | PUBLIC_PORT=80 ADMIN_PASSWORD='myStrong1!' bash
```

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PUBLIC_PORT` | `8080` | внешний порт nginx |
| `ADMIN_USERNAME` | `admin` | логин админа на первый старт |
| `ADMIN_PASSWORD` | `admin` | пароль админа на первый старт |
| `POSTGRES_PASSWORD` | случайный | пароль Postgres |
| `INSTALL_DIR` | `/opt/twf-panel` | куда клонировать |
| `BRANCH` | `main` | ветка |
| `REPO_URL` | `https://github.com/Litersy/Twitch-Point-Miner.git` | свой форк |

`APP_JWT_SECRET` и `APP_ENCRYPTION_KEY` всегда генерируются автоматически (`openssl rand -hex 32`).
**Не теряй `.env`** — без `APP_ENCRYPTION_KEY` сохранённые Twitch-токены не расшифровать.

## Обновление

Тот же скрипт идемпотентен — повторный запуск делает `git pull` + `docker compose up -d --build`:

```bash
curl -fsSL https://raw.githubusercontent.com/Litersy/Twitch-Point-Miner/main/install.sh | bash
# или из каталога
cd /opt/twf-panel && bash install.sh
```

## Полезные команды

```bash
cd /opt/twf-panel

docker compose ps
docker compose logs -f backend worker
docker compose restart worker

# войти в БД
docker compose exec postgres psql -U twf twf

# полный сброс (УДАЛИТ ДАННЫЕ)
docker compose down -v
```

## Бэкап

```bash
cd /opt/twf-panel
docker compose exec -T postgres pg_dump -U twf twf | gzip > backup-$(date +%F).sql.gz
```

Восстановление:

```bash
gunzip -c backup-2026-04-25.sql.gz | docker compose exec -T postgres psql -U twf twf
```

Cron раз в сутки:

```bash
sudo crontab -e
# 0 3 * * * cd /opt/twf-panel && docker compose exec -T postgres pg_dump -U twf twf | gzip > /opt/twf-panel/backups/db-$(date +\%F).sql.gz
```

## Сброс пароля админа

Если забыл пароль:

```bash
cd /opt/twf-panel
docker compose exec postgres psql -U twf twf -c 'DELETE FROM "User";'
docker compose restart backend
```

Бэкенд пересоздаст юзера из `ADMIN_USERNAME` / `ADMIN_PASSWORD` в `.env`.

## Траблшутинг

- **`401` на запросах** — JWT истёк (7 дней), перелогинься.
- **`status: error` на аккаунте** — глянь `lastError` в таблице или `docker compose logs worker`. Чаще всего: невалидный auth_token либо Twitch ротировал GQL persisted hashes.
- **Поинтов нет** — стример должен быть онлайн прямо сейчас; одновременно фармятся максимум 2 (по числу зрителей); первый watch-streak капает после ~5 мин просмотра.
- **`APP_ENCRYPTION_KEY must be 64 hex chars`** — неправильный ключ в `.env`, сгенерируй `openssl rand -hex 32`.

## (Опционально) HTTPS через Caddy

Если есть домен — заменить `nginx` в `docker-compose.yml` на:

```yaml
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports: ["80:80", "443:443"]
  volumes:
    - ./docker/Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data
  depends_on: [backend, frontend]
```

`Caddyfile`:

```
panel.example.com {
  handle /api/* { reverse_proxy backend:4000 }
  handle { reverse_proxy frontend:80 }
}
```

Caddy сам получит Let's Encrypt-сертификат.
