#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="PediatricScheduler"
DESKTOP_APP_NAME="Pediatric Scheduler.app"
SCHEME_NAME="PediatricSchedulerMac"
BUNDLE_ID="com.cashbailey.PediatricScheduler"
MIN_SYSTEM_VERSION="13.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/.build/app/$APP_NAME.app"
DESKTOP_APP="$HOME/Desktop/$DESKTOP_APP_NAME"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
ENGINE_DIR="$APP_RESOURCES/Engine"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
DERIVED_DATA="$ROOT_DIR/.build/xcode"
NATIVE_PACKAGE_DIR="$ROOT_DIR/.build/native-release"
NATIVE_PACKAGE_APP="$NATIVE_PACKAGE_DIR/$DESKTOP_APP_NAME"
NATIVE_PACKAGE_ZIP="$NATIVE_PACKAGE_DIR/PediatricScheduler-macOS.zip"
NATIVE_PACKAGE_EXTRACT_DIR="$NATIVE_PACKAGE_DIR/verify-extract"
NATIVE_PACKAGE_SHA="$NATIVE_PACKAGE_DIR/PediatricScheduler-macOS.SHA256.txt"
NATIVE_PACKAGE_MANIFEST="$NATIVE_PACKAGE_DIR/PediatricScheduler-macOS-MANIFEST.json"
NATIVE_RELEASE_README_SOURCE="$ROOT_DIR/release/PediatricSchedulerMac/README.md"
NATIVE_PACKAGE_README="$NATIVE_PACKAGE_DIR/README.md"
PYTHON="$ROOT_DIR/backend_py/.venv/bin/python"
PYTHON_FRAMEWORK="/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9"
ICON_SOURCE="$ROOT_DIR/macos/PediatricScheduler/Assets/AppIcon.png"
ICONSET_DIR="$ROOT_DIR/.build/app-icon.iconset"
ICON_FILE="$APP_RESOURCES/AppIcon.icns"
CODE_SIGN_IDENTITY="${SCHEDULER_CODESIGN_IDENTITY:-}"
if [ -z "$CODE_SIGN_IDENTITY" ]; then
  CODE_SIGN_IDENTITY="-"
fi

BUILD_CONFIGURATION="${SCHEDULER_BUILD_CONFIGURATION:-Debug}"
case "$MODE" in
  --package|package|--release|release)
    BUILD_CONFIGURATION="Release"
    ;;
esac

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -f "Pediatric Scheduler.app/Contents/Resources/Engine/backend_py/.venv/.*backend_py.run" >/dev/null 2>&1 || true
defaults delete "$BUNDLE_ID" >/dev/null 2>&1 || true
defaults write "$BUNDLE_ID" ApplePersistenceIgnoreState -bool true
defaults write "$BUNDLE_ID" NSQuitAlwaysKeepsWindows -bool false
if [ -n "${SCHEDULER_INITIAL_SCREEN:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_INITIAL_SCREEN "$SCHEDULER_INITIAL_SCREEN"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_INITIAL_SCREEN >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_DATA_DIR:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_DATA_DIR "$SCHEDULER_DATA_DIR"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_DATA_DIR >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_REPORTS_HANDOFF_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT "$SCHEDULER_REPORTS_HANDOFF_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_DASHBOARD_DRAFT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT "$SCHEDULER_DASHBOARD_DRAFT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_METHODIST_AUTO_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_METHODIST_AUTO_AUDIT "$SCHEDULER_METHODIST_AUTO_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_METHODIST_AUTO_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_PLANNING_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_PLANNING_EDIT_AUDIT "$SCHEDULER_PLANNING_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_PLANNING_EDIT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_SOURCES_IMPORT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT "$SCHEDULER_SOURCES_IMPORT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_ROTATORS_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT "$SCHEDULER_ROTATORS_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_OUTPATIENT_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT "$SCHEDULER_OUTPATIENT_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_INPATIENT_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT "$SCHEDULER_INPATIENT_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_CLINICS_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_CLINICS_EDIT_AUDIT "$SCHEDULER_CLINICS_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_CLINICS_EDIT_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_FELLOWS_RESOLVE_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT "$SCHEDULER_FELLOWS_RESOLVE_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT >/dev/null 2>&1 || true
fi
if [ -n "${SCHEDULER_SETTINGS_EDIT_AUDIT:-}" ]; then
  defaults write "$BUNDLE_ID" PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT "$SCHEDULER_SETTINGS_EDIT_AUDIT"
else
  defaults delete "$BUNDLE_ID" PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT >/dev/null 2>&1 || true
fi

# The native SwiftUI app is the UI now — it does NOT load the React bundle, so
# `npm run build` is no longer part of launching the Mac app. (The React app
# and its Docker bundle still live in the repo for the legacy web path.) The
# app only needs the Python engine venv below.
if [ ! -x "$PYTHON" ]; then
  python3 -m venv "$ROOT_DIR/backend_py/.venv"
fi

if ! "$PYTHON" - <<'PY' >/dev/null 2>&1
import fastapi
import jsonschema
import uvicorn
PY
then
  "$PYTHON" -m pip install -r "$ROOT_DIR/backend_py/requirements.txt"
fi

xcodebuild \
  -scheme "$SCHEME_NAME" \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  -configuration "$BUILD_CONFIGURATION" \
  build

BUILD_BINARY="$DERIVED_DATA/Build/Products/$BUILD_CONFIGURATION/$APP_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"

if [ -f "$ICON_SOURCE" ]; then
  rm -rf "$ICONSET_DIR"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET_DIR" -o "$ICON_FILE"
fi

rm -rf "$ENGINE_DIR"
mkdir -p "$ENGINE_DIR"
rsync -a --delete \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'tests' \
  --exclude '*.pyc' \
  "$ROOT_DIR/backend_py" "$ENGINE_DIR/"
rsync -a --delete "$ROOT_DIR/contracts" "$ENGINE_DIR/"
cp "$ROOT_DIR/package.json" "$ENGINE_DIR/package.json"

BUNDLED_VENV="$ENGINE_DIR/backend_py/.venv"
if [ -d "$PYTHON_FRAMEWORK" ]; then
  rm -f "$BUNDLED_VENV/bin/python3"
  cp "$PYTHON_FRAMEWORK/bin/python3" "$BUNDLED_VENV/bin/python3"
  chmod +x "$BUNDLED_VENV/bin/python3"
  cp "$PYTHON_FRAMEWORK/Python3" "$BUNDLED_VENV/Python3"
  mkdir -p "$BUNDLED_VENV/Resources"
  ditto "$PYTHON_FRAMEWORK/Resources/Python.app" "$BUNDLED_VENV/Resources/Python.app"
  mkdir -p "$BUNDLED_VENV/lib"
  rsync -a \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'site-packages' \
    "$PYTHON_FRAMEWORK/lib/python3.9" "$BUNDLED_VENV/lib/"
fi

printf '%s\n' "$ROOT_DIR" > "$APP_RESOURCES/RepoRoot.txt"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>Pediatric Scheduler</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.medical</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSQuitAlwaysKeepsWindows</key>
  <false/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

codesign_app() {
  local args=(--force --deep --sign "$CODE_SIGN_IDENTITY")
  if [ "$CODE_SIGN_IDENTITY" != "-" ]; then
    args+=(--options runtime --timestamp)
  fi
  codesign "${args[@]}" "$APP_BUNDLE"
}

codesign_app

rm -rf "$DESKTOP_APP"
ditto "$APP_BUNDLE" "$DESKTOP_APP"
touch "$DESKTOP_APP"

open_app() {
  /usr/bin/open -n "$DESKTOP_APP"
}

verify_runtime_engine() {
  local app_path="${1:-$DESKTOP_APP}"
  "$PYTHON" - "$app_path" <<'PY'
import json
import sys
import time
import urllib.request
from pathlib import Path

app = Path(sys.argv[1])
expected = (app / "Contents" / "Resources" / "Engine").resolve()
last_error = None
for _ in range(40):
    try:
        with urllib.request.urlopen("http://127.0.0.1:6174/api/runtime", timeout=0.5) as response:
            runtime = json.load(response)
        break
    except Exception as exc:
        last_error = exc
        time.sleep(0.25)
else:
    raise SystemExit(f"runtime endpoint did not answer: {last_error}")

engine_root = Path(runtime.get("engineRoot", "")).resolve()
cwd = Path(runtime.get("cwd", "")).resolve()
python = Path(runtime.get("python", "")).resolve()
if engine_root != expected:
    raise SystemExit(f"backend engine root mismatch: expected {expected}, got {engine_root}")
if cwd != expected:
    raise SystemExit(f"backend cwd mismatch: expected {expected}, got {cwd}")
if expected not in python.parents:
    raise SystemExit(f"backend Python executable is outside bundled engine: expected under {expected}, got {python}")
PY
}

verify_packaged_runtime() {
  local app_path="$1"
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  pkill -f "$app_path/Contents/Resources/Engine/backend_py/.venv/.*backend_py.run" >/dev/null 2>&1 || true
  /usr/bin/open -n "$app_path"
  verify_runtime_engine "$app_path"
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  pkill -f "$app_path/Contents/Resources/Engine/backend_py/.venv/.*backend_py.run" >/dev/null 2>&1 || true
}

verify_bundle_engine() {
  local app_path="${1:-$DESKTOP_APP}"
  "$PYTHON" - "$app_path" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1])
engine = (app / "Contents" / "Resources" / "Engine").resolve()
venv = engine / "backend_py" / ".venv"
python = venv / "bin" / "python"

if not python.exists():
    raise SystemExit(f"missing bundled Python: {python}")
if not (venv / "Python3").exists():
    raise SystemExit(f"missing bundled Python framework library: {venv / 'Python3'}")

for link in engine.rglob("*"):
    if not link.is_symlink():
        continue
    target = os.readlink(link)
    if target.startswith("/"):
        raise SystemExit(f"absolute symlink in bundled engine: {link} -> {target}")

env = {
    "PYTHONHOME": str(venv),
    "PYTHONPATH": str(engine),
    "PEDI_SCHEDULER_BIND_HOST": "127.0.0.1",
    "PEDI_SCHEDULER_DATA_DIR": str(app / "Contents" / "Resources" / "VerifyData"),
    "PORT": "6174",
}
probe = r'''
import base64
import tempfile
from pathlib import Path

import fastapi
import jsonschema
import backend_py.main
from backend_py.contracts import validate
from backend_py.domain.exports import build_export_package
from backend_py.domain.pdf_exports import build_pdf_exports
from backend_py.domain.word_exports import build_word_exports
from backend_py.initial_state import create_initial_state
from backend_py.roster_import import import_roster_file

assert validate("scheduler-state.v1", {})

state = create_initial_state()
block = state["serviceBlocks"][0]
block.update({
    "id": "bundle-smoke",
    "name": "Bundle Smoke",
    "startDate": "2026-05-04",
    "endDate": "2026-05-08",
    "status": "Draft",
})
state["activeBlockId"] = "bundle-smoke"
state["rotators"] = [{
    "id": "r1",
    "fullName": "Drew Quinn",
    "displayName": "Drew Quinn",
    "program": "UT Pediatrics",
    "level": "PGY-2",
    "role": "Resident",
    "segments": [{"start": "2026-05-04", "end": "2026-05-08"}],
    "schoolType": "ut-peds",
    "continuityClinic": "",
    "dayOff": [],
    "unavailableRanges": [],
}]
state["inpatientAssignments"] = [{
    "id": "in-2026-05-04-r1-resident",
    "date": "2026-05-04",
    "rotatorId": "r1",
    "role": "Resident",
    "source": "Manual",
}]
state["outpatientSessions"] = [{
    "id": "op-2026-05-05-r1-AM",
    "date": "2026-05-05",
    "period": "AM",
    "rotatorId": "r1",
    "clinic": "Continuity",
    "provider": "Alder",
    "source": "Manual",
}]
assert validate("scheduler-state.v1", state) == []

package = build_export_package(state)
manifest_names = {item["name"] for item in package["manifest"]["files"]}
assert {"manifest.json", "roster.csv", "inpatient-calendar.csv", "outpatient-calendar.csv", "daily-reports.txt", "schedule-package.json"} <= manifest_names
assert "Drew Quinn" in package["rosterCsv"]
assert "Daily Team Report" in package["dailyReports"]

pdfs = build_pdf_exports(state)
assert len(pdfs) == 4
assert base64.b64decode(pdfs[0]["base64"]).startswith(b"%PDF")

docs = build_word_exports(state)
assert len(docs) == 4
assert base64.b64decode(docs[0]["base64"]).startswith(b"PK")

with tempfile.TemporaryDirectory() as tmp:
    roster = Path(tmp) / "roster.csv"
    roster.write_text(
        "Name,Program,Level,Start,End\n"
        "Blake Lee,UT Pediatrics,PGY-3,2026-05-04,2026-05-08\n",
        encoding="utf-8",
    )
    result = import_roster_file(state, roster, mode="add")
    assert result["acceptance"]["added"] == 1
    assert any(rotator["fullName"] == "Blake Lee" for rotator in result["state"]["rotators"])

print("bundled-python-ok")
'''
subprocess.run([str(python), "-c", probe], env=env, cwd=engine, check=True, text=True)
PY
}

package_app() {
  rm -rf "$NATIVE_PACKAGE_DIR"
  mkdir -p "$NATIVE_PACKAGE_DIR"
  ditto "$APP_BUNDLE" "$NATIVE_PACKAGE_APP"
  codesign --verify --deep --strict "$NATIVE_PACKAGE_APP"
  (cd "$NATIVE_PACKAGE_DIR" && ditto -c -k --sequesterRsrc --keepParent "$DESKTOP_APP_NAME" "$NATIVE_PACKAGE_ZIP")
  rm -rf "$NATIVE_PACKAGE_EXTRACT_DIR"
  mkdir -p "$NATIVE_PACKAGE_EXTRACT_DIR"
  ditto -x -k "$NATIVE_PACKAGE_ZIP" "$NATIVE_PACKAGE_EXTRACT_DIR"
  EXTRACTED_APP="$NATIVE_PACKAGE_EXTRACT_DIR/$DESKTOP_APP_NAME"
  codesign --verify --deep --strict "$EXTRACTED_APP"
  verify_bundle_engine "$EXTRACTED_APP"
  verify_packaged_runtime "$EXTRACTED_APP"
  local zip_sha
  zip_sha="$(shasum -a 256 "$NATIVE_PACKAGE_ZIP" | awk '{print $1}')"
  printf '%s  %s\n' "$zip_sha" "$(basename "$NATIVE_PACKAGE_ZIP")" > "$NATIVE_PACKAGE_SHA"
  if [ -f "$NATIVE_RELEASE_README_SOURCE" ]; then
    cp "$NATIVE_RELEASE_README_SOURCE" "$NATIVE_PACKAGE_README"
  fi
  "$PYTHON" - "$ROOT_DIR/package.json" "$NATIVE_PACKAGE_ZIP" "$NATIVE_PACKAGE_MANIFEST" "$zip_sha" "$CODE_SIGN_IDENTITY" "$MIN_SYSTEM_VERSION" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

package_json = Path(sys.argv[1])
zip_path = Path(sys.argv[2])
manifest_path = Path(sys.argv[3])
zip_sha = sys.argv[4]
codesign_identity = sys.argv[5]
minimum_macos = sys.argv[6]
package = json.loads(package_json.read_text(encoding="utf-8"))

manifest = {
    "product": "Pediatric Scheduler",
    "version": package.get("version", ""),
    "bundleId": "com.cashbailey.PediatricScheduler",
    "minimumMacOS": minimum_macos,
    "artifact": {
        "name": zip_path.name,
        "bytes": zip_path.stat().st_size,
        "sha256": zip_sha,
    },
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "signing": {
        "identity": "ad-hoc" if codesign_identity == "-" else codesign_identity,
        "notarized": False,
    },
    "verification": [
        "codesign --verify --deep --strict on packaged and extracted apps",
        "launch extracted app and verify /api/runtime uses extracted bundled Engine",
        "bundled Python import gate",
        "bundled export package/PDF/Word smoke",
        "bundled CSV roster import smoke",
        "no absolute symlinks in Contents/Resources/Engine",
    ],
    "customerRequirements": [
        "macOS 13 or newer",
        "no Docker, Node, npm, Python, Git, or source checkout required",
        "first launch may require right-click Open because this local build is not notarized",
    ],
}
manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  echo "Packaged native app: $NATIVE_PACKAGE_ZIP"
  echo "Native package manifest: $NATIVE_PACKAGE_MANIFEST"
  echo "Native package SHA256: $NATIVE_PACKAGE_SHA"
  if [ -f "$NATIVE_PACKAGE_README" ]; then
    echo "Native package README: $NATIVE_PACKAGE_README"
  fi
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    for _ in {1..40}; do
      if curl -fsS "http://127.0.0.1:6174/api/health" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done
    pgrep -x "$APP_NAME" >/dev/null
    curl -fsS "http://127.0.0.1:6174/api/health" >/dev/null
    verify_bundle_engine
    verify_runtime_engine
    codesign --verify --deep --strict "$DESKTOP_APP"
    ;;
  --package|package|--release|release)
    verify_bundle_engine
    package_app
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--package]" >&2
    exit 2
    ;;
esac
