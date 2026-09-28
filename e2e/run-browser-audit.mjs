#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST_DIR = join(ROOT, "dist");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForHealth(port, processRef) {
  const deadline = Date.now() + 20_000;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`backend exited before health check passed (code ${processRef.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Server still starting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findChrome() {
  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const probe = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  }
  for (const appPath of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (existsSync(appPath)) return appPath;
  }
  throw new Error("No Chrome or Chromium executable found on PATH.");
}

function runChrome(chrome, args) {
  const result = spawnSync(chrome, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${basename(chrome)} failed with status ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function setResult(results, id, status, detail, artifact = "") {
  results.push({ id, status, detail, artifact });
}

function writeArtifacts(results, resultsDir, runStamp, health, serverLogPath) {
  const mdPath = join(resultsDir, `browser-audit-${runStamp}.md`);
  const jsonPath = join(resultsDir, `browser-audit-${runStamp}.json`);

  writeFileSync(jsonPath, JSON.stringify({ runAt: runStamp, health, results }, null, 2), "utf8");

  const lines = [
    "# Scheduler Browser Audit",
    "",
    `- Run at: ${runStamp}`,
    `- Backend health: ${health.name} ${health.version}`,
    `- Backend log: \`${serverLogPath}\``,
    "",
    "| ID | Status | Detail | Artifact |",
    "| --- | --- | --- | --- |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.status} | ${result.detail.replaceAll("|", "\\|")} | ${result.artifact ? `\`${result.artifact}\`` : "-"} |`,
    );
  }
  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { mdPath, jsonPath };
}

async function main() {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error("dist/index.html is missing. Run npm run build before the browser audit.");
  }

  const resultsDir = resolve(ROOT, argValue("--results-dir", "verification/results"));
  mkdirSync(resultsDir, { recursive: true });
  const runStamp = stamp();
  const tmpRoot = mkdtempSync(join(tmpdir(), "pedi-scheduler-browser-audit-"));
  const serverLogPath = join(resultsDir, `browser-audit-server-${runStamp}.log`);
  const domPath = join(resultsDir, `browser-audit-${runStamp}.html`);
  const screenshotPath = join(resultsDir, `browser-audit-${runStamp}.png`);
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/`;

  const backend = spawn("backend_py/.venv/bin/python", ["-m", "backend_py.run"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PEDI_SCHEDULER_BIND_HOST: "127.0.0.1",
      PEDI_SCHEDULER_DATA_DIR: join(tmpRoot, "data"),
      PEDI_SCHEDULER_STATIC_DIR: DIST_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const serverLog = [];
  backend.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
  backend.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));

  const results = [];
  try {
    const health = await waitForHealth(port, backend);
    const chrome = findChrome();
    const userDataDir = join(tmpRoot, "chrome");

    const dump = runChrome(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1440,1000",
      "--virtual-time-budget=5000",
      "--dump-dom",
      url,
    ]);
    writeFileSync(domPath, dump.stdout, "utf8");

    runChrome(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${join(tmpRoot, "chrome-shot")}`,
      "--window-size=1440,1000",
      "--virtual-time-budget=5000",
      `--screenshot=${screenshotPath}`,
      url,
    ]);

    const dom = readFileSync(domPath, "utf8");
    setResult(
      results,
      "T-SCH-BROWSER-001",
      dom.includes("Pediatric Neurology") && dom.includes("Planning Grid") && dom.includes("Configuration") ? "PASS" : "FAIL",
      // "Block Setup" was a top-level page pre-redesign; the 2026-05-28 nav
      // redesign demoted it to a Settings sub-tab that only renders when Settings
      // is the active page, so it is (correctly) absent from the Dashboard boot
      // DOM. Assert real top-level sidebar destinations instead.
      "App shell renders the scheduler brand and primary navigation.",
      domPath,
    );
    setResult(
      results,
      "T-SCH-BROWSER-002",
      /data-theme="dark"/.test(dom) && dom.includes("Saved in app data") ? "PASS" : "FAIL",
      "Default dark theme and local-save status are visible after React hydrates.",
      domPath,
    );
    setResult(
      results,
      "T-SCH-BROWSER-003",
      existsSync(screenshotPath) ? "PASS" : "FAIL",
      "Headless Chrome captured a durable UI screenshot.",
      screenshotPath,
    );

    writeFileSync(serverLogPath, serverLog.join(""), "utf8");
    const artifacts = writeArtifacts(results, resultsDir, runStamp, health, serverLogPath);
    console.log(`Wrote ${artifacts.mdPath}`);
    console.log(`Wrote ${artifacts.jsonPath}`);
    process.exitCode = results.every((result) => result.status === "PASS") ? 0 : 1;
  } finally {
    if (backend.exitCode === null) {
      backend.kill("SIGTERM");
      await sleep(250);
      if (backend.exitCode === null) backend.kill("SIGKILL");
    }
    writeFileSync(serverLogPath, serverLog.join(""), "utf8");
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
