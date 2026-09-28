#!/usr/bin/env bash
#
# build-release.sh — rebuild and package the Coordinator customer bundle from the
# CURRENT source tree, and (with --check) gate against shipping a stale bundle.
#
# Fixes/prevents REL-000: the 0.22.0 bundle once shipped a Docker image built
# before 14 later commits (the whole PR #2 UI overhaul) — a stale customer
# artifact under a current version label, because the release was built by hand
# with no freshness gate. This script makes the build reproducible and adds a
# `--check` mode you can run before any handoff (or in CI) to fail loudly when
# the packaged tarball is older than HEAD or than dist/.
#
# Usage:
#   scripts/build-release.sh           # rebuild dist/ + image, save, sha256, zip
#   scripts/build-release.sh --check   # verify the existing bundle is fresh (no build)
#
# The image is built from docker/Dockerfile (Python/FastAPI backend that serves
# the built React bundle + /api on a single loopback port). The tarball and zip
# are gitignored build outputs; IMAGE_SHA256.txt + the bundle text files are
# tracked.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
IMAGE_TAG="pedi-scheduler-react:${VERSION}"
BUNDLE_DIR="release/CoordinatorPediSchedulerReact"
TARBALL="${BUNDLE_DIR}/pedi-scheduler-react-docker-linux-amd64.tar.gz"
SHA_FILE="${BUNDLE_DIR}/IMAGE_SHA256.txt"
ZIP="release/CoordinatorPediSchedulerReact-${VERSION}.zip"

# mtime in epoch seconds, portable across GNU/BSD stat.
mtime() { date -r "$1" +%s 2>/dev/null || stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }

check_fresh() {
  local rc=0
  if [ ! -f "$TARBALL" ]; then
    echo "STALE: $TARBALL is missing — run scripts/build-release.sh" >&2
    return 1
  fi
  local tarball_t head_t dist_t
  tarball_t="$(mtime "$TARBALL")"
  head_t="$(git log -1 --format=%ct 2>/dev/null || echo 0)"
  if [ "$head_t" -gt "$tarball_t" ]; then
    echo "STALE: bundle ($(date -d @"$tarball_t" 2>/dev/null || date -r "$tarball_t")) predates HEAD commit ($(date -d @"$head_t" 2>/dev/null || date -r "$head_t")). Rebuild before handoff." >&2
    rc=1
  fi
  if [ -d dist ]; then
    dist_t="$(mtime dist)"
    if [ "$dist_t" -gt "$tarball_t" ]; then
      echo "STALE: dist/ is newer than the packaged image. Rebuild before handoff." >&2
      rc=1
    fi
  fi
  # SHA must match the packaged tarball.
  if [ -f "$SHA_FILE" ]; then
    local want have
    want="$(tr -d '[:space:]' < "$SHA_FILE")"
    have="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
    if [ "$want" != "$have" ]; then
      echo "STALE: IMAGE_SHA256.txt ($want) does not match the tarball ($have)." >&2
      rc=1
    fi
  fi
  # Launcher + compose must pin the SAME image tag the tarball ships. REL-001:
  # the 0.23.0 bundle shipped run-on-mac.command/compose.yaml still pinned to
  # 0.22.0, so `docker run` tried to pull a nonexistent registry image and the
  # app never started. The mtime/SHA checks above don't see these text files.
  if ! grep -qF "IMAGE_TAG=\"pedi-scheduler-react:${VERSION}\"" "${BUNDLE_DIR}/run-on-mac.command"; then
    echo "STALE: run-on-mac.command does not pin pedi-scheduler-react:${VERSION}." >&2
    rc=1
  fi
  if ! grep -qF "image: pedi-scheduler-react:${VERSION}" "${BUNDLE_DIR}/compose.yaml"; then
    echo "STALE: compose.yaml does not pin pedi-scheduler-react:${VERSION}." >&2
    rc=1
  fi
  [ "$rc" -eq 0 ] && echo "OK: bundle is fresh (image ${IMAGE_TAG}, launcher+compose pinned to ${VERSION}, tarball newer than HEAD, sha matches)."
  return "$rc"
}

if [ "${1:-}" = "--check" ]; then
  check_fresh
  exit $?
fi

echo "==> [1/6] Building frontend (dist/) from current source"
npm run build

echo "==> [2/6] Building Docker image ${IMAGE_TAG} (docker/Dockerfile)"
docker build -f docker/Dockerfile -t "${IMAGE_TAG}" .

echo "==> [3/6] Saving image -> ${TARBALL}"
docker save "${IMAGE_TAG}" | gzip > "${TARBALL}"

echo "==> [4/6] Writing ${SHA_FILE} (sha256 of the tarball)"
sha256sum "${TARBALL}" | cut -d' ' -f1 > "${SHA_FILE}"

echo "==> [5/6] Stamping launcher + compose with pedi-scheduler-react:${VERSION}"
# Pin from package.json so the bundled image tag can never drift from the
# hand-maintained launcher again (REL-001). -i.bak keeps this portable across
# GNU and BSD/macOS sed; the gate (check_fresh) verifies the result.
sed -i.bak -E "s/(IMAGE_TAG=\"pedi-scheduler-react:)[^\"]*/\1${VERSION}/" "${BUNDLE_DIR}/run-on-mac.command"
sed -i.bak -E "s/(image: pedi-scheduler-react:).*/\1${VERSION}/"          "${BUNDLE_DIR}/compose.yaml"
rm -f "${BUNDLE_DIR}/run-on-mac.command.bak" "${BUNDLE_DIR}/compose.yaml.bak"

echo "==> [6/6] Repackaging ${ZIP}"
rm -f "${ZIP}"
( cd release && zip -r -q "CoordinatorPediSchedulerReact-${VERSION}.zip" "CoordinatorPediSchedulerReact" )

echo
echo "Done. Release bundle for v${VERSION}:"
echo "  image   : ${IMAGE_TAG}"
echo "  tarball : ${TARBALL} ($(du -h "${TARBALL}" | cut -f1))"
echo "  sha256  : $(cat "${SHA_FILE}")"
echo "  zip     : ${ZIP} ($(du -h "${ZIP}" | cut -f1))"
echo
echo "Verifying freshness:"
check_fresh || true
