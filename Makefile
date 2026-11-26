# Everstate developer shortcuts. `make help` lists everything.
.PHONY: help install api web build test test-core typecheck simulator simulator-native bench bench-full landing landing-build clean

help:            ## show targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | column -t -s "$$(printf '\t')"

install:         ## python + web + landing dependencies
	uv sync --extra dev
	cd web && npm install
	cd landing && npm install

api:             ## console API on :8080 (legacy routes + /api/v2 Everstate engine)
	.venv/bin/python -m uvicorn src.ui_service.server:api --reload --port 8080

web:             ## console UI with HMR on :5173
	cd web && npm run dev

build:           ## production console bundle
	cd web && npm run build

typecheck:
	cd web && npm run typecheck

test-core:       ## Everstate engine: laws, contracts, adapters (Redis/Ollama tests auto-skip if absent)
	.venv/bin/python -m pytest tests/everstate -q

test: build      ## everything
	.venv/bin/python -m pytest -q

simulator:       ## local stack in Docker: Redis 8 (vector sets) + Ollama with EmbeddingGemma
	docker compose up -d redis ollama
	docker compose exec ollama ollama pull embeddinggemma

simulator-native: ## same stack without Docker (Homebrew redis + ollama)
	redis-server --port 6379 --save "" --appendonly no --daemonize yes
	pgrep -x ollama >/dev/null || (nohup ollama serve >/tmp/ollama.log 2>&1 &) ; sleep 2
	ollama pull embeddinggemma

bench:           ## quick benchmark: hashing embedder, in-process + Redis
	.venv/bin/python -m benchmarks.run

bench-full:      ## + EmbeddingGemma and 1k/10k scaling (needs `make simulator`)
	.venv/bin/python -m benchmarks.run --embedders hashing,ollama --scale 1000,10000

landing:         ## marketing site with HMR
	cd landing && npm run dev

landing-build:   ## static marketing site (deployed to Vercel)
	cd landing && npm run build

clean:
	rm -rf web/dist landing/dist .pytest_cache
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
