#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

IMAGE_TAG="pedi-scheduler-react:0.26.0"
IMAGE_FILE="pedi-scheduler-react-docker-linux-amd64.tar.gz"
CONTAINER_NAME="${CONTAINER_NAME:-pedi-scheduler-react}"
PORT="${PORT:-6173}"
URL="http://localhost:${PORT}"

fail() {
    echo
    echo "ERROR: $*" >&2
    echo
    read -r -p "Press Enter to close this window..." _ || true
    exit 1
}

if ! command -v docker >/dev/null 2>&1; then
    fail "Docker was not found. Install Docker Desktop for Mac, start it, then run this again."
fi

if ! docker info >/dev/null 2>&1; then
    fail "Docker Desktop is not running. Open Docker Desktop, wait until it is ready, then run this again."
fi

if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    if [ ! -f "$IMAGE_FILE" ]; then
        fail "Missing ${IMAGE_FILE}. Keep this script in the same folder as the Docker image file."
    fi
    echo "Loading Pediatric Neurology Scheduler React Docker image. This can take a few minutes the first time."
    docker load -i "$IMAGE_FILE"
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "Stopping existing ${CONTAINER_NAME} container."
    docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo
echo "Starting Pediatric Neurology Scheduler React."
echo "Open this URL if it does not open automatically:"
echo "$URL"
echo
echo "Press Ctrl+C in this Terminal window to stop the app."
echo

if command -v open >/dev/null 2>&1; then
    (sleep 3; open "$URL" >/dev/null 2>&1 || true) &
fi

docker run --rm \
    --name "$CONTAINER_NAME" \
    --platform linux/amd64 \
    -p "127.0.0.1:${PORT}:6173" \
    -v pedi_scheduler_react_data:/home/app/.local/share/pedi_scheduler \
    "$IMAGE_TAG"
