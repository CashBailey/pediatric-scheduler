import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { createInitialState, serializeState } from "../shared/scheduler/scheduler.js";
import { isBackendStateAuthoritative } from "../src/storage.js";

const appRoot = new URL("..", import.meta.url).pathname;
const ctl = join(appRoot, "scripts", "schedulerctl.mjs");

function tempDataDir() {
  return mkdtempSync(join(tmpdir(), "schedulerctl-test-"));
}

function runCtl(dataDir, args) {
  const result = spawnSync(
    process.execPath,
    [ctl, "--data-dir", dataDir, ...args],
    { cwd: appRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`schedulerctl failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function readState(dataDir) {
  return JSON.parse(readFileSync(join(dataDir, "scheduler-state.json"), "utf8"));
}

function runProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ctl, ...args], { cwd: appRoot, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`schedulerctl timed out: ${args.join(" ")}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

test("schedulerctl help exits successfully", () => {
  const result = spawnSync(process.execPath, [ctl, "--help"], { cwd: appRoot, encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test("schedulerctl state show reads the shared scheduler state shape", () => {
  const dataDir = tempDataDir();

  const result = runCtl(dataDir, ["state", "show", "--json"]);
  const state = JSON.parse(result.stdout);

  assert.equal(state.version, 2);
  assert.equal(state.serviceBlocks.length, 1);
  assert.deepEqual(state.rotators, []);
});

test("schedulerctl block add persists a new active service block", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, [
    "block",
    "add",
    "--name",
    "July 2026",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
  ]);
  const state = readState(dataDir);
  const block = state.serviceBlocks.find((item) => item.name === "July 2026");

  assert.ok(block);
  assert.equal(block.startDate, "2026-07-01");
  assert.equal(block.endDate, "2026-07-31");
  assert.equal(state.activeBlockId, block.id);
  assert.equal(isBackendStateAuthoritative(state), true);
});

test("schedulerctl block use, update, and delete round-trip by name and id", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, ["block", "add", "--name", "July 2026", "--start", "2026-07-01", "--end", "2026-07-31"]);
  runCtl(dataDir, ["block", "add", "--name", "August 2026", "--start", "2026-08-01", "--end", "2026-08-31"]);
  runCtl(dataDir, ["block", "use", "--name", "July 2026"]);
  runCtl(dataDir, ["block", "update", "--block", "July 2026", "--status", "Final", "--name", "July Final"]);
  let state = readState(dataDir);
  const july = state.serviceBlocks.find((block) => block.name === "July Final");
  const august = state.serviceBlocks.find((block) => block.name === "August 2026");

  assert.ok(july);
  assert.ok(august);
  assert.equal(july.status, "Final");
  assert.equal(state.activeBlockId, july.id);

  runCtl(dataDir, ["block", "use", "--id", august.id]);
  runCtl(dataDir, ["block", "delete", "--id", july.id]);
  state = readState(dataDir);

  assert.equal(state.serviceBlocks.some((block) => block.id === july.id), false);
  assert.equal(state.activeBlockId, august.id);
});

test("schedulerctl rotator add and assign range update the same persisted state", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, [
    "block",
    "add",
    "--name",
    "July 2026",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
  ]);
  runCtl(dataDir, [
    "rotator",
    "add",
    "--name",
    "Drew Quinn",
    "--program",
    "UT Pediatrics",
    "--level",
    "PGY-2",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
    "--day-off",
    "Sunday,Monday",
    "--unavailable",
    "2026-07-10:2026-07-12:Conference",
  ]);
  runCtl(dataDir, [
    "assign",
    "range",
    "--rotator",
    "Drew Quinn",
    "--from",
    "2026-07-01",
    "--to",
    "2026-07-03",
    "--phase",
    "inpatient",
  ]);

  const state = readState(dataDir);
  const rotator = state.rotators.find((item) => item.fullName === "Drew Quinn");
  assert.ok(rotator);
  assert.deepEqual(rotator.dayOff, ["Sunday", "Monday"]);
  assert.deepEqual(rotator.unavailableRanges, [
    { start: "2026-07-10", end: "2026-07-12", label: "Conference" },
  ]);
  assert.equal(state.inpatientAssignments.length, 3);
  assert.deepEqual(
    state.inpatientAssignments.map((item) => item.date),
    ["2026-07-01", "2026-07-02", "2026-07-03"],
  );
  assert.ok(state.inpatientAssignments.every((item) => item.rotatorId === rotator.id));
});

test("schedulerctl rotator update/delete and single-day assignment commands share persisted state", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, ["block", "add", "--name", "July 2026", "--start", "2026-07-01", "--end", "2026-07-31"]);
  runCtl(dataDir, [
    "rotator",
    "add",
    "--name",
    "Drew Quinn",
    "--program",
    "UT Pediatrics",
    "--level",
    "PGY-2",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
  ]);
  runCtl(dataDir, [
    "rotator",
    "update",
    "--rotator",
    "Drew Quinn",
    "--level",
    "PGY-3",
    "--continuity-clinic",
    "Wednesday AM",
    "--day-off",
    "Sunday",
    "--unavailable",
    "2026-07-10:2026-07-10:Vacation",
    "--unavailable",
    "2026-07-20:2026-07-21",
  ]);
  runCtl(dataDir, ["assign", "inpatient", "--rotator", "Drew Quinn", "--date", "2026-07-02", "--role", "Team senior"]);
  runCtl(dataDir, [
    "assign",
    "outpatient",
    "--rotator",
    "Drew Quinn",
    "--date",
    "2026-07-03",
    "--period",
    "AM",
    "--clinic",
    "Continuity Clinic",
    "--provider",
    "Alder",
  ]);
  let state = readState(dataDir);
  const rotator = state.rotators.find((item) => item.fullName === "Drew Quinn");

  assert.equal(rotator.level, "PGY-3");
  assert.equal(rotator.continuityClinic, "Wednesday AM");
  assert.deepEqual(rotator.dayOff, ["Sunday"]);
  assert.deepEqual(rotator.unavailableRanges, [
    { start: "2026-07-10", end: "2026-07-10", label: "Vacation" },
    { start: "2026-07-20", end: "2026-07-21" },
  ]);
  assert.equal(state.inpatientAssignments.length, 1);
  assert.equal(state.outpatientSessions.length, 1);

  runCtl(dataDir, ["rotator", "delete", "--rotator", rotator.id]);
  state = readState(dataDir);
  assert.equal(state.rotators.length, 0);
  assert.equal(state.inpatientAssignments.length, 0);
  assert.equal(state.outpatientSessions.length, 0);
});

test("schedulerctl assign range supports outpatient, off, and clear phases", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, ["block", "add", "--name", "July 2026", "--start", "2026-07-01", "--end", "2026-07-31"]);
  runCtl(dataDir, [
    "rotator",
    "add",
    "--name",
    "Drew Quinn",
    "--program",
    "UT Pediatrics",
    "--level",
    "PGY-2",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
  ]);
  runCtl(dataDir, ["assign", "range", "--rotator", "Drew Quinn", "--from", "2026-07-06", "--to", "2026-07-07", "--phase", "outpatient"]);
  runCtl(dataDir, ["assign", "range", "--rotator", "Drew Quinn", "--from", "2026-07-08", "--to", "2026-07-08", "--phase", "off"]);
  let state = readState(dataDir);

  assert.equal(state.outpatientSessions.length, 4);
  assert.equal(state.inpatientAssignments.some((item) => item.date === "2026-07-08" && item.role === "Off"), true);

  runCtl(dataDir, ["assign", "range", "--rotator", "Drew Quinn", "--from", "2026-07-06", "--to", "2026-07-08", "--phase", "clear"]);
  state = readState(dataDir);
  assert.equal(state.outpatientSessions.length, 0);
  assert.equal(state.inpatientAssignments.length, 0);
});

test("schedulerctl draft generate persists draft-created assignments", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, ["block", "add", "--name", "July 2026", "--start", "2026-07-06", "--end", "2026-07-10"]);
  runCtl(dataDir, [
    "rotator",
    "add",
    "--name",
    "Drew Quinn",
    "--program",
    "Other",
    "--level",
    "PGY-2",
    "--start",
    "2026-07-06",
    "--end",
    "2026-07-10",
  ]);
  const result = runCtl(dataDir, ["draft", "generate"]);
  const state = readState(dataDir);

  assert.match(result.stdout, /Generated draft schedule/);
  assert.equal(
    state.inpatientAssignments.filter((item) => item.source === "Auto-Draft").length,
    5,
  );
  assert.equal(isBackendStateAuthoritative(state), true);
});

test("schedulerctl read-only reports expose conflicts and daily report evidence", () => {
  const dataDir = tempDataDir();

  runCtl(dataDir, ["block", "add", "--name", "July 2026", "--start", "2026-07-01", "--end", "2026-07-31"]);
  runCtl(dataDir, [
    "rotator",
    "add",
    "--name",
    "Drew Quinn",
    "--program",
    "UT Pediatrics",
    "--level",
    "PGY-2",
    "--start",
    "2026-07-01",
    "--end",
    "2026-07-31",
  ]);
  runCtl(dataDir, ["assign", "inpatient", "--rotator", "Drew Quinn", "--date", "2026-07-02", "--role", "Resident"]);
  runCtl(dataDir, ["assign", "outpatient", "--rotator", "Drew Quinn", "--date", "2026-07-02", "--period", "AM"]);

  const conflicts = JSON.parse(runCtl(dataDir, ["conflicts", "list", "--json", "--date", "2026-07-02"]).stdout);
  assert.ok(conflicts.some((item) => item.type === "double-booked"));

  const report = runCtl(dataDir, ["report", "daily", "--date", "2026-07-02"]).stdout;
  assert.match(report, /Daily Team Report/);
  assert.match(report, /Resident: Drew Quinn/);
});

test("schedulerctl state validate rejects invalid persisted state before mutation", () => {
  const dataDir = tempDataDir();
  writeFileSync(join(dataDir, "scheduler-state.json"), JSON.stringify({ version: 2 }), "utf8");

  const validate = spawnSync(process.execPath, [ctl, "--data-dir", dataDir, "state", "validate"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  const mutate = spawnSync(process.execPath, [ctl, "--data-dir", dataDir, "block", "add", "--name", "July", "--start", "2026-07-01", "--end", "2026-07-31"], {
    cwd: appRoot,
    encoding: "utf8",
  });

  assert.notEqual(validate.status, 0);
  assert.match(validate.stderr, /validation|state/i);
  assert.notEqual(mutate.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "scheduler-state.json"), "utf8")), { version: 2 });
});

test("schedulerctl refuses off-machine API targets", () => {
  const result = spawnSync(
    process.execPath,
    [ctl, "--api", "https://example.com", "state", "show"],
    { cwd: appRoot, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loopback/i);
});

test("schedulerctl can control state through the loopback scheduler API", async () => {
  let state = createInitialState();
  let postCount = 0;
  let lastPostBody = "";
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/scheduler/state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }

    if (request.method === "POST" && request.url === "/api/scheduler/state") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      lastPostBody = Buffer.concat(chunks).toString("utf8");
      state = JSON.parse(lastPostBody);
      postCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    const result = await runProcess(
      [
        "--api",
        `http://127.0.0.1:${port}`,
        "block",
        "add",
        "--name",
        "API July 2026",
        "--start",
        "2026-07-01",
        "--end",
        "2026-07-31",
      ],
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(postCount, 1);
    assert.ok(state.serviceBlocks.some((block) => block.name === "API July 2026"));
    assert.equal(lastPostBody, serializeState(state));
    assert.equal(isBackendStateAuthoritative(state), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Command-parity surface added 2026-07: every shared command the native
// UI can dispatch is now reachable from the CLI. These tests assert real
// state effects (not just exit codes) for each new subcommand.

function seedBlockAndRotators(dataDir) {
  runCtl(dataDir, ["block", "add", "--name", "Parity Block", "--start", "2026-07-06", "--end", "2026-08-02"]);
  runCtl(dataDir, ["rotator", "add", "--name", "Amy One", "--program", "Pediatric Neurology", "--level", "PGY-2", "--start", "2026-07-06", "--end", "2026-08-02"]);
  runCtl(dataDir, ["rotator", "add", "--name", "Bob Two", "--program", "Pediatric Neurology", "--level", "PGY-3", "--start", "2026-07-06", "--end", "2026-08-02"]);
}

test("schedulerctl rotator delete accepts several --rotator flags for bulk delete", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  const result = runCtl(dataDir, ["rotator", "delete", "--rotator", "Amy One", "--rotator", "Bob Two"]);

  assert.match(result.stdout, /Deleted 2 rotators\./);
  assert.equal(readState(dataDir).rotators.length, 0);
});

test("schedulerctl roster dedupe removes duplicate rotators by name", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  // Seed a duplicate directly in state (the CLI itself refuses obvious dupes
  // only at the roster-import layer, so write the file).
  const state = readState(dataDir);
  state.rotators.push({ ...state.rotators[0], id: "rot-amy-dupe" });
  writeFileSync(join(dataDir, "scheduler-state.json"), serializeState(state), "utf8");

  const result = runCtl(dataDir, ["roster", "dedupe"]);

  assert.match(result.stdout, /Removed 1 duplicate rotators\./);
  assert.equal(readState(dataDir).rotators.length, 2);
});

test("schedulerctl inpatient drop, delete, and resolve-fellow mutate assignments", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  runCtl(dataDir, ["rotator", "add", "--name", "Fay Fellow", "--program", "Pediatric Neurology", "--level", "Fellow", "--start", "2026-07-06", "--end", "2026-08-02"]);

  runCtl(dataDir, ["inpatient", "drop", "--rotator", "Amy One", "--date", "2026-07-07"]);
  let state = readState(dataDir);
  const dropped = state.inpatientAssignments.find((item) => item.date === "2026-07-07");
  assert.ok(dropped, "inpatient drop must create an assignment");

  runCtl(dataDir, ["inpatient", "delete", "--assignment", dropped.id]);
  state = readState(dataDir);
  assert.equal(state.inpatientAssignments.length, 0);

  const resolved = runCtl(dataDir, ["inpatient", "resolve-fellow", "--rotator", "Fay Fellow", "--date", "2026-07-08", "--date", "2026-07-09"]);
  assert.match(resolved.stdout, /Resolved 2 fellow assignments/);
  state = readState(dataDir);
  const fellowRows = state.inpatientAssignments.filter((item) => item.role === "Fellow");
  assert.equal(fellowRows.length, 2);
});

test("schedulerctl outpatient delete removes a session by id", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  runCtl(dataDir, ["assign", "outpatient", "--rotator", "Amy One", "--date", "2026-07-07", "--period", "AM"]);
  const session = readState(dataDir).outpatientSessions[0];
  assert.ok(session);

  runCtl(dataDir, ["outpatient", "delete", "--session", session.id]);

  assert.equal(readState(dataDir).outpatientSessions.length, 0);
});

test("schedulerctl methodist auto runs the shared command against the active block", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  const result = runCtl(dataDir, ["methodist", "auto"]);

  // No Methodist rotators seeded: the command must still execute the real
  // handler and report its no-op result rather than failing dispatch.
  assert.match(result.stdout, /No Methodist rotators are in the roster\./);
});

test("schedulerctl clinic assign and delete round-trip a clinic assignment", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  // 2026-07-06 is a Monday. Make Amy strictly outpatient that day and give
  // Alder a recurring Monday AM clinic so a real occurrence exists.
  runCtl(dataDir, ["assign", "range", "--rotator", "Amy One", "--from", "2026-07-06", "--to", "2026-07-06", "--phase", "outpatient"]);
  // Alder is one of the default attendings, so patch rather than add.
  runCtl(dataDir, ["attending", "update", "--name", "Alder", "--patch", JSON.stringify({
    recurringClinics: [{ weekday: "Monday", session: "AM", clinicName: "General Neuro", capacity: 2 }],
    oneOffDates: [],
  })]);
  const occurrenceId = "clinic-occurrence::alder::0-monday-AM-general-neuro::2026-07-06::AM";

  runCtl(dataDir, ["clinic", "assign", "--occurrence", occurrenceId, "--rotator", "Amy One", "--date", "2026-07-06", "--session", "AM"]);
  let state = readState(dataDir);
  assert.equal(state.clinicAssignments.length, 1);
  assert.equal(state.clinicAssignments[0].clinicOccurrenceId, occurrenceId);
  assert.equal(state.clinicAssignments[0].session, "AM");

  runCtl(dataDir, ["clinic", "delete", "--assignment", state.clinicAssignments[0].id]);
  assert.equal(readState(dataDir).clinicAssignments.length, 0);
});

test("schedulerctl attending and expected-source commands mutate settings state", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  runCtl(dataDir, ["attending", "add", "--name", "Dr. New"]);
  runCtl(dataDir, ["attending", "update", "--name", "Dr. New", "--patch", JSON.stringify({
    recurringClinics: [{ weekday: "Tuesday", session: "PM", clinicName: "TSC" }],
  })]);
  runCtl(dataDir, ["expected-source", "add", "--program", "Adult Neurology Extra"]);
  let state = readState(dataDir);
  const attending = state.attendings.find((item) => item.name === "Dr. New");
  assert.ok(attending);
  assert.equal(attending.recurringClinics[0].clinicName, "TSC");
  assert.ok(state.expectedSourcePrograms.includes("Adult Neurology Extra"));

  runCtl(dataDir, ["attending", "remove", "--name", "Dr. New"]);
  runCtl(dataDir, ["expected-source", "remove", "--program", "Adult Neurology Extra"]);
  state = readState(dataDir);
  assert.ok(!state.attendings.some((item) => item.name === "Dr. New"));
  assert.ok(!state.expectedSourcePrograms.includes("Adult Neurology Extra"));
});

test("schedulerctl source add and delete manage source records", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  runCtl(dataDir, ["source", "add", "--file-name", "manual-notes.txt", "--program", "Other", "--file-type", "manual"]);
  let state = readState(dataDir);
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].fileName, "manual-notes.txt");
  assert.equal(state.sources[0].status, "Reviewed");

  runCtl(dataDir, ["source", "delete", "--source", "manual-notes.txt"]);
  assert.equal(readState(dataDir).sources.length, 0);
});

test("schedulerctl rules patch and poster patch apply validated patches", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  runCtl(dataDir, ["rules", "patch", "--patch", JSON.stringify({ maxConsecutiveInpatientDays: 5 })]);
  runCtl(dataDir, ["poster", "patch", "--patch", JSON.stringify({ chief: "Dr. Chief Example" })]);

  const state = readState(dataDir);
  assert.equal(state.rules.maxConsecutiveInpatientDays, 5);
  assert.equal(state.posterSettings.chief, "Dr. Chief Example");
  // Untouched poster defaults survive the merge.
  assert.ok(state.posterSettings.programName.length > 0);
});

test("schedulerctl rules patch rejects malformed JSON without touching state", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  const before = JSON.stringify(readState(dataDir));

  const result = spawnSync(
    process.execPath,
    [ctl, "--data-dir", dataDir, "rules", "patch", "--patch", "{not json"],
    { cwd: appRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--patch must be a JSON object/);
  assert.equal(JSON.stringify(readState(dataDir)), before);
});

test("schedulerctl grid show prints the planning-grid projection", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);

  const summary = runCtl(dataDir, ["grid", "show"]);
  assert.match(summary.stdout, /2 rows x 28 dates/);

  const json = runCtl(dataDir, ["grid", "show", "--json"]);
  const data = JSON.parse(json.stdout);
  assert.equal(data.grid.rows.length, 2);
  assert.equal(data.grid.dates.length, 28);
  assert.equal(data.effectiveStartDate, "2026-07-06");
});

test("schedulerctl export package emits the shared export payload", () => {
  const dataDir = tempDataDir();
  seedBlockAndRotators(dataDir);
  runCtl(dataDir, ["assign", "inpatient", "--rotator", "Amy One", "--date", "2026-07-07"]);

  const manifestOnly = runCtl(dataDir, ["export", "package"]);
  const manifest = JSON.parse(manifestOnly.stdout);
  assert.ok(manifest.exportVersion >= 1);

  const full = runCtl(dataDir, ["export", "package", "--json"]);
  const pkg = JSON.parse(full.stdout);
  assert.ok(Array.isArray(pkg.roster));
  assert.ok(typeof pkg.rosterCsv === "string");
  assert.ok(pkg.schedulePackage, "package must embed the full schedule package payload");
});
