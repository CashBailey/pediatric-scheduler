import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const appRoot = new URL("..", import.meta.url).pathname;
const srcRoot = join(appRoot, "src");
const sharedRoot = join(appRoot, "shared");
// The Python backend is first-party product source and must obey the same
// no-off-machine-communication policy as the JS. The same destination
// regexes apply unchanged — they match URLs/IPs, not language syntax.
const backendPyRoot = join(appRoot, "backend_py");

// Directories never scanned: third-party dependencies (which legitimately
// contain external URLs) and VCS/cache noise. backend_py/.venv is the
// Python equivalent of node_modules and must be excluded for the same
// reason.
const EXCLUDED_DIRS = new Set([".venv", "node_modules", ".git", "__pycache__"]);

// Policy: forbid OFF-MACHINE communication. A localhost-only backend is
// allowed by the spec (HighLevelDesignSpecification §0.1) even though one
// isn't shipping yet — so banning `fetch(`, `XMLHttpRequest`, `WebSocket`
// or the literal string `http://` outright would over-restrict and block a
// future local helper. The patterns below match destinations that
// definitely leave the machine: any http(s)/ws(s) URL whose host isn't
// 127.0.0.1 / [::1] / localhost / 0.0.0.0, raw public IPv4 in URL
// position, and `navigator.sendBeacon` (which can only target a remote
// endpoint by spec).
const forbidden = [
  /(?:https?|wss?):\/\/(?!(?:127\.0\.0\.1|\[::1\]|localhost|0\.0\.0\.0)(?:[:/]|$))[A-Za-z0-9.\-]+/i,
  /\/\/(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/,
  /\bnavigator\.sendBeacon\b/
];

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    // Match on basename, so an excluded dir (e.g. .venv) is skipped
    // wherever it appears in the tree, not just at the root.
    if (EXCLUDED_DIRS.has(entry)) return [];
    const path = join(dir, entry);
    const stat = statSync(path);
    return stat.isDirectory() ? walkFiles(path) : [path];
  });
}

test("Application source (frontend + backend + shared) does not contain off-machine communication primitives", () => {
  const sourceFiles = [
    ...walkFiles(srcRoot),
    ...walkFiles(sharedRoot),
    ...walkFiles(backendPyRoot)
  ].filter((file) => /\.(js|jsx|mjs|cjs|css|py)$/.test(file));
  assert.ok(sourceFiles.length > 0, "expected source files");

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(content), false, `${file} matched ${pattern}`);
    }
  }
});

test("handoff docs explicitly state local-only runtime", () => {
  const readme = readFileSync(join(appRoot, "README.md"), "utf8");
  const nativeReadme = readFileSync(join(appRoot, "release", "PediatricSchedulerMac", "README.md"), "utf8");
  assert.match(readme, /local-only/i);
  assert.match(readme, /No off-machine communication/i);
  assert.match(readme, /primary customer release is the native macOS package/i);
  assert.match(readme, /Docker Desktop/i);
  assert.match(nativeReadme, /local-only/i);
  assert.match(nativeReadme, /does not contact a remote server/i);
  assert.match(nativeReadme, /do not need Docker, Node, npm, Python, Git, or the source code/i);
});
