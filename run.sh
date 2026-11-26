#!/usr/bin/env bash
# Start HEARTLAB at http://127.0.0.1:8000
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
exec .venv/bin/python -m uvicorn app.backend.server:app --host 127.0.0.1 --port "$PORT"
