#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${1:?project directory is required}"
IMAGE_NAME="${2:-generated-api-smoke}"
HOST_PORT="${DOCKER_HOST_PORT:-3009}"
CONTAINER_PORT="${DOCKER_CONTAINER_PORT:-3000}"
HEALTH_PATH="${DOCKER_HEALTH_PATH:-/health}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH; skipping Docker smoke stage."
  exit 0
fi

cd "$PROJECT_DIR"

echo "Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

CONTAINER_ID=""
cleanup() {
  if [[ -n "$CONTAINER_ID" ]]; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Running Docker container on localhost:$HOST_PORT"
CONTAINER_ID="$(docker run -d -p "$HOST_PORT:$CONTAINER_PORT" "$IMAGE_NAME")"

for _ in {1..20}; do
  if curl -fsS "http://localhost:$HOST_PORT$HEALTH_PATH" >/dev/null 2>&1; then
    echo "Docker smoke check passed: http://localhost:$HOST_PORT$HEALTH_PATH"
    exit 0
  fi
  sleep 1
done

echo "Docker smoke check failed. Container logs:"
docker logs "$CONTAINER_ID" || true
exit 1
