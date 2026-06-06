#!/bin/sh
# Entrypoint for the agent runner container.
# Auto-generates ZK proofs on first start, then runs the bot loop forever.
set -e

PROOFS_FILE="/app/agents/data/bot-proofs.json"

if [ ! -f "$PROOFS_FILE" ]; then
  echo "[entrypoint] bot-proofs.json not found — running setup..."
  cd /app && node_modules/.bin/tsx agents/src/setup.ts
  echo "[entrypoint] setup complete"
fi

echo "[entrypoint] starting bot runner..."
exec node_modules/.bin/tsx agents/src/runner.ts
