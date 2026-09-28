#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-pedi-scheduler-react}"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker was not found. Nothing to stop."
    exit 0
fi

if ! docker info >/dev/null 2>&1; then
    echo "Docker Desktop is not running. Nothing to stop."
    exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    docker rm -f "$CONTAINER_NAME" >/dev/null
    echo "Stopped ${CONTAINER_NAME}."
else
    echo "${CONTAINER_NAME} is not running."
fi
