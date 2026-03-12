#!/usr/bin/env bash
# Back up the Gorgonetics database from a running container.
#
# Usage: ./scripts/db-backup.sh <container_name> <backup_dir>
# Example: ./scripts/db-backup.sh gorgonetics ./backups
#
# The script flushes the DuckLake WAL (CHECKPOINT) before archiving
# so that the SQLite catalog is in a consistent state. The container
# keeps running during the backup.

set -euo pipefail

CONTAINER="${1:-gorgonetics}"
BACKUP_DIR="${2:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/gorgonetics_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "==> Flushing DuckLake WAL before backup..."
docker exec "$CONTAINER" python -c "
from gorgonetics.database_config import create_database_instance
db = create_database_instance()
db.conn.execute('CHECKPOINT')
db.conn.commit()
db.close()
print('Checkpoint complete.')
"

echo "==> Archiving /app/data from container '$CONTAINER'..."
docker exec "$CONTAINER" tar czf - -C / app/data > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "==> Backup written to: $BACKUP_FILE ($SIZE)"
