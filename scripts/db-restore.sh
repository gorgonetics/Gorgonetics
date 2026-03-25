#!/usr/bin/env bash
# Restore a Gorgonetics database backup into a Docker volume.
#
# Usage: ./scripts/db-restore.sh <backup_file> [volume_name]
# Example: ./scripts/db-restore.sh ./backups/gorgonetics_20260311_120000.tar.gz gorgonetics_data
#
# WARNING: This overwrites everything in the target volume.
#          The application container MUST be stopped first.

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 <backup_file> [volume_name]}"
VOLUME_NAME="${2:-gorgonetics_data}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "This will OVERWRITE all data in Docker volume '$VOLUME_NAME'."
echo "The application container must already be stopped."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

echo "==> Restoring from $BACKUP_FILE into volume $VOLUME_NAME..."

docker run --rm \
  -v "${VOLUME_NAME}:/app/data" \
  -v "$(realpath "$BACKUP_FILE"):/backup.tar.gz:ro" \
  alpine \
  sh -c "rm -rf /app/data/* && tar xzf /backup.tar.gz --strip-components=2 -C /app/data"

echo "==> Restore complete. You can now start the container."
