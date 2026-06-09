#!/usr/bin/env bash
# TPM Panel — однокомандная установка/обновление на чистом Ubuntu (22.04 / 24.04).
# Запуск:
#   curl -fsSL https://raw.githubusercontent.com/Litersy/Twitch-Point-Miner/main/install.sh | bash
# или с указанием своих параметров:
#   curl -fsSL .../install.sh | sudo PUBLIC_PORT=80 ADMIN_PASSWORD=secret bash
#
# Идемпотентно: повторный запуск = обновление (git pull + rebuild).

set -euo pipefail

# ---------- настройки (можно переопределить через env) ----------
REPO_URL="${REPO_URL:-https://github.com/Litersy/Twitch-Point-Miner.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/twf-panel}"
BRANCH="${BRANCH:-main}"

# ---------- утилиты ----------
log()  { printf '\033[1;36m[tpm]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[tpm]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[tpm]\033[0m %s\n' "$*" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else err "Нужен root или sudo"; fi
fi

# ---------- 1. зависимости ОС ----------
log "Проверяю системные пакеты (curl, git, openssl, ca-certificates)…"
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl git openssl ca-certificates
fi

# ---------- 2. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  log "Ставлю Docker через get.docker.com…"
  curl -fsSL https://get.docker.com | $SUDO sh
else
  log "Docker уже установлен: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  log "Ставлю плагин docker-compose…"
  $SUDO apt-get install -y docker-compose-plugin || true
fi

# Запустить и автостартить демона
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

# Группа docker для текущего юзера (для не-root запуска)
if [ -n "$SUDO" ] && ! id -nG "$USER" | grep -qw docker; then
  $SUDO usermod -aG docker "$USER" || true
  warn "Юзер $USER добавлен в группу docker — перелогинься в ssh, чтобы команды docker работали без sudo."
fi

# ---------- 3. Каталог + репозиторий ----------
$SUDO mkdir -p "$INSTALL_DIR"
$SUDO chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Каталог уже существует — git pull в $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --all --prune
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Клонирую $REPO_URL → $INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ---------- 4. .env (авто-генерация, если нет) ----------
if [ ! -f .env ]; then
  log "Генерирую .env (admin/admin, рандомные секреты)…"
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
  PUBLIC_PORT="${PUBLIC_PORT:-8080}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"
  APP_JWT_SECRET="$(openssl rand -hex 32)"
  APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"

  cat > .env <<EOF
NODE_ENV=production
APP_PORT=4000
APP_PUBLIC_URL=http://localhost:${PUBLIC_PORT}

APP_JWT_SECRET=${APP_JWT_SECRET}
APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

POSTGRES_USER=twf
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=twf

PUBLIC_PORT=${PUBLIC_PORT}
EOF
  chmod 600 .env
  log ".env создан. APP_ENCRYPTION_KEY сохранён внутри — НЕ ТЕРЯТЬ (без него токены аккаунтов нечитаемы)."
else
  log ".env уже есть — оставляю как есть."
fi

# ---------- 5. Билд + запуск ----------
log "Поднимаю docker compose (первый билд ~3–5 мин)…"
DC="docker compose"
if [ -n "$SUDO" ] && ! id -nG "$USER" | grep -qw docker; then
  DC="$SUDO docker compose"
fi
$DC pull || true
$DC up -d --build

# ---------- 6. UFW (если есть и активен) ----------
PUBLIC_PORT_VAL="$(grep -E '^PUBLIC_PORT=' .env | cut -d= -f2)"
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status | grep -q "Status: active"; then
  $SUDO ufw allow "${PUBLIC_PORT_VAL}/tcp" >/dev/null || true
  log "ufw: открыт порт ${PUBLIC_PORT_VAL}/tcp"
fi

# ---------- 7. Готово ----------
IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
ADMIN_USERNAME_VAL="$(grep -E '^ADMIN_USERNAME=' .env | cut -d= -f2)"
ADMIN_PASSWORD_VAL="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2)"

cat <<EOF

\033[1;32m✔ TPM Panel установлен.\033[0m

  URL:    http://${IP:-<server-ip>}:${PUBLIC_PORT_VAL}
  Логин:  ${ADMIN_USERNAME_VAL}
  Пароль: ${ADMIN_PASSWORD_VAL}

Полезные команды (из ${INSTALL_DIR}):
  docker compose ps
  docker compose logs -f backend worker
  docker compose restart worker
  bash install.sh                    # обновить (git pull + rebuild)

EOF
