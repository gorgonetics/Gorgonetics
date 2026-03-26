#!/usr/bin/env bash
# Deploy Gorgonetics to a GCP e2-micro VM.
#
# Usage (on the VM):
#   ./deploy-gcp.sh                          # uses defaults
#   GORGONETICS_IMAGE=ghcr.io/user/repo:v2 ./deploy-gcp.sh
#
# Prerequisites:
#   - Docker installed and running
#   - /opt/gorgonetics/.env populated with production env vars
#   - Data disk mounted at /mnt/gorgonetics-data with docker-data/ subdirectory

set -euo pipefail

IMAGE="${GORGONETICS_IMAGE:-ghcr.io/jlopezpena/gorgonetics:latest}"
CONTAINER_NAME="gorgonetics"
ENV_FILE="${GORGONETICS_ENV_FILE:-/opt/gorgonetics/.env}"
DATA_DIR="${GORGONETICS_DATA_DIR:-/mnt/gorgonetics-data/docker-data}"

echo "==> Pulling $IMAGE"
docker pull "$IMAGE"

echo "==> Stopping existing container (if any)"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "==> Starting container"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart always \
  --env-file "$ENV_FILE" \
  -p 80:8000 \
  -v "$DATA_DIR":/app/data \
  "$IMAGE"

echo "==> Waiting for health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost/health > /dev/null 2>&1; then
    echo "==> Application is healthy!"
    docker image prune -f
    exit 0
  fi
  sleep 2
done

echo "==> ERROR: Health check failed after 60 seconds"
docker logs "$CONTAINER_NAME" --tail 50
exit 1
