import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const appRoot = new URL("..", import.meta.url).pathname;
const handoffRoot = join(appRoot, "release", "CoordinatorPediSchedulerReact");
const nativeHandoffRoot = join(appRoot, "release", "PediatricSchedulerMac");

test("React app has Docker static hosting files", () => {
  const dockerfile = readFileSync(join(appRoot, "docker", "Dockerfile"), "utf8");
  const entrypoint = readFileSync(join(appRoot, "docker", "entrypoint.sh"), "utf8");
  const compose = readFileSync(join(appRoot, "compose.yaml"), "utf8");

  // Match any pedi-scheduler-desktop base image tag rather than pinning
  // the exact version — bumping the base shouldn't break the contract
  // test, only the React-image build itself.
  assert.match(dockerfile, /FROM pedi-scheduler-desktop:/);
  assert.match(dockerfile, /COPY dist\/ \/srv\/pedi-scheduler-react\//);
  // The Python/FastAPI backend serves both static + API on one port. Match
  // the Python entrypoint (supersedes the Node `backend/bin.js` of <= 0.21.0).
  assert.match(entrypoint, /python -m backend_py\.run/);
  assert.match(compose, /127\.0\.0\.1:6173:6173/);
});

test("Coordinator React handoff folder contains everything needed to run on a Mac", () => {
  // Tracked files (must always be present in the repo).
  for (const filename of [
    "README.md",
    "WHATS_NEW.md",
    "run-on-mac.command",
    "stop-app.command",
    "compose.yaml",
    "IMAGE_SHA256.txt"
  ]) {
    assert.equal(existsSync(join(handoffRoot, filename)), true, filename);
  }

  const recordedHash = readFileSync(
    join(handoffRoot, "IMAGE_SHA256.txt"),
    "utf8"
  ).trim().split(/\s+/)[0];
  assert.match(recordedHash, /^[0-9a-f]{64}$/, "IMAGE_SHA256.txt should hold a 64-hex hash");

  // The Docker image tarball is gitignored (450+ MB) and only present after a
  // local `docker save`. When it is present, verify this tracked hash file
  // matches the actual artifact so a stale bundle cannot slip through.
  const tarPath = join(handoffRoot, "pedi-scheduler-react-docker-linux-amd64.tar.gz");
  if (existsSync(tarPath)) {
    const actualHash = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
    assert.equal(actualHash, recordedHash, "IMAGE_SHA256.txt should match the Docker tarball");
  }

  const releaseScript = readFileSync(join(appRoot, "scripts", "build-release.sh"), "utf8");
  assert.match(releaseScript, /want="\$\(tr -d '\[:space:\]' < "\$SHA_FILE"\)"/);
  assert.match(releaseScript, /have="\$\(sha256sum "\$TARBALL" \| cut -d' ' -f1\)"/);
  assert.match(releaseScript, /\[ "\$want" != "\$have" \]/);

  assert.ok(statSync(join(handoffRoot, "run-on-mac.command")).mode & 0o111);
  assert.ok(statSync(join(handoffRoot, "stop-app.command")).mode & 0o111);
});

test("Native macOS handoff documents the primary no-Docker package", () => {
  const readmePath = join(nativeHandoffRoot, "README.md");
  assert.equal(existsSync(readmePath), true, "release/PediatricSchedulerMac/README.md");

  const readme = readFileSync(readmePath, "utf8");
  assert.match(readme, /primary desktop handoff/i);
  assert.match(readme, /PediatricScheduler-macOS\.zip/);
  assert.match(readme, /do not need Docker, Node, npm, Python, Git, or the source code/i);
  assert.match(readme, /right-click `Pediatric Scheduler\.app` and choose Open/i);
  assert.match(readme, /127\.0\.0\.1/);
  assert.match(readme, /Application Support\/PediatricScheduler\/scheduler-state\.json/);
  assert.match(readme, /PediatricScheduler-macOS\.SHA256\.txt/);
  assert.match(readme, /PediatricScheduler-macOS-MANIFEST\.json/);

  const buildScript = readFileSync(join(appRoot, "script", "build_and_run.sh"), "utf8");
  assert.match(buildScript, /NATIVE_PACKAGE_SHA="\$NATIVE_PACKAGE_DIR\/PediatricScheduler-macOS\.SHA256\.txt"/);
  assert.match(buildScript, /NATIVE_PACKAGE_MANIFEST="\$NATIVE_PACKAGE_DIR\/PediatricScheduler-macOS-MANIFEST\.json"/);
  assert.match(buildScript, /NATIVE_RELEASE_README_SOURCE="\$ROOT_DIR\/release\/PediatricSchedulerMac\/README\.md"/);
  assert.match(buildScript, /shasum -a 256 "\$NATIVE_PACKAGE_ZIP"/);
  assert.match(buildScript, /cp "\$NATIVE_RELEASE_README_SOURCE" "\$NATIVE_PACKAGE_README"/);
  assert.match(buildScript, /"customerRequirements"/);
});
