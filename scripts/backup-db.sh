#!/usr/bin/env bash
# Fail immediately on any error (-e), undefined variable (-u), or failed pipe command (-o pipefail)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S3_BUCKET="s3://sandeep-docker-stack-backups-2026"
TIMESTAMP=$(date +%F_%H-%M-%S)
BACKUP_FILE="/tmp/tasksdb_${TIMESTAMP}.sql.gz"

# Load DB_USER and DB_NAME from .env
source "${PROJECT_DIR}/.env"

echo "[$(date -Is)] Starting PostgreSQL backup for ${DB_NAME}..."

# Dump Postgres over stdout (-T disables pseudo-TTY so cron works!) and compress on the fly
docker compose -f "${PROJECT_DIR}/compose.yaml" exec -T db \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${BACKUP_FILE}"

# Upload compressed backup to AWS S3 using the EC2 IAM Role
aws s3 cp "${BACKUP_FILE}" "${S3_BUCKET}/backups/tasksdb_${TIMESTAMP}.sql.gz"

# Remove local temporary file
rm -f "${BACKUP_FILE}"

echo "[$(date -Is)] Backup uploaded successfully to ${S3_BUCKET}/backups/tasksdb_${TIMESTAMP}.sql.gz"
