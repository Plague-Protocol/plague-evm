#!/bin/sh
# Nightly Postgres backup for the self-hosted Plague DB.
# Install into the VPS user crontab (crontab -e):
#   0 3 * * * /opt/plague/deploy/pg-backup.sh >> /opt/plague/backups/backup.log 2>&1
set -e

DEPLOY_DIR=/opt/plague/deploy
BACKUP_DIR=/opt/plague/backups
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)

# Run from the deploy dir so `docker compose` loads deploy/.env and resolves the
# project cleanly (no unset-variable warnings under cron's minimal environment).
cd "$DEPLOY_DIR"
# --clean --if-exists → the dump drops existing objects before recreating them,
# so a restore reliably replaces current data instead of erroring on conflicts.
docker compose exec -T postgres pg_dump -U plague --clean --if-exists plague | gzip > "$BACKUP_DIR/plague-$TS.sql.gz"

# Retain the 14 most recent dumps
ls -1t "$BACKUP_DIR"/plague-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup ok: plague-$TS.sql.gz"
