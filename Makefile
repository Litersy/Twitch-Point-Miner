.PHONY: up down build logs restart backup restore prisma

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f --tail=200

restart:
	docker compose restart backend worker

prisma:
	docker compose exec backend npx prisma migrate deploy

backup:
	docker compose exec -T postgres pg_dump -U $$POSTGRES_USER $$POSTGRES_DB > backup-$$(date +%F).sql

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=backup.sql" && exit 1)
	cat $(FILE) | docker compose exec -T postgres psql -U $$POSTGRES_USER $$POSTGRES_DB
