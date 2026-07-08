#!/bin/sh
# Nightly Postgres backup for the self-hosted Plague DB.
# Add to the VPS host crontab (crontab -e):
#   0 3 * * * /opt/plague/deploy/pg-backup.sh >> /var/log/plague-backup.log 2>&1
# Adjust REPO_DIR / BACKUP_DIR to wherever you cloned the repo.
set -e

REPO_DIR=/opt/plague
BACKUP_DIR="$REPO_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)

docker compose -f "$REPO_DIR/deploy/docker-compose.yml" exec -T postgres \
  pg_dump -U plague plague | gzip > "$BACKUP_DIR/plague-$TS.sql.gz"

# Retain the 14 most recent dumps
ls -1t "$BACKUP_DIR"/plague-*.sql.gz | tail -n +15 | xargs -r rm -f
