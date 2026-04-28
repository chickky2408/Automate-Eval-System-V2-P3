.PHONY: up down compose logs

up:
	docker compose up -d

down:
	docker compose down

compose:
	docker compose up --build -d

logs:
	docker compose logs -f eval
