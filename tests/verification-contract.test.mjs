import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const appRoot = new URL("..", import.meta.url).pathname;

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function parseSharedCommandHandlers(source) {
  const registry = source.match(
    /const COMMAND_HANDLERS = Object\.freeze\(\{(?<entries>[\s\S]*?)\n\}\);/
  );
  assert.ok(registry, "shared command handler registry should be present");
  return new Map(
    [...registry.groups.entries.matchAll(/^\s+"([^"]+)":\s+(command\w+),$/gm)].map(
      ([, type, handler]) => [type, handler]
    )
  );
}

test("project exposes a single CLI-first verification entrypoint", () => {
  const makefile = read("Makefile");
  const packageJson = JSON.parse(read("package.json"));
  const projectVerifier = read("scripts/run_project_verification.sh");

  assert.match(makefile, /^verify-project:/m);
  assert.match(makefile, /scripts\/run_project_verification\.sh/);
  assert.equal(packageJson.scripts["verify:project"], "bash scripts/run_project_verification.sh");
  assert.equal(packageJson.scripts["verify:cli"], "backend_py/.venv/bin/python scripts/run_cli_probes.py");
  assert.equal(packageJson.scripts["verify:native"], "bash script/build_and_run.sh --verify");
  assert.equal(packageJson.scripts["package:native"], "bash script/build_and_run.sh --package");
  assert.equal(packageJson.scripts["e2e:audit"], "node e2e/run-browser-audit.mjs");
  assert.equal(packageJson.scripts["e2e:native"], "node e2e/run-native-ui-audit.mjs");
  assert.equal(packageJson.scripts.ctl, "node scripts/schedulerctl.mjs");
  assert.equal(packageJson.bin.schedulerctl, "scripts/schedulerctl.mjs");

  assert.match(makefile, /^native-app:/m);
  assert.match(makefile, /^verify-native:/m);
  assert.match(makefile, /^package-native:/m);
  assert.match(makefile, /^verify-native-ui:/m);
  assert.match(makefile, /script\/build_and_run\.sh --verify/);
  assert.match(makefile, /script\/build_and_run\.sh --package/);
  assert.match(makefile, /node e2e\/run-native-ui-audit\.mjs/);

  assert.match(projectVerifier, /run_step "native-ui-audit" "Native GUI" "Native UI Audit" "npm run e2e:native -- --results-dir verification\/results"/);
  assert.match(projectVerifier, /run_step "native-package" "Native release" "Native Release Package" "npm run package:native"/);
  assert.match(projectVerifier, /Native UI audit artifacts/);
  assert.match(projectVerifier, /PediatricScheduler-macOS\.zip/);
});

test("verification scripts exist and are executable", () => {
  for (const relativePath of [
    "scripts/run_project_verification.sh",
    "scripts/run_cli_probes.py",
    "scripts/schedulerctl.mjs",
    "e2e/run-browser-audit.mjs",
    "e2e/run-native-ui-audit.mjs",
  ]) {
    const absolutePath = join(appRoot, relativePath);
    assert.equal(existsSync(absolutePath), true, relativePath);
    assert.ok(statSync(absolutePath).mode & 0o111, `${relativePath} should be executable`);
  }
});

test("legacy Docker handoff verifies package hash when the tarball is present", () => {
  const handoffContract = read("tests/handoff-contract.test.mjs");
  const releaseScript = read("scripts/build-release.sh");
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");

  assert.match(handoffContract, /createHash\("sha256"\)/);
  assert.match(handoffContract, /IMAGE_SHA256\.txt should match the Docker tarball/);
  assert.match(handoffContract, /scripts", "build-release\.sh"/);
  assert.match(releaseScript, /want="\$\(tr -d '\[:space:\]' < "\$SHA_FILE"\)"/);
  assert.match(releaseScript, /have="\$\(sha256sum "\$TARBALL" \| cut -d' ' -f1\)"/);
  assert.match(releaseScript, /\[ "\$want" != "\$have" \]/);
  assert.match(requirements, /\| PNS-STALE-007 \| Handoff-test comment implies tarball hash verification\. \| Resolved:/);
});

test("verification documentation separates browser, CLI, and manual scope", () => {
  for (const relativePath of [
    "browser_test_README.md",
    "docs/PROJECT_VERIFICATION.md",
    "docs/VERIFICATION_MAP.md",
    "docs/REGRESSION_PINBOARD.md"
  ]) {
    assert.equal(existsSync(join(appRoot, relativePath)), true, relativePath);
  }

  const projectVerification = read("docs/PROJECT_VERIFICATION.md");
  assert.match(projectVerification, /Layer A/i);
  assert.match(projectVerification, /Layer B/i);
  assert.match(projectVerification, /Browser-auditable/i);
  assert.match(projectVerification, /CLI-backed/i);
  assert.match(projectVerification, /Manual-only/i);

  const map = read("docs/VERIFICATION_MAP.md");
  assert.match(map, /T-SCH-BROWSER-001/);
  assert.match(map, /T-SCH-CLI-001/);
  assert.match(map, /T-SCH-NATIVE-001/);
  assert.match(map, /T-SCH-NATIVE-011/);
  assert.match(map, /T-SCH-NATIVE-012/);
  assert.match(map, /T-SCH-NATIVE-013/);
  assert.match(map, /T-SCH-NATIVE-019/);
  assert.match(map, /T-SCH-NATIVE-020/);
  assert.match(map, /T-SCH-NATIVE-021/);
  assert.match(map, /T-SCH-NATIVE-022/);
  assert.match(map, /T-SCH-NATIVE-023/);
  assert.match(map, /T-SCH-NATIVE-024/);
  assert.match(map, /T-SCH-NATIVE-026/);
  assert.match(map, /T-SCH-CMD-001/);
  assert.match(map, /T-SCH-PARITY-001/);
  assert.match(map, /shared command\/CLI\/GUI parity/i);
  assert.match(map, /artifact/i);
});

test("shared JS and Python command dispatch stay in parity", () => {
  const sharedCommands = read("shared/scheduler/commands.js");
  const backendCommands = read("backend_py/domain/commands.py");
  const jsCommands = new Set(parseSharedCommandHandlers(sharedCommands).keys());
  const pythonCommands = new Set(
    [...backendCommands.matchAll(/^\s+"([^"]+)":\s+_cmd_/gm)].map((match) => match[1])
  );
  const allowedPythonOnly = new Set(["export.pdfs", "export.word", "export.coordinatorBundle"]);

  assert.deepEqual(
    [...jsCommands].filter((command) => !pythonCommands.has(command)).sort(),
    []
  );
  assert.deepEqual(
    [...pythonCommands]
      .filter((command) => !jsCommands.has(command) && !allowedPythonOnly.has(command))
      .sort(),
    []
  );
});

test("authority docs describe the native v0.26 product state", () => {
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");
  const hld = read("HighLevelDesignSpecification.md");
  const audit = read("AUDIT.md");

  for (const source of [requirements, hld]) {
    assert.match(source, /native SwiftUI macOS app/i);
    assert.match(source, /v0\.26\.0/);
    assert.match(source, /React\/Vite remains (?:the )?legacy browser\/Docker path/i);
    assert.match(source, /Coordinator DOCX import is shipped|Coordinator Word\/DOCX import is supported/i);
    assert.match(source, /native (?:routing\/focus|focus routing|conflict focus scroll-and-highlight)|conflict focus scroll-and-highlight is shipped in native|focus metadata is shipped/i);
    assert.doesNotMatch(source, /Current shipping product:\s*React web app v0\.22\.0/i);
    assert.doesNotMatch(source, /Current shipping architecture is React\/Vite frontend/i);
    assert.doesNotMatch(source, /Backend route contract \(Python\/FastAPI, v0\.22\.0\)/i);
    assert.doesNotMatch(source, /current React implementation risk/i);
    assert.doesNotMatch(source, /React owns the user interface/i);
    assert.doesNotMatch(source, /Browser `?localStorage`? is the primary/i);
    assert.doesNotMatch(source, /Customer release should run on Mac with Docker Desktop and the release folder only/i);
    assert.doesNotMatch(source, /Docker image target is `pedi-scheduler-react:0\.22\.0`/i);
    assert.doesNotMatch(source, /The current React product/i);
    assert.doesNotMatch(source, /Current React product:/i);
    assert.doesNotMatch(source, /The current customer deployment is a Docker Desktop release folder/i);
    assert.doesNotMatch(source, /DOCX import existed in Python but is not in React/i);
    assert.doesNotMatch(source, /Whether DOCX import matters for real source files/i);
  }

  assert.match(audit, /historical v0\.22\.0 audit/);
  assert.match(audit, /Superseded status note \(2026-07-06\)/);
  assert.match(audit, /native SwiftUI\s+macOS app v0\.26\.0/i);

  assert.match(hld, /Editable Word\/DOCX schedule, daily report, and roster\/legend handoff files/);
  assert.match(hld, /Word export: shipped in the native\/backend handoff path/);
  assert.match(hld, /Native\/backend Reports now builds editable Word\/DOCX schedule, daily-report, and roster\/legend handoff files/);
  assert.doesNotMatch(hld, /Word export: open \/ never built in React/);
  assert.doesNotMatch(hld, /\| Word export \| Planned\/requested \| Not built \| Never built \|/);
  assert.doesNotMatch(hld, /What are the exact expectations for Word, CSV, and Excel export\?/);
});

test("native desktop copy avoids implementation-facing backend language", () => {
  const root = read("macos/PediatricScheduler/View/RootView.swift");
  const backendController = read("macos/PediatricScheduler/Backend/BackendController.swift");
  const dashboard = read("macos/PediatricScheduler/View/DashboardView.swift");
  const settings = read("macos/PediatricScheduler/View/SettingsView.swift");
  const rosterReview = read("macos/PediatricScheduler/View/RosterImportReviewSheet.swift");
  const outpatient = read("macos/PediatricScheduler/View/OutpatientView.swift");

  assert.match(root, /Starting Scheduler/);
  assert.match(root, /Starting the local scheduling engine/);
  assert.match(root, /Scheduler engine couldn't start/);
  assert.doesNotMatch(root, /Starting the local backend|Launching the Python engine|127\.0\.0\.1/);

  assert.match(backendController, /Could not find the bundled scheduler engine\./);
  assert.match(backendController, /Another Scheduler engine is already running/);
  assert.doesNotMatch(backendController, /checkout|scheduler backend|Python backend did not become ready/);

  assert.match(dashboard, /Generate a draft for the active block, then review what still needs attention\./);
  assert.doesNotMatch(dashboard, /backend draft engine/);

  assert.match(settings, /Section\("Local Engine"\)/);
  assert.match(settings, /Runs only on this Mac/);
  assert.match(settings, /Reload schedule data/);
  assert.doesNotMatch(settings, /Section\("Backend"\)|Python · 127\.0\.0\.1|Reload from engine/);

  assert.match(rosterReview, /Adjust how roster columns map before applying this import\./);
  assert.doesNotMatch(rosterReview, /backend parser/);

  assert.match(outpatient, /Clinic not selected/);
});

test("native UI audit records process, window, runtime, and optional screenshot evidence", () => {
  const nativeAudit = read("e2e/run-native-ui-audit.mjs");
  const seedDemo = read("e2e/seed-demo-state.mjs");
  const buildScript = read("script/build_and_run.sh");
  const appSupport = read("macos/PediatricScheduler/Backend/AppSupport.swift");
  const rootView = read("macos/PediatricScheduler/View/RootView.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const projectVerification = read("docs/PROJECT_VERIFICATION.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(seedDemo, /--data-dir/);
  assert.match(seedDemo, /--profile/);
  assert.match(seedDemo, /scheduler-state\.json/);
  assert.match(seedDemo, /block-may-2026/);
  assert.match(seedDemo, /May 2026 Pediatric Neurology/);
  assert.match(seedDemo, /reports-final-handoff/);
  assert.match(seedDemo, /block-final-handoff-2026/);
  assert.match(seedDemo, /Final Handoff Week/);
  assert.match(seedDemo, /Riley Chen/);
  assert.match(seedDemo, /dashboard-draft-generation/);
  assert.match(seedDemo, /block-draft-generation-2026/);
  assert.match(seedDemo, /Draft Generation Week/);
  assert.match(seedDemo, /planning-edit-undo/);
  assert.match(seedDemo, /block-planning-edit-2026/);
  assert.match(seedDemo, /Planning Edit Week/);
  assert.match(seedDemo, /sources-roster-import/);
  assert.match(seedDemo, /block-source-import-2026/);
  assert.match(seedDemo, /Source Import Week/);
  assert.match(seedDemo, /expectedSourcePrograms: \["UT Pediatrics"\]/);
  assert.match(seedDemo, /rotators-edit/);
  assert.match(seedDemo, /block-rotators-edit-2026/);
  assert.match(seedDemo, /Rotators Edit Week/);
  assert.match(seedDemo, /outpatient-edit/);
  assert.match(seedDemo, /block-outpatient-edit-2026/);
  assert.match(seedDemo, /Outpatient Edit Week/);
  assert.match(seedDemo, /rot-outpatient-edit-1/);
  assert.match(seedDemo, /inpatient-edit/);
  assert.match(seedDemo, /block-inpatient-edit-2026/);
  assert.match(seedDemo, /Inpatient Edit Week/);
  assert.match(seedDemo, /rot-inpatient-edit-1/);
  assert.match(seedDemo, /clinics-edit/);
  assert.match(seedDemo, /block-clinics-edit-2027/);
  assert.match(seedDemo, /Clinics Edit Week/);
  assert.match(seedDemo, /rot-clinics-edit-1/);
  assert.match(seedDemo, /clinic-edit-monday-am/);
  assert.match(seedDemo, /fellows-resolve/);
  assert.match(seedDemo, /block-fellows-resolve-2027/);
  assert.match(seedDemo, /Fellows Resolve Week/);
  assert.match(seedDemo, /rot-fellows-resolve-1/);
  assert.match(seedDemo, /rot-fellows-resolve-2/);
  assert.match(seedDemo, /settings-edit/);
  assert.match(seedDemo, /block-settings-edit-2027/);
  assert.match(seedDemo, /Settings Edit Week/);
  assert.match(seedDemo, /Legacy Attending/);
  assert.match(seedDemo, /Maya Lopez/);
  assert.match(seedDemo, /Jules Nguyen/);
  assert.match(seedDemo, /Drew Quinn/);
  assert.match(seedDemo, /Noah Patel/);
  assert.match(seedDemo, /Sam Carter/);
  assert.match(seedDemo, /Dana Reyes/);

  assert.match(buildScript, /SCHEDULER_INITIAL_SCREEN/);
  assert.match(buildScript, /PEDI_SCHEDULER_INITIAL_SCREEN/);
  assert.match(buildScript, /SCHEDULER_DATA_DIR/);
  assert.match(buildScript, /PEDI_SCHEDULER_DATA_DIR/);
  assert.match(buildScript, /SCHEDULER_REPORTS_HANDOFF_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT/);
  assert.match(buildScript, /SCHEDULER_DASHBOARD_DRAFT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_METHODIST_AUTO_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_METHODIST_AUTO_AUDIT/);
  assert.match(buildScript, /SCHEDULER_PLANNING_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_PLANNING_EDIT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_SOURCES_IMPORT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_ROTATORS_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_OUTPATIENT_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_INPATIENT_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_CLINICS_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_CLINICS_EDIT_AUDIT/);
  assert.match(buildScript, /SCHEDULER_FELLOWS_RESOLVE_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT/);
  assert.match(buildScript, /SCHEDULER_SETTINGS_EDIT_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT/);
  assert.match(appSupport, /PEDI_SCHEDULER_DATA_DIR/);
  assert.match(appSupport, /UserDefaults\.standard\.string\(forKey: "PEDI_SCHEDULER_DATA_DIR"\)/);

  // Selection now lives on AppStore (screenSelection) so the app menu's
  // ⌘1–⌘9 shortcuts can drive navigation; the initial-screen resolver stays
  // in RootView.swift.
  assert.match(rootView, /static var initialSelection: Screen/);
  assert.match(rootView, /List\(Screen\.allCases, selection: \$store\.screenSelection\)/);
  assert.match(rootView, /PEDI_SCHEDULER_INITIAL_SCREEN/);
  assert.match(rootView, /writeScreenProbeIfReady/);
  assert.match(rootView, /NativeScreenProbe/);
  assert.match(rootView, /native-ui-screen\.json/);
  assert.match(rootView, /"screen": screen\.rawValue/);
  assert.match(rootView, /"phase": phaseLabel\(phase\)/);
  assert.match(planningGrid, /NativePlanningGridProbe/);
  assert.match(planningGrid, /native-ui-planning-grid\.json/);
  assert.match(planningGrid, /sectionCounts/);
  assert.match(planningGrid, /sampleRows/);

  assert.match(nativeAudit, /bash script\/build_and_run\.sh --verify/);
  assert.match(nativeAudit, /seed-demo-state\.mjs/);
  assert.match(nativeAudit, /--data-dir/);
  assert.match(nativeAudit, /native-ui-audit-data-\$\{runStamp\}/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Planning Grid"/);
  assert.match(nativeAudit, /SCHEDULER_DATA_DIR: dataDir/);
  assert.match(nativeAudit, /tell application id "\$\{APP_BUNDLE_ID\}" to activate/);
  assert.match(nativeAudit, /pgrep -x \$\{APP_PROCESS\}/);
  assert.match(nativeAudit, /count windows/);
  assert.match(nativeAudit, /native-ui-window\.json/);
  assert.match(nativeAudit, /native-ui-screen\.json/);
  assert.match(nativeAudit, /native-ui-planning-grid\.json/);
  assert.match(nativeAudit, /native-ui-reports-handoff\.json/);
  assert.match(nativeAudit, /exportReviewReady/);
  assert.match(nativeAudit, /exportReviewAccepted/);
  assert.match(nativeAudit, /exportReviewFileCount/);
  assert.match(nativeAudit, /native-ui-dashboard-draft\.json/);
  assert.match(nativeAudit, /native-ui-methodist-auto\.json/);
  assert.match(nativeAudit, /native-ui-planning-edit\.json/);
  assert.match(nativeAudit, /planning-grid-ax/);
  assert.match(nativeAudit, /planningAxInteraction/);
  assert.match(nativeAudit, /native-ui-sources-import\.json/);
  assert.match(nativeAudit, /native-ui-rotators-edit\.json/);
  assert.match(nativeAudit, /native-ui-outpatient-edit\.json/);
  assert.match(nativeAudit, /native-ui-inpatient-edit\.json/);
  assert.match(nativeAudit, /native-ui-clinics-edit\.json/);
  assert.match(nativeAudit, /native-ui-fellows-resolve\.json/);
  assert.match(nativeAudit, /native-ui-settings-edit\.json/);
  assert.match(nativeAudit, /native-source-import-audit\.csv/);
  assert.match(nativeAudit, /readJsonProbe/);
  assert.match(nativeAudit, /\/api\/runtime/);
  assert.match(nativeAudit, /\/api\/scheduler\/state/);
  assert.match(nativeAudit, /\/api\/scheduler\/command/);
  assert.match(nativeAudit, /grid\.show/);
  assert.match(nativeAudit, /DESKTOP_ENGINE_FRAGMENT/);
  assert.match(nativeAudit, /block-may-2026/);
  assert.match(nativeAudit, /May 2026 Pediatric Neurology/);
  assert.match(nativeAudit, /Maya Lopez/);
  assert.match(nativeAudit, /Jules Nguyen/);
  assert.match(nativeAudit, /Drew Quinn/);
  assert.match(nativeAudit, /Noah Patel/);
  assert.match(nativeAudit, /Sam Carter/);
  assert.match(nativeAudit, /Dana Reyes/);
  assert.match(nativeAudit, /screenProbe/);
  assert.match(nativeAudit, /planningProbe/);
  assert.match(nativeAudit, /reportsProbe/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Reports"/);
  assert.match(nativeAudit, /SCHEDULER_REPORTS_HANDOFF_AUDIT: "1"/);
  assert.match(nativeAudit, /reports-final-handoff/);
  assert.match(nativeAudit, /block-final-handoff-2026/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Dashboard"/);
  assert.match(nativeAudit, /SCHEDULER_DASHBOARD_DRAFT_AUDIT: "1"/);
  assert.match(nativeAudit, /dashboard-draft-generation/);
  assert.match(nativeAudit, /block-draft-generation-2026/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Inpatient"/);
  assert.match(nativeAudit, /SCHEDULER_METHODIST_AUTO_AUDIT: "1"/);
  assert.match(nativeAudit, /methodist-auto/);
  assert.match(nativeAudit, /block-methodist-auto-2026/);
  assert.match(nativeAudit, /Auto-Methodist/);
  assert.match(nativeAudit, /SCHEDULER_PLANNING_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /planning-edit-undo/);
  assert.match(nativeAudit, /axClickWhenReady\("planning-grid-apply-button", "Apply"\)/);
  assert.match(nativeAudit, /function axShortcutFallback/);
  assert.match(nativeAudit, /sent shortcut Undo/);
  assert.match(nativeAudit, /sent shortcut Redo/);
  assert.match(nativeAudit, /axClickWhenReady\("scheduler-toolbar-undo", "Undo", 8\)/);
  assert.match(nativeAudit, /axClickWhenReady\("scheduler-toolbar-redo", "Redo", 8\)/);
  assert.match(nativeAudit, /isAxPermissionIssue/);
  assert.match(nativeAudit, /isAxEnvironmentIssue/);
  assert.match(nativeAudit, /PLANNING_EDIT_DATES/);
  assert.match(nativeAudit, /block-planning-edit-2026/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Sources"/);
  assert.match(nativeAudit, /SCHEDULER_SOURCES_IMPORT_AUDIT: "1"/);
  assert.match(nativeAudit, /sources-roster-import/);
  assert.match(nativeAudit, /block-source-import-2026/);
  assert.match(nativeAudit, /Blake Lee/);
  assert.match(nativeAudit, /Casey Morgan/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Rotators"/);
  assert.match(nativeAudit, /SCHEDULER_ROTATORS_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /rotators-edit/);
  assert.match(nativeAudit, /block-rotators-edit-2026/);
  assert.match(nativeAudit, /Maya Lopez/);
  assert.match(nativeAudit, /Maya L\./);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Outpatient"/);
  assert.match(nativeAudit, /SCHEDULER_OUTPATIENT_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /outpatient-edit/);
  assert.match(nativeAudit, /block-outpatient-edit-2026/);
  assert.match(nativeAudit, /Resident Clinic/);
  assert.match(nativeAudit, /Epilepsy Clinic/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Inpatient"/);
  assert.match(nativeAudit, /SCHEDULER_INPATIENT_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /inpatient-edit/);
  assert.match(nativeAudit, /block-inpatient-edit-2026/);
  assert.match(nativeAudit, /Team senior/);
  assert.match(nativeAudit, /Jordan Lee/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Clinics"/);
  assert.match(nativeAudit, /SCHEDULER_CLINICS_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /clinics-edit/);
  assert.match(nativeAudit, /block-clinics-edit-2027/);
  assert.match(nativeAudit, /clinic-edit-monday-am/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Fellows"/);
  assert.match(nativeAudit, /SCHEDULER_FELLOWS_RESOLVE_AUDIT: "1"/);
  assert.match(nativeAudit, /fellows-resolve/);
  assert.match(nativeAudit, /block-fellows-resolve-2027/);
  assert.match(nativeAudit, /fellow-blank-candidates/);
  assert.match(nativeAudit, /rot-fellows-resolve-1/);
  assert.match(nativeAudit, /SCHEDULER_INITIAL_SCREEN: "Settings"/);
  assert.match(nativeAudit, /SCHEDULER_SETTINGS_EDIT_AUDIT: "1"/);
  assert.match(nativeAudit, /settings-edit/);
  assert.match(nativeAudit, /block-settings-edit-2027/);
  assert.match(nativeAudit, /Audit Attending/);
  assert.match(nativeAudit, /Audit Source Program/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-008/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-009/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-010/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-011/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-012/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-013/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-014/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-015/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-016/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-017/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-018/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-019/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-020/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-021/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-022/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-023/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-024/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-025/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-026/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-027/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-028/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-029/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-030/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-031/);
  assert.match(nativeAudit, /planning-grid-paint-toggle/);
  assert.match(rootView, /scheduler-toolbar-undo/);
  assert.match(rootView, /scheduler-toolbar-redo/);
  assert.match(nativeAudit, /rowCount/);
  assert.match(nativeAudit, /sectionCounts/);
  assert.match(nativeAudit, /screencapture/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-001/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-004/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-005/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-006/);
  assert.match(nativeAudit, /T-SCH-NATIVE-UI-007/);

  assert.match(projectVerification, /Native UI Audit/);
  assert.match(projectVerification, /npm run e2e:native/);
  assert.match(projectVerification, /native release package/i);
  assert.match(projectVerification, /npm run package:native/);
  assert.match(projectVerification, /PediatricScheduler-macOS\.zip/);
  assert.match(projectVerification, /seed.*Planning Grid/i);
  assert.match(projectVerification, /e2e\/seed-demo-state\.mjs/);
  assert.match(projectVerification, /--data-dir/);
  assert.match(projectVerification, /SCHEDULER_INITIAL_SCREEN="Planning Grid"/);
  assert.match(projectVerification, /SCHEDULER_DATA_DIR/);
  assert.match(projectVerification, /Reports.*handoff/i);
  assert.match(projectVerification, /native-ui-reports-handoff\.json/);
  assert.match(projectVerification, /Dashboard.*draft/i);
  assert.match(projectVerification, /native-ui-dashboard-draft\.json/);
  assert.match(projectVerification, /Planning Grid[\s\S]*edit/i);
  assert.match(projectVerification, /native-ui-planning-edit\.json/);
  assert.match(projectVerification, /planning-grid-ax/);
  assert.match(projectVerification, /planning-grid-apply-button/);
  assert.match(projectVerification, /scheduler-toolbar-undo/);
  assert.match(projectVerification, /scheduler-toolbar-redo/);
  assert.match(projectVerification, /Sources.*import/i);
  assert.match(projectVerification, /native-ui-sources-import\.json/);
  assert.match(projectVerification, /Rotators.*edit/i);
  assert.match(projectVerification, /native-ui-rotators-edit\.json/);
  assert.match(projectVerification, /Outpatient.*edit/i);
  assert.match(projectVerification, /native-ui-outpatient-edit\.json/);
  assert.match(projectVerification, /Inpatient.*edit/i);
  assert.match(projectVerification, /native-ui-inpatient-edit\.json/);
  assert.match(projectVerification, /Clinics.*edit/i);
  assert.match(projectVerification, /native-ui-clinics-edit\.json/);
  assert.match(projectVerification, /Fellows.*resolve/i);
  assert.match(projectVerification, /native-ui-fellows-resolve\.json/);
  assert.match(projectVerification, /Settings.*edit/i);
  assert.match(projectVerification, /native-ui-settings-edit\.json/);
  assert.match(projectVerification, /grid\.show/);
  assert.match(projectVerification, /native-ui-screen\.json|screen-probe/);
  assert.match(projectVerification, /native-ui-planning-grid\.json|projection-probe/);
  assert.match(projectVerification, /native-ui-reports-handoff\.json|Reports handoff probe/);
  assert.match(verificationMap, /T-SCH-NATIVE-011/);
  assert.match(verificationMap, /T-SCH-NATIVE-014/);
  assert.match(verificationMap, /T-SCH-NATIVE-016/);
  assert.match(verificationMap, /T-SCH-NATIVE-017/);
  assert.match(verificationMap, /T-SCH-NATIVE-018/);
  assert.match(verificationMap, /T-SCH-NATIVE-019/);
  assert.match(verificationMap, /T-SCH-NATIVE-020/);
  assert.match(verificationMap, /T-SCH-NATIVE-021/);
  assert.match(verificationMap, /T-SCH-NATIVE-022/);
  assert.match(verificationMap, /T-SCH-NATIVE-023/);
  assert.match(verificationMap, /T-SCH-NATIVE-024/);
  assert.match(verificationMap, /T-SCH-NATIVE-025/);
  assert.match(verificationMap, /T-SCH-NATIVE-026/);
  assert.match(verificationMap, /seeded Planning Grid/);
  assert.match(verificationMap, /block-may-2026/);
  assert.match(verificationMap, /block-final-handoff-2026/);
  assert.match(verificationMap, /block-draft-generation-2026/);
  assert.match(verificationMap, /block-methodist-auto-2026/);
  assert.match(verificationMap, /native-ui-methodist-auto\.json/);
  assert.match(verificationMap, /block-planning-edit-2026/);
  assert.match(verificationMap, /planning-grid-ax\/native-ui-planning-grid\.json/);
  assert.match(verificationMap, /block-source-import-2026/);
  assert.match(verificationMap, /block-rotators-edit-2026/);
  assert.match(verificationMap, /block-outpatient-edit-2026/);
  assert.match(verificationMap, /block-inpatient-edit-2026/);
  assert.match(verificationMap, /block-clinics-edit-2027/);
  assert.match(verificationMap, /block-fellows-resolve-2027/);
  assert.match(verificationMap, /block-settings-edit-2027/);
  assert.match(verificationMap, /sources-roster-import\/native-ui-sources-import\.json/);
  assert.match(verificationMap, /rotators-edit\/native-ui-rotators-edit\.json/);
  assert.match(verificationMap, /outpatient-edit\/native-ui-outpatient-edit\.json/);
  assert.match(verificationMap, /inpatient-edit\/native-ui-inpatient-edit\.json/);
  assert.match(verificationMap, /clinics-edit\/native-ui-clinics-edit\.json/);
  assert.match(verificationMap, /fellows-resolve\/native-ui-fellows-resolve\.json/);
  assert.match(verificationMap, /settings-edit\/native-ui-settings-edit\.json/);
  assert.match(verificationMap, /native-ui-audit-\*/);
});

test("native Dashboard renders the B2 workflow overview", () => {
  const rootView = read("macos/PediatricScheduler/View/RootView.swift");
  const dashboard = read("macos/PediatricScheduler/View/DashboardView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(rootView, /DashboardView\(/);
  assert.match(rootView, /onOpenSources: \{ store\.screenSelection = \.sources \}/);
  assert.match(rootView, /onOpenRotators: \{ store\.screenSelection = \.rotators \}/);
  assert.match(rootView, /onOpenReports: \{ store\.screenSelection = \.reports \}/);

  assert.match(dashboard, /workflowOverview\(summary: summary\)/);
  assert.match(dashboard, /DashboardSection\(title: "Workflow Overview"/);
  assert.match(dashboard, /First, import the schedule data\./);
  assert.match(dashboard, /Next, enter any requested days off or other constraints\./);
  assert.match(dashboard, /Then, the system generates a draft schedule\./);
  assert.match(dashboard, /Finally, review the draft, resolve any flagged conflicts, and finalize the schedule\./);
  assert.match(dashboard, /actionTitle: "Open Sources"/);
  assert.match(dashboard, /action: onOpenSources/);
  assert.match(dashboard, /actionTitle: "Open Rotators"/);
  assert.match(dashboard, /action: onOpenRotators/);
  assert.match(dashboard, /actionTitle: isDrafting \? "Generating" : "Generate Draft"/);
  assert.match(dashboard, /action: generateDraft/);
  assert.match(dashboard, /actionTitle: "Open Reports"/);
  assert.match(dashboard, /action: onOpenReports/);
  assert.match(dashboard, /await store\.run\("draft\.generate"\)/);
  assert.match(dashboard, /DashboardDraftProbe/);
  assert.match(dashboard, /PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT/);
  assert.match(dashboard, /native-ui-dashboard-draft\.json/);
  assert.match(dashboard, /runDashboardDraftProbeIfRequested/);
  assert.match(dashboard, /"draftReportInpatientAdded": report\?\.summary\.inpatientAdded \?\? 0/);
  assert.match(dashboard, /"autoDraftInpatientCount": autoDraftInpatient\.count/);
  assert.match(dashboard, /sourceReadiness\(summary\)/);
  assert.match(dashboard, /DashboardSection\(title: "Source Readiness"/);
  assert.match(dashboard, /MetricTile\(title: "Sources ready"/);
  // Readiness model extracted to Model/SourceReadiness.swift so Settings and
  // the Planning Grid Methodist panel share Dashboard's interpretation.
  const sourceReadinessModel = read("macos/PediatricScheduler/Model/SourceReadiness.swift");
  assert.match(sourceReadinessModel, /struct SourceReadiness/);
  assert.match(sourceReadinessModel, /expectedSourcePrograms/);
  assert.match(sourceReadinessModel, /activeProgramCounts/);
  assert.match(sourceReadinessModel, /reviewedSources/);
  assert.match(sourceReadinessModel, /Waiting for a reviewed source or roster data\./);
  assert.match(sourceReadinessModel, /All expected source programs have reviewed sources or roster data\./);

  assert.match(verificationMap, /T-SCH-NATIVE-013/);
  assert.match(verificationMap, /B2 four-step prose/);
  assert.match(verificationMap, /source-readiness card/);
  assert.match(commandInventory, /Native Dashboard source readiness/);
  assert.match(commandInventory, /expectedSourcePrograms/);
});

test("native app bundle contract includes a bundled Python engine and runtime provenance check", () => {
  const buildScript = read("script/build_and_run.sh");
  const appSupport = read("macos/PediatricScheduler/Backend/AppSupport.swift");
  const backendController = read("macos/PediatricScheduler/Backend/BackendController.swift");
  const backendMain = read("backend_py/main.py");

  assert.match(buildScript, /ENGINE_DIR="\$APP_RESOURCES\/Engine"/);
  assert.match(buildScript, /rsync -a --delete[\s\S]*"\$ROOT_DIR\/backend_py" "\$ENGINE_DIR\/"/);
  assert.match(buildScript, /rsync -a --delete "\$ROOT_DIR\/contracts" "\$ENGINE_DIR\/"/);
  assert.match(buildScript, /cp "\$ROOT_DIR\/package\.json" "\$ENGINE_DIR\/package\.json"/);
  assert.match(buildScript, /BUNDLED_VENV="\$ENGINE_DIR\/backend_py\/\.venv"/);
  assert.match(buildScript, /verify_bundle_engine\(\)/);
  assert.match(buildScript, /absolute symlink in bundled engine/);
  assert.match(buildScript, /PYTHONHOME/);
  assert.match(buildScript, /backend_py\.main/);
  assert.match(buildScript, /validate\(["']scheduler-state\.v1["']/);
  assert.match(buildScript, /from backend_py\.domain\.exports import build_export_package/);
  assert.match(buildScript, /from backend_py\.domain\.pdf_exports import build_pdf_exports/);
  assert.match(buildScript, /from backend_py\.domain\.word_exports import build_word_exports/);
  assert.match(buildScript, /from backend_py\.roster_import import import_roster_file/);
  assert.match(buildScript, /build_export_package\(state\)/);
  assert.match(buildScript, /build_pdf_exports\(state\)/);
  assert.match(buildScript, /build_word_exports\(state\)/);
  assert.match(buildScript, /import_roster_file\(state, roster, mode="add"\)/);
  assert.match(buildScript, /startswith\(b"%PDF"\)/);
  assert.match(buildScript, /startswith\(b"PK"\)/);
  assert.match(buildScript, /verify_runtime_engine\(\)/);
  assert.match(buildScript, /verify_packaged_runtime\(\)/);
  assert.match(buildScript, /\/api\/runtime/);
  assert.match(buildScript, /runtime\.get\("python", ""\)/);
  assert.match(buildScript, /backend Python executable is outside bundled engine/);
  assert.match(buildScript, /defaults delete "\$BUNDLE_ID"/);
  assert.match(buildScript, /ApplePersistenceIgnoreState/);
  assert.match(buildScript, /NSQuitAlwaysKeepsWindows/);
  assert.match(buildScript, /BUILD_CONFIGURATION="Release"/);
  assert.match(buildScript, /SCHEDULER_CODESIGN_IDENTITY/);
  assert.match(buildScript, /codesign "\$\{args\[@\]\}" "\$APP_BUNDLE"/);
  assert.match(buildScript, /codesign --verify --deep --strict "\$DESKTOP_APP"/);
  assert.match(buildScript, /package_app\(\)/);
  assert.match(buildScript, /NATIVE_PACKAGE_ZIP="\$NATIVE_PACKAGE_DIR\/PediatricScheduler-macOS\.zip"/);
  assert.match(buildScript, /NATIVE_PACKAGE_SHA="\$NATIVE_PACKAGE_DIR\/PediatricScheduler-macOS\.SHA256\.txt"/);
  assert.match(buildScript, /NATIVE_PACKAGE_MANIFEST="\$NATIVE_PACKAGE_DIR\/PediatricScheduler-macOS-MANIFEST\.json"/);
  assert.match(buildScript, /NATIVE_RELEASE_README_SOURCE="\$ROOT_DIR\/release\/PediatricSchedulerMac\/README\.md"/);
  assert.match(buildScript, /NATIVE_PACKAGE_README="\$NATIVE_PACKAGE_DIR\/README\.md"/);
  assert.match(buildScript, /NATIVE_PACKAGE_EXTRACT_DIR="\$NATIVE_PACKAGE_DIR\/verify-extract"/);
  assert.match(buildScript, /ditto -c -k --sequesterRsrc --keepParent "\$DESKTOP_APP_NAME" "\$NATIVE_PACKAGE_ZIP"/);
  assert.match(buildScript, /ditto -x -k "\$NATIVE_PACKAGE_ZIP" "\$NATIVE_PACKAGE_EXTRACT_DIR"/);
  assert.match(buildScript, /codesign --verify --deep --strict "\$EXTRACTED_APP"/);
  assert.match(buildScript, /verify_bundle_engine "\$EXTRACTED_APP"/);
  assert.match(buildScript, /verify_packaged_runtime "\$EXTRACTED_APP"/);
  assert.match(buildScript, /\/usr\/bin\/open -n "\$app_path"/);
  assert.match(buildScript, /shasum -a 256 "\$NATIVE_PACKAGE_ZIP"/);
  assert.match(buildScript, /PediatricScheduler-macOS-MANIFEST\.json/);
  assert.match(buildScript, /"customerRequirements"/);

  assert.match(appSupport, /appendingPathComponent\("Engine", isDirectory: true\)/);
  assert.match(appSupport, /if let bundled[\s\S]*return bundled/);
  assert.match(backendController, /backend_py\/\.venv\/bin\/python/);
  assert.match(backendController, /runningBackendMatches\(engineRoot:/);
  assert.match(backendMain, /@app\.get\("\/api\/runtime"\)/);
  assert.match(backendMain, /"engineRoot"/);
  assert.match(backendMain, /"cwd"/);
  assert.match(backendMain, /"python"/);
});

test("native app exposes raw-state undo and redo through menu and toolbar", () => {
  const apiClient = read("macos/PediatricScheduler/Net/APIClient.swift");
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const app = read("macos/PediatricScheduler/PediatricSchedulerApp.swift");
  const rootView = read("macos/PediatricScheduler/View/RootView.swift");
  const schedulerModels = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");

  assert.match(apiClient, /func getStateData\(\) async throws -> Data/);
  assert.match(apiClient, /func writeStateData\(_ data: Data\) async throws/);
  assert.match(apiClient, /static func decodeState\(from data: Data\) throws -> SchedulerState/);
  assert.match(schedulerModels, /Undo\/redo snapshots the raw JSON blob/);

  assert.match(appStore, /private var undoStack: \[Data\]/);
  assert.match(appStore, /private var redoStack: \[Data\]/);
  // run() snapshots from the adopted-state cache (single-writer backend)
  // instead of a full GET per command; a fresh GET only when the cache is
  // empty or invalidated.
  assert.match(appStore, /let before = try await snapshotStateData\(\)/);
  assert.match(appStore, /private var lastKnownStateData: Data\?/);
  assert.match(appStore, /private func snapshotStateData\(\) async throws -> Data/);
  assert.match(appStore, /if result\.ok && result\.changed/);
  assert.match(appStore, /func undo\(\) async/);
  assert.match(appStore, /func redo\(\) async/);
  assert.match(appStore, /try await api\.writeStateData\(previous\)/);
  assert.match(appStore, /try await api\.writeStateData\(next\)/);

  assert.match(app, /CommandGroup\(replacing: \.undoRedo\)/);
  assert.match(app, /Button\("Undo"\)/);
  assert.match(app, /Button\("Redo"\)/);
  assert.match(app, /UserDefaults\.standard\.register/);
  assert.match(app, /"ApplePersistenceIgnoreState": true/);
  assert.match(app, /"NSQuitAlwaysKeepsWindows": false/);
  assert.match(app, /applicationShouldTerminateAfterLastWindowClosed/);
  assert.match(app, /DisableWindowRestorationView/);
  assert.match(app, /\.isRestorable = false/);
  assert.match(app, /NativeWindowProbe/);
  assert.match(app, /native-ui-window\.json/);
  assert.match(app, /"windowAttached"/);
  assert.match(rootView, /Label\("Undo", systemImage: "arrow\.uturn\.backward"\)/);
  assert.match(rootView, /Label\("Redo", systemImage: "arrow\.uturn\.forward"\)/);

  assert.match(commandInventory, /Native Edit menu and shell toolbar `Undo` \/ `Redo`/);
  assert.match(verificationMap, /T-SCH-NATIVE-002/);
  assert.match(requirements, /\| PNS-OPEN-021 \| Undo history \| SHIPPED \/ TEST-ENFORCED \|/);
  assert.doesNotMatch(requirements, /\| PNS-OPEN-021 \| Undo history \| DEFERRED \|/);
});

test("native undo/redo commits history only after the backend write succeeds", () => {
  // Partial-failure safety: if writeStateData fails, nothing may have
  // mutated (stacks peek, not pop); if the write succeeds but the follow-up
  // getState/decode fails, the stacks must already match what the backend
  // persisted. Encoded as source-order checks on each function body.
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const undoBody = appStore.match(/func undo\(\) async \{([\s\S]*?)\n    func redo/)[1];
  const redoBody = appStore.match(/func redo\(\) async \{([\s\S]*?)\n    private func applyCoordinatorImportResult/)[1];

  for (const [body, peek, pop, write] of [
    [undoBody, "undoStack.last", "popUndoSnapshot()", "writeStateData(previous)"],
    [redoBody, "redoStack.last", "popRedoSnapshot()", "writeStateData(next)"]
  ]) {
    // Peek — not pop — guards the entry.
    assert.ok(body.includes("guard let") && body.includes(peek), `history step must peek via ${peek}`);
    const writeIdx = body.indexOf(write);
    const popIdx = body.indexOf(pop);
    const clearIdx = body.indexOf("clearStateDerivedPanels()");
    const refreshIdx = body.indexOf("let refreshed = try await api.getStateData()");
    assert.ok(writeIdx >= 0 && popIdx >= 0 && clearIdx >= 0 && refreshIdx >= 0);
    assert.ok(writeIdx < popIdx, "stack must not pop before the backend write");
    assert.ok(popIdx < refreshIdx, "stacks must be committed before the refresh that can fail");
    assert.ok(clearIdx < refreshIdx, "derived panels must clear even when the refresh fails");
  }
});

test("native full-state replacement paths clear all derived panels", () => {
  // Import commit, Coordinator import, and backup restore replace the whole
  // state; each must refresh through the shared helper (not a manual
  // subset), which clears planningGrid/scheduleFocus along with reports and
  // conflicts on BOTH the success and the refresh-failure path, and always
  // records the undo snapshot once the backend write has succeeded.
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  for (const fn of [
    "func commitRosterImportResult(",
    "func applyCoordinatorImportResult(",
    "func importStateBackup("
  ]) {
    const start = appStore.indexOf(fn);
    assert.ok(start >= 0, `missing ${fn}`);
    const body = appStore.slice(start, appStore.indexOf("\n    func ", start + 1));
    assert.ok(
      body.includes("await refreshAfterStateReplacement(before:") &&
        body.includes("replacementData:"),
      `${fn} must refresh via refreshAfterStateReplacement after replacing state`
    );
  }
  const refresh = appStore.match(/private func refreshAfterStateReplacement\(before: Data, replacementData: Data\) async \{([\s\S]*?)\n    \}/)[1];
  assert.ok(
    refresh.includes("try adoptStateData(replacementData)"),
    "replacement bytes must be adopted locally before canonical refresh"
  );
  assert.ok(refresh.includes("clearStateDerivedPanels()"), "helper must clear derived panels after a successful backend write");
  assert.ok(
    refresh.includes("recordUndoSnapshot(before)"),
    "refresh failure must still record the undo snapshot — the backend write already succeeded"
  );
  assert.ok(refresh.includes("reload the schedule"), "refresh failure must tell the user how to recover");
  // The helper itself must keep clearing the two caches the manual clears
  // used to miss.
  const helper = appStore.match(/private func clearStateDerivedPanels\(\) \{([\s\S]*?)\n    \}/)[1];
  assert.ok(helper.includes("planningGrid = nil"));
  assert.ok(helper.includes("scheduleFocus = nil"));
});

test("native export package writer follows the backend manifest file list", () => {
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(appStore, /let files = manifest\["files"\] as\? \[\[String: Any\]\] \?\? \[\]/);
  assert.match(appStore, /for file in files/);
  assert.match(appStore, /let key = file\["key"\] as\? String \?\? exportPackageKey\(for: name\)/);
  assert.match(appStore, /format == "text" \|\| format == "csv"/);
  assert.match(appStore, /case "roster\.csv":/);
  assert.match(appStore, /return "rosterCsv"/);
  assert.match(appStore, /case "inpatient-calendar\.csv":/);
  assert.match(appStore, /return "inpatientCalendarCsv"/);
  assert.match(appStore, /case "outpatient-calendar\.csv":/);
  assert.match(appStore, /return "outpatientCalendarCsv"/);
  assert.match(appStore, /case "conflicts\.csv":/);
  assert.match(appStore, /return "conflictsCsv"/);
  assert.match(appStore, /case "source-summary\.json", "source-import-summary\.json":/);
  assert.match(appStore, /case "source-summary\.csv", "source-import-summary\.csv":/);

  assert.match(commandInventory, /JSON\/text\/CSV export package/);
  assert.match(commandInventory, /CSV handoff files/);
  assert.match(verificationMap, /explicit PNS-EXP-002 package artifacts/);
  assert.match(verificationMap, /CSV roster\/calendar\/legend\/conflict\/source-import-summary files/);
});

test("native Inpatient exposes manual assignment editing", () => {
  const inpatient = read("macos/PediatricScheduler/View/InpatientView.swift");
  const sharedCommands = read("shared/scheduler/commands.js");
  const backendCommands = read("backend_py/domain/commands.py");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(inpatient, /@State private var selectedDate = ""/);
  assert.match(inpatient, /@State private var selectedRotatorId = ""/);
  assert.match(inpatient, /@State private var selectedRole: InpatientRoleOption = \.resident/);
  assert.match(inpatient, /@State private var inpatientEditProbeStarted = false/);
  assert.match(inpatient, /private func editor\(block: ServiceBlock, state: SchedulerState\) -> some View/);
  assert.match(inpatient, /Picker\("Date", selection: \$selectedDate\)/);
  assert.match(inpatient, /Picker\("Rotator", selection: \$selectedRotatorId\)/);
  assert.match(inpatient, /Picker\("Role", selection: \$selectedRole\)/);
  assert.match(inpatient, /private enum InpatientRoleOption/);
  assert.match(inpatient, /case amClinicPullOut/);
  assert.match(inpatient, /case pmClinicPullOut/);
  assert.match(inpatient, /case academicHalfDay/);
  assert.match(inpatient, /case \.off: return "Off"/);
  assert.match(inpatient, /private func selectedRotatorContext\(state: SchedulerState\) -> some View/);
  assert.match(inpatient, /availabilityWarning\(rotator:/);
  assert.match(inpatient, /private func inpatientValidationMessage\(block: ServiceBlock, state: SchedulerState\) -> String\?/);
  assert.match(inpatient, /return sorted\.filter \{ \$0\.isActive\(on: date\) \}/);
  assert.match(inpatient, /\.disabled\(isAssigning \|\| validationMessage != nil\)/);
  assert.match(inpatient, /"blockRef": store\.state\?\.activeBlock\?\.id \?\? ""/);
  assert.match(inpatient, /await store\.run\(\s*"inpatient\.assign"/);
  assert.match(inpatient, /await store\.run\("inpatient\.delete"/);
  assert.match(inpatient, /runInpatientEditProbeIfRequested/);
  assert.match(inpatient, /private enum InpatientEditProbe/);
  assert.match(inpatient, /PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT/);
  assert.match(inpatient, /native-ui-inpatient-edit\.json/);
  assert.match(inpatient, /let targetRotatorId = "rot-inpatient-edit-1"/);
  assert.match(inpatient, /let targetRole = "Team senior"/);
  assert.match(inpatient, /assignmentStillPresent/);
  assert.match(inpatient, /onSelect: \{ selectedDate = date \}/);

  assert.match(sharedCommands, /function invalidInpatientReason\(block, state, rotator, date\)/);
  assert.match(sharedCommands, /validateDrop\(state, rotator\.id, input\.date\)/);
  assert.match(sharedCommands, /"invalid_inpatient_assignment"/);
  assert.match(backendCommands, /def _invalid_inpatient_reason\(block: dict \| None, state: dict, rotator: dict, date: str\) -> str \| None:/);
  assert.match(backendCommands, /validate_drop\(state, rotator\.get\("id"\), date\)/);
  assert.match(backendCommands, /"invalid_inpatient_assignment"/);
  assert.match(commandTests, /inpatient\.assign rejects invalid active-date assignments before mutation/);
  assert.match(backendTests, /test_inpatient_assign_rejects_invalid_active_date_before_persisting/);

  assert.match(commandInventory, /Native Inpatient manual assignment editor/);
  assert.match(commandInventory, /Validates active-block inpatient eligibility/);
  assert.match(verificationMap, /T-SCH-NATIVE-008/);
  assert.match(verificationMap, /T-SCH-CMD-012/);
  assert.match(verificationMap, /invalid_inpatient_assignment/);
  assert.match(verificationMap, /manual inpatient assignment editing/);
});

test("native Fellows screen resolves draft fellow candidate warnings", () => {
  const rootView = read("macos/PediatricScheduler/View/RootView.swift");
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const fellows = read("macos/PediatricScheduler/View/FellowsView.swift");
  const models = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const sharedCommands = read("shared/scheduler/commands.js");
  const backendCommands = read("backend_py/domain/commands.py");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(rootView, /case fellows = "Fellows"/);
  assert.match(rootView, /FellowsView\(/);
  assert.match(rootView, /onOpenSources: \{ store\.screenSelection = \.sources \}/);
  assert.match(rootView, /onOpenRotators: \{ store\.screenSelection = \.rotators \}/);

  assert.match(models, /var checkId: String/);
  assert.match(models, /var dates: \[String\]/);
  assert.match(models, /var candidates: \[String\]/);
  assert.match(models, /Self\.stringArray\(raw\["dates"\]\)/);
  assert.match(models, /Self\.stringArray\(raw\["candidates"\]\)/);

  assert.match(fellows, /pendingChecks/);
  assert.match(fellows, /fellow-blank-candidates/);
  assert.match(fellows, /@State private var fellowsResolveProbeStarted = false/);
  assert.match(fellows, /candidateFellows\(for: check, state: state\)/);
  assert.match(fellows, /Label\("Import Fellow Source"/);
  assert.match(fellows, /Label\("Edit Profiles"/);
  assert.match(fellows, /Label\("Assign Fellow"/);
  assert.match(fellows, /let ok = await store\.run\(\s*"inpatient\.fellow\.resolve"/);
  assert.match(fellows, /"dates": dates/);
  assert.match(fellows, /"role": "Fellow"/);
  assert.match(fellows, /if ok \{[\s\S]{0,200}?store\.removeDraftCheck\(id: check\.id\)/);
  // Resolving one pick must not clear the other pending picks.
  assert.match(appStore, /func removeDraftCheck\(id: String\)/);
  assert.doesNotMatch(fellows, /for date in dates[\s\S]{0,400}inpatient\.assign/);
  assert.match(fellows, /defaultPhaseTitle/);
  assert.match(fellows, /fellow\.unavailableRanges/);
  assert.match(fellows, /fellow\.dayOff/);
  assert.match(fellows, /runFellowsResolveProbeIfRequested/);
  assert.match(fellows, /private enum FellowsResolveProbe/);
  assert.match(fellows, /PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT/);
  assert.match(fellows, /native-ui-fellows-resolve\.json/);
  assert.match(fellows, /let targetBlockId = "block-fellows-resolve-2027"/);
  assert.match(fellows, /let targetRotatorId = "rot-fellows-resolve-1"/);
  assert.match(fellows, /store\.clearDraftReport\(\)/);
  assert.match(fellows, /draftReportCleared/);

  assert.match(sharedCommands, /function commandInpatientFellowResolve\(state, type, input\)/);
  assert.match(sharedCommands, /validateDrop\(next, rotator\.id, date, \{ requiredRole: "Fellow" \}\)/);
  assert.match(sharedCommands, /"invalid_fellow_resolution"/);
  assert.match(sharedCommands, /role: "Fellow"[\s\S]*source: "Manual"/);
  assert.equal(
    parseSharedCommandHandlers(sharedCommands).get("inpatient.fellow.resolve"),
    "commandInpatientFellowResolve"
  );

  assert.match(backendCommands, /def _cmd_inpatient_fellow_resolve\(state: dict, type_: str, input_: dict\) -> Result:/);
  assert.match(backendCommands, /validate_drop\(next_state, rotator\.get\("id"\), date, \{"requiredRole": "Fellow"\}\)/);
  assert.match(backendCommands, /"invalid_fellow_resolution"/);
  assert.match(backendCommands, /"role": "Fellow"[\s\S]*"source": "Manual"/);
  assert.match(backendCommands, /"inpatient\.fellow\.resolve": _cmd_inpatient_fellow_resolve/);
  assert.match(commandTests, /inpatient\.fellow\.resolve validates fellow pick dates atomically/);
  assert.match(backendTests, /test_inpatient_fellow_resolve_validates_before_persisting_batch/);

  assert.match(commandInventory, /Native Fellows draft-pick queue/);
  assert.match(commandInventory, /Native Fellows resolution queue/);
  assert.match(commandInventory, /`inpatient\.fellow\.resolve`/);
  assert.match(verificationMap, /T-SCH-NATIVE-012/);
  assert.match(verificationMap, /T-SCH-NATIVE-024/);
  assert.match(verificationMap, /T-SCH-CMD-010/);
  assert.match(verificationMap, /inpatient\.fellow\.resolve/);
  assert.match(verificationMap, /fellow-blank-candidates/);
  assert.match(verificationMap, /fellows-resolve\/native-ui-fellows-resolve\.json/);
});

test("native roster screens default to active-block filtering with show-all counts", () => {
  const rotators = read("macos/PediatricScheduler/View/RotatorsView.swift");
  const fellows = read("macos/PediatricScheduler/View/FellowsView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  for (const source of [rotators, fellows]) {
    assert.match(source, /@State private var activeBlockOnly = true/);
    assert.match(source, /Toggle\("Active block only", isOn: \$activeBlockOnly\)/);
    assert.match(source, /segment\.start <= block\.endDate && block\.startDate <= segment\.end/);
    assert.match(source, /outside block hidden/);
    assert.match(source, /systemImage: "eye\.slash"/);
  }

  assert.match(rotators, /ForEach\(visibleRotators\(state\)\)/);
  assert.match(rotators, /guard activeBlockOnly, let block = state\.activeBlock else \{ return rotators \}/);
  assert.match(rotators, /private func hiddenRotatorCount\(_ state: SchedulerState\) -> Int/);
  assert.match(rotators, /sortedRotators\(state\)\.count - visibleRotators\(state\)\.count/);

  assert.match(fellows, /private func sortedFellows\(_ state: SchedulerState\) -> \[Rotator\]/);
  assert.match(fellows, /let allFellows = sortedFellows\(state\)/);
  assert.match(fellows, /guard activeBlockOnly, let block = state\.activeBlock else \{ return allFellows \}/);
  assert.match(fellows, /private func hiddenFellowCount\(_ state: SchedulerState\) -> Int/);
  assert.match(fellows, /sortedFellows\(state\)\.count - fellows\(in: state\)\.count/);

  assert.match(commandInventory, /Native Rotators\/Fellows active-block roster filters/);
  assert.match(verificationMap, /T-SCH-NATIVE-015/);
  assert.match(verificationMap, /show-all escape hatch/);
  assert.match(verificationMap, /outside-block hidden counts/);
});

test("Methodist auto command is wired through shared React, backend, and native controls", () => {
  const commands = read("backend_py/domain/commands.py");
  const sharedCommands = read("shared/scheduler/commands.js");
  const legacyApp = read("src/App.jsx");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const rotatorDomain = read("backend_py/domain/rotators.py");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const inpatient = read("macos/PediatricScheduler/View/InpatientView.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const rotatorsView = read("macos/PediatricScheduler/View/RotatorsView.swift");
  const models = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");
  const seedDemo = read("e2e/seed-demo-state.mjs");
  const nativeAudit = read("e2e/run-native-ui-audit.mjs");
  const buildScript = read("script/build_and_run.sh");

  assert.match(commands, /def _cmd_methodist_auto\(state: dict, type_: str, input_: dict\) -> Result:/);
  assert.match(commands, /choose_methodist_start_side\(rotator, block\)/);
  assert.match(commands, /apply_methodist_auto_assign\(working, block\)/);
  assert.match(commands, /"methodist\.auto": _cmd_methodist_auto/);
  assert.match(sharedCommands, /function commandMethodistAuto\(state, type, input\)/);
  assert.match(sharedCommands, /chooseMethodistStartSide\(rotator, block\)/);
  assert.match(sharedCommands, /applyMethodistAutoAssign\(working, block\)/);
  assert.equal(
    parseSharedCommandHandlers(sharedCommands).get("methodist.auto"),
    "commandMethodistAuto"
  );
  assert.match(legacyApp, /updateStateFromCommand\(\s*state,\s*updateState,\s*\{\s*type: "methodist\.auto"/);
  assert.doesNotMatch(legacyApp, /applyMethodistAutoAssign\(state, block\)/);
  assert.match(rotatorDomain, /normalize_rotation_start_date/);
  assert.match(rotatorDomain, /normalize_methodist_start_side/);
  assert.match(rotatorDomain, /rotator\["rotationStartDate"\]/);
  assert.match(rotatorDomain, /rotator\["methodistStartSide"\]/);

  assert.match(commandTests, /methodist\.auto command computes start side, fills the 14\/14 schedule, and is idempotent/);
  assert.match(commandTests, /methodist\.auto command no-ops cleanly without Methodist rotators/);
  assert.match(commandTests, /methodist\.auto command accepts flat input and honors legacy Methodist program classification/);
  assert.match(commandTests, /result\.message, "Methodist 14\/14 schedule is already up to date\."/);
  assert.match(backendTests, /test_methodist_auto_command_generates_14_14_and_is_idempotent/);
  assert.match(backendTests, /test_rotator_add_update_preserves_methodist_rotation_metadata/);
  assert.match(backendTests, /"type": "methodist\.auto"/);
  assert.match(backendTests, /"methodistStartSide"[\s\S]*"outpatient"/);
  assert.match(backendTests, /again\["changed"\] is False/);

  for (const source of [inpatient, planningGrid]) {
    assert.match(source, /@State private var isRunningMethodistAuto = false/);
    assert.match(source, /Label\("Methodist 14\/14", systemImage: "building\.2"\)/);
    assert.match(source, /await store\.run\("methodist\.auto"\)/);
  }
  assert.match(inpatient, /@State private var methodistAutoProbeStarted = false/);
  assert.match(inpatient, /runMethodistAutoProbeIfRequested\(block: block, state: state\)/);
  assert.match(inpatient, /private enum MethodistAutoProbe/);
  assert.match(inpatient, /PEDI_SCHEDULER_METHODIST_AUTO_AUDIT/);
  assert.match(inpatient, /native-ui-methodist-auto\.json/);
  assert.match(inpatient, /await store\.run\("methodist\.auto", input: \["blockRef": block\.id\]\)/);
  assert.match(inpatient, /afterGenerateInpatientCount == 14/);
  assert.match(inpatient, /afterGenerateOutpatientCount == 18/);
  assert.match(inpatient, /afterRerunInpatientCount == afterGenerateInpatientCount/);
  assert.match(inpatient, /afterRerunOutpatientCount == afterGenerateOutpatientCount/);

  assert.match(models, /var rotationStartDate: String\?/);
  assert.match(models, /var methodistStartSide: String\?/);
  assert.match(rotatorsView, /Label\("Methodist 14\/14", systemImage: "building\.2"\)/);
  assert.match(rotatorsView, /TextField\("YYYY-MM-DD", text: \$draft\.rotationStartDate\)/);
  assert.match(rotatorsView, /Picker\("Start side", selection: \$draft\.methodistStartSide\)/);
  assert.match(rotatorsView, /"rotationStartDate": methodistRotationStartDatePayload/);
  assert.match(rotatorsView, /"methodistStartSide": methodistStartSidePayload/);

  assert.match(commandInventory, /\| `methodist\.auto` \| React Inpatient plus native Inpatient and Planning Grid Methodist 14\/14 buttons/);
  assert.match(commandInventory, /Methodist rotation start\/side metadata/);
  assert.match(commandInventory, /T-SCH-CMD-008/);
  assert.match(commandInventory, /T-SCH-NATIVE-026/);
  assert.doesNotMatch(commandInventory, /\| `methodist\.auto` \| Inpatient Methodist auto schedule \| `applyMethodistAutoAssign` \| Domain-specific generated fill; lower priority than manual commands\. \|/);

  assert.match(seedDemo, /"methodist-auto": methodistAutoState/);
  assert.match(seedDemo, /block-methodist-auto-2026/);
  assert.match(seedDemo, /rot-methodist-auto-1/);
  assert.match(buildScript, /SCHEDULER_METHODIST_AUTO_AUDIT/);
  assert.match(buildScript, /PEDI_SCHEDULER_METHODIST_AUTO_AUDIT/);
  assert.match(nativeAudit, /METHODIST_AUTO_BLOCK_ID = "block-methodist-auto-2026"/);
  assert.match(nativeAudit, /METHODIST_AUTO_ROTATOR_ID = "rot-methodist-auto-1"/);
  assert.match(nativeAudit, /summarizeMethodistAutoProbe/);
  assert.match(nativeAudit, /SCHEDULER_METHODIST_AUTO_AUDIT: "1"/);
  assert.match(nativeAudit, /native-ui-methodist-auto\.json/);
  assert.match(nativeAudit, /afterGenerateInpatientCount === 14/);
  assert.match(nativeAudit, /afterGenerateOutpatientCount === 18/);
  assert.match(nativeAudit, /afterRerunInpatientCount === 14/);
  assert.match(nativeAudit, /afterRerunOutpatientCount === 18/);

  assert.match(verificationMap, /T-SCH-CMD-008/);
  assert.match(verificationMap, /T-SCH-NATIVE-026/);
  assert.match(verificationMap, /Methodist 14\/14 auto generation is available as a shared JS and native\/backend command/);
  assert.match(verificationMap, /React Inpatient calls `methodist\.auto` through `executeSchedulerCommand`/);
  assert.match(verificationMap, /Methodist rotation metadata/);
  assert.match(verificationMap, /Native Inpatient can run Methodist 14\/14 auto generation from the desktop app/);
  assert.match(verificationMap, /18 Auto-Methodist outpatient sessions after preserving the default Tuesday PM continuity-clinic slots/);
});

test("native Rotators supports selected-roster bulk delete through backend commands", () => {
  const rotators = read("macos/PediatricScheduler/View/RotatorsView.swift");
  const sharedScheduler = read("shared/scheduler/scheduler.js");
  const sharedSchedulerTests = read("shared/scheduler/scheduler.test.js");
  const commands = read("backend_py/domain/commands.py");
  const backendRotators = read("backend_py/domain/rotators.py");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const nativeAudit = read("e2e/run-native-ui-audit.mjs");
  const projectVerification = read("docs/PROJECT_VERIFICATION.md");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");

  assert.match(rotators, /@State private var selectedRotatorIds: Set<String> = \[\]/);
  assert.match(rotators, /@State private var rotatorsEditProbeStarted = false/);
  assert.match(rotators, /List\(selection: \$selectedRotatorIds\)/);
  assert.match(rotators, /@State private var confirmBulkDelete = false/);
  assert.match(rotators, /confirmationDialog\("Delete selected rotators\?"/);
  assert.match(rotators, /private func deleteSelectedRotators\(\)/);
  assert.match(rotators, /let ids = visibleRotators\(state\)[\s\S]*\.filter \{ selectedRotatorIds\.contains\(\$0\) \}/);
  assert.match(rotators, /await store\.run\("rotators\.delete", input: \["rotatorIds": ids\]\)/);
  assert.match(rotators, /selectedRotatorIds\.removeAll\(\)/);
  assert.match(rotators, /RotatorsEditProbe/);
  assert.match(rotators, /PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT/);
  assert.match(rotators, /native-ui-rotators-edit\.json/);
  assert.match(rotators, /runRotatorsEditProbeIfRequested/);
  assert.match(rotators, /await store\.run\("rotator\.add"/);
  assert.match(rotators, /await store\.run\("rotator\.update"/);
  assert.match(rotators, /await store\.run\("roster\.dedupe"\)/);
  assert.match(rotators, /dedupeRemovedCount/);
  assert.match(rotators, /duplicateInpatientRepointed/);
  assert.match(rotators, /duplicateOutpatientRepointed/);
  assert.match(rotators, /await store\.run\("rotators\.delete"/);
  assert.match(rotators, /bulkDeleteTargetStillPresent/);

  assert.match(commands, /def _cmd_rotators_delete\(state: dict, type_: str, input_: dict\) -> Result:/);
  assert.match(commands, /def _cmd_roster_dedupe\(state: dict, type_: str, input_: dict\) -> Result:/);
  assert.match(commands, /"rotators\.delete": _cmd_rotators_delete/);
  assert.match(commands, /"roster\.dedupe": _cmd_roster_dedupe/);
  assert.match(sharedScheduler, /clinicAssignments: \(state\.clinicAssignments \|\| \[\]\)\.map\(repoint\)/);
  assert.match(sharedScheduler, /clinicAssignments: \(state\.clinicAssignments \|\| \[\]\)\.filter/);
  assert.match(sharedSchedulerTests, /result\.state\.clinicAssignments\[0\]\.rotatorId/);
  assert.match(backendRotators, /"clinicAssignments": \[repoint\(item\) for item in state\.get\("clinicAssignments", \[\]\)\]/);
  assert.match(backendTests, /test_roster_dedupe_and_bulk_delete_repoint_or_cleanup_assignments/);
  assert.match(backendTests, /"type": "roster\.dedupe"/);
  assert.match(backendTests, /"type": "rotators\.delete"/);
  assert.match(backendTests, /deduped\["state"\]\["clinicAssignments"\]\[0\]\["rotatorId"\] == "r1"/);
  assert.match(commandInventory, /\| `rotators\.delete` \| Native Rotators roster list bulk action/);
  assert.match(commandInventory, /\| `roster\.dedupe` \| Native Rotators toolbar/);
  assert.match(commandInventory, /repointing inpatient, outpatient, and clinic assignment references/);
  assert.match(nativeAudit, /rotatorsEditSummary\.dedupeRemovedCount === 1/);
  assert.match(nativeAudit, /duplicateInpatientRepointed === true/);
  assert.match(nativeAudit, /deduped Drew Quinn/);
  assert.match(projectVerification, /`roster\.dedupe`/);
  assert.match(verificationMap, /Rotator add\/update\/delete, bulk delete/);
  assert.match(verificationMap, /Native Rotators can add, update, dedupe, and bulk-delete/);
  assert.match(verificationMap, /IP\/OP session repointing/);
  assert.match(requirements, /\| PNS-ROSTER-004 \| Duplicate cleanup must merge same-named rotators\. \| SHIPPED \/ TEST-ENFORCED \|/);
});

test("native Rotators editor remains scrollable at compact window sizes", () => {
  const rotators = read("macos/PediatricScheduler/View/RotatorsView.swift");

  assert.match(rotators, /private func editor\(state: SchedulerState\) -> some View \{\s*ScrollView \{/);
  assert.match(rotators, /ScrollView \{[\s\S]*formGrid[\s\S]*methodistEditor[\s\S]*segmentsEditor[\s\S]*availabilityEditor[\s\S]*save\(\)[\s\S]*Label\(selectedRotator == nil \? "Add" : "Save", systemImage: "checkmark"\)[\s\S]*Label\("Revert", systemImage: "arrow\.uturn\.backward"\)[\s\S]*rosterSummary\(state\)/);
  assert.match(rotators, /\.frame\(maxWidth: \.infinity, alignment: \.topLeading\)[\s\S]*\.confirmationDialog\("Delete rotator\?"/);
});

test("native compact-window panes keep dense controls reachable", () => {
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const clinics = read("macos/PediatricScheduler/View/ClinicsView.swift");
  const rotators = read("macos/PediatricScheduler/View/RotatorsView.swift");
  const sources = read("macos/PediatricScheduler/View/SourcesView.swift");
  const regressionPinboard = read("docs/REGRESSION_PINBOARD.md");

  // Planning Grid controls live in a wrapping top toolbar (no fixed-width
  // left rail), so the grid gets the full content width and the control band
  // reflows instead of clipping at compact window sizes.
  assert.match(planningGrid, /private func planningToolbar\(block: ServiceBlock, state: SchedulerState\) -> some View \{\s*let validationMessage = planningRangeValidationMessage\(block: block\)/);
  assert.match(planningGrid, /FlexibleWrap\(spacing: 12\)[\s\S]*Label\("Apply", systemImage: phase\.systemImage\)[\s\S]*Label\("Generate Draft", systemImage: "wand\.and\.stars"\)/);
  assert.doesNotMatch(planningGrid, /private func editor\(block: ServiceBlock, state: SchedulerState\)/);
  assert.doesNotMatch(planningGrid, /\.frame\(width: 300, alignment: \.topLeading\)/);

  assert.match(clinics, /return ScrollView \{[\s\S]*Picker\("Clinic", selection: \$selectedOccurrenceId\)[\s\S]*Label\("Assign", systemImage: "cross\.case"\)/);
  assert.doesNotMatch(clinics, /return VStack\(alignment: \.leading, spacing: 16\)[\s\S]*\.frame\(width: 310/);

  assert.match(rotators, /private var segmentsEditor: some View \{[\s\S]*ScrollView\(\.horizontal\)[\s\S]*private var methodistEditor/);
  assert.match(rotators, /private var availabilityEditor: some View \{[\s\S]*LazyVGrid\(columns: \[GridItem\(\.adaptive\(minimum: 64\)/);
  assert.match(rotators, /private var availabilityEditor: some View \{[\s\S]*ScrollView\(\.horizontal\)[\s\S]*private func rosterSummary/);
  assert.match(rotators, /return LazyVGrid\(columns: \[GridItem\(\.adaptive\(minimum: 130\)/);

  assert.match(sources, /private func detailPane\(state: SchedulerState\) -> some View \{[\s\S]*VStack\(alignment: \.leading, spacing: 10\)[\s\S]*LazyVGrid\(columns: \[GridItem\(\.adaptive\(minimum: 130\)/);
  assert.doesNotMatch(sources, /HStack\(alignment: \.firstTextBaseline, spacing: 12\)[\s\S]*Label\("Replace"/);

  assert.match(regressionPinboard, /Native compact-window editors could clip or crowd lower controls without scrollable and wrapping panes/);
});

test("D1b Methodist outpatient policy is resolved and parity-pinned", () => {
  const backendDraft = read("backend_py/domain/draft.py");
  const backendTests = read("backend_py/tests/test_draft_rules.py");
  const jsTests = read("shared/scheduler/scheduler.test.js");
  const programRules = read("shared/scheduler/program-rules.js");
  const fixMap = read("docs/feedback/2026-05-29-coordinator/fix-map.md");
  const confirmQuestions = read("docs/feedback/2026-06-01-coordinator/confirm-questions.md");

  assert.match(backendDraft, /get_rotator_phase\(rotator, date\) != "outpatient"/);
  assert.match(backendTests, /test_d1b_methodist_outpatient_fortnight_is_not_inpatient_backup/);
  assert.match(backendTests, /2026-05-25[\s\S]*2026-05-29/);
  assert.match(jsTests, /excludes a Methodist rotator during their outpatient fortnight from inpatient fair-fill/);
  assert.match(programRules, /D1b is RESOLVED \(Coordinator #8, 2026-06-02\)/);

  assert.match(fixMap, /D1b[\s\S]*Methodist outpatient fortnight[\s\S]*RESOLVED 2026-06-02/);
  assert.match(confirmQuestions, /Resolved behavior as of 2026-06-02/);
  assert.doesNotMatch(fixMap, /Remaining open fork[\s\S]*D1b|Ask Coordinator/);
  assert.doesNotMatch(confirmQuestions, /one open choice|no rule|not picked|Once we hear back[\s\S]*D1b/i);
});

test("native views surface first-class half-day facts", () => {
  const models = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const halfDayViews = read("macos/PediatricScheduler/View/HalfDayFactViews.swift");
  const dashboard = read("macos/PediatricScheduler/View/DashboardView.swift");
  const inpatient = read("macos/PediatricScheduler/View/InpatientView.swift");
  const outpatient = read("macos/PediatricScheduler/View/OutpatientView.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const reports = read("macos/PediatricScheduler/View/ReportsView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(models, /var halfDayFacts: \[HalfDayFact\]\?/);
  assert.match(models, /func halfDayFactsFor\(date: String, rotatorId: String\? = nil, period: String\? = nil\) -> \[HalfDayFact\]/);
  assert.match(models, /struct HalfDayFact: Decodable, Identifiable/);
  assert.match(models, /var unsafeWholeDayMapping: Bool\?/);

  assert.match(halfDayViews, /struct HalfDayFactBadges: View/);
  assert.match(halfDayViews, /circle\.lefthalf\.filled/);
  assert.match(halfDayViews, /Button\s*\{/);
  assert.match(halfDayViews, /\.accessibilityLabel\(accessibilityLabel\)/);
  assert.match(halfDayViews, /\.accessibilityValue\(fact\.helpText\)/);
  assert.match(halfDayViews, /\.accessibilityHint\("Open half-day source details\."\)/);
  assert.match(halfDayViews, /\.popover\(isPresented: \$showingDetails/);
  assert.match(halfDayViews, /HalfDayFactDetailPopover/);

  assert.match(dashboard, /MetricTile\(title: "Half-day facts"/);
  assert.match(dashboard, /halfDayFactCount: state\.halfDayFactsFor\(date: date\)\.count/);

  assert.match(inpatient, /halfDayFacts: factsByDate\[date\] \?\? \[\]/);
  assert.match(inpatient, /Partial-day source/);
  assert.match(inpatient, /let unmatchedFacts = halfDayFacts\.filter/);
  assert.match(inpatient, /HalfDayFactBadges\(facts: facts\)/);

  assert.match(outpatient, /halfDayFacts: state\.halfDayFactsFor\(date: day\)/);
  assert.match(outpatient, /let unmatchedFacts = periodFacts\.filter/);
  assert.match(outpatient, /HalfDayFactBadges\(\s*facts: periodFacts,/);

  assert.match(planningGrid, /facts: state\.halfDayFactsFor\(date: date, rotatorId: \$0\.rotatorId\)/);
  assert.match(planningGrid, /private func outpatientFacts\(for session: OutpatientSession\) -> \[HalfDayFact\]/);
  assert.match(planningGrid, /private var unmatchedHalfDayFacts: \[HalfDayFact\]/);
  assert.match(planningGrid, /HalfDayFactBadges\(\s*facts: unmatchedHalfDayFacts,/);
  assert.match(planningGrid, /HalfDayFactBadges\(facts: chip\.facts\)/);

  assert.match(reports, /HalfDayFactsReportSection/);
  assert.match(reports, /Label\("\\\(halfDayCount\) half-day facts"/);
  assert.match(reports, /facts: halfDayFacts/);

  assert.match(commandInventory, /Native half-day fact visibility/);
  assert.match(verificationMap, /T-SCH-NATIVE-009/);
  assert.match(verificationMap, /first-class imported half-day facts/);
  assert.match(verificationMap, /source-detail popovers/);
});

test("native Settings preserves multiple poster locations", () => {
  const settings = read("macos/PediatricScheduler/View/SettingsView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(settings, /@State private var posterLocations: \[PosterLocationDraft\] = \[\]/);
  assert.match(settings, /posterLocations = \(settings\.locations \?\? PosterSettings\.fallback\.locations \?\? \[\]\)\.map\(PosterLocationDraft\.init\)/);
  assert.match(settings, /ForEach\(\$posterLocations\)/);
  assert.match(settings, /private func addPosterLocation\(\)/);
  assert.match(settings, /private func removePosterLocation\(_ id: String\)/);
  assert.match(settings, /"locations": posterLocations\.map\(\\\.payload\)/);
  assert.match(settings, /private struct PosterLocationDraft: Identifiable, Equatable/);
  assert.match(settings, /private struct PosterLocationDraftRow: View/);
  assert.match(settings, /@State private var settingsEditProbeStarted = false/);
  assert.match(settings, /runSettingsEditProbeIfRequested/);
  assert.match(settings, /private enum SettingsEditProbe/);
  assert.match(settings, /PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT/);
  assert.match(settings, /native-ui-settings-edit\.json/);
  assert.match(settings, /let targetBlockId = "block-settings-edit-2027"/);
  assert.match(settings, /await store\.run\(\s*"block\.update"/);
  assert.match(settings, /await store\.run\(\s*"rules\.patch"/);
  assert.match(settings, /await store\.run\(\s*"posterSettings\.patch"/);
  assert.match(settings, /await store\.run\("attending\.add"/);
  assert.match(settings, /await store\.run\(\s*"attending\.update"/);
  assert.match(settings, /await store\.run\("attending\.remove"/);
  assert.match(settings, /await store\.run\("expectedSource\.add"/);
  assert.match(settings, /await store\.run\("expectedSource\.remove"/);

  assert.match(commandInventory, /multiple poster locations/);
  assert.match(verificationMap, /T-SCH-NATIVE-010/);
  assert.match(verificationMap, /T-SCH-NATIVE-025/);
  assert.match(verificationMap, /multiple poster locations/);
  assert.match(verificationMap, /settings-edit\/native-ui-settings-edit\.json/);
});

test("native Settings wires import and backup workflows", () => {
  const settings = read("macos/PediatricScheduler/View/SettingsView.swift");
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const apiClient = read("macos/PediatricScheduler/Net/APIClient.swift");
  const backendMain = read("backend_py/main.py");
  const coordinatorImport = read("backend_py/coordinator_docx_import.py");
  const backendReadme = read("backend_py/README.md");
  const reviewSheet = read("macos/PediatricScheduler/View/RosterImportReviewSheet.swift");
  const coordinatorReviewSheet = read("macos/PediatricScheduler/View/CoordinatorImportReviewSheet.swift");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(settings, /Button \{\s*chooseRosterFile\(\)/);
  assert.match(settings, /Button \{\s*chooseCoordinatorBundle\(\)/);
  assert.match(settings, /Button \{\s*importDefaultCoordinatorBundle\(\)/);
  assert.match(settings, /\.sheet\(item: \$pendingRosterImport\)/);
  assert.match(settings, /RosterImportReviewSheet\(/);
  assert.match(settings, /private func chooseRosterFile\(\)/);
  assert.match(settings, /Choose a template roster or week-grid Excel roster with B\/!B marks/);
  assert.match(settings, /pendingRosterImport = try await store\.previewRosterFile\(\s*url,\s*mode: rosterImportMode/);
  assert.match(settings, /\.sheet\(item: \$pendingCoordinatorImport\)/);
  assert.match(settings, /CoordinatorImportReviewSheet\(/);
  assert.match(settings, /pendingCoordinatorImport = try await store\.previewDefaultCoordinatorDocx\(\)/);
  assert.match(settings, /pendingCoordinatorImport = try await store\.previewCoordinatorDocx\(/);
  assert.match(settings, /let ok = await store\.commitCoordinatorImportResult\(result\)/);
  assert.match(settings, /onConfirm: \{ columnMapping, matrixBangBehavior in/);
  assert.match(settings, /matrixBangBehavior: matrixBangBehavior/);
  assert.match(settings, /private func chooseBackupDestination\(\)/);
  assert.match(settings, /await store\.exportStateBackup\(to: url\)/);
  assert.match(settings, /private func chooseBackupToRestore\(\)/);
  assert.match(settings, /await store\.importStateBackup\(from: url\)/);

  assert.match(appStore, /func previewRosterFile\(/);
  assert.match(appStore, /matrixBangBehavior: String = "present"/);
  assert.match(appStore, /func previewDefaultCoordinatorDocx\(\) async throws -> CoordinatorImportResult/);
  assert.match(appStore, /func previewCoordinatorDocx\(master: URL, inpatient: URL, outpatient: URL\) async throws -> CoordinatorImportResult/);
  assert.match(appStore, /func commitCoordinatorImportResult\(_ result: CoordinatorImportResult\) async -> Bool/);
  assert.match(appStore, /replaceSourceId: String\? = nil/);
  assert.match(appStore, /let mappingOverride = result\.importMeta\.isMatrix\s+\? nil\s+:/);
  assert.match(appStore, /matrixBangBehavior: matrixBangBehavior \?\? result\.importMeta\.matrixBangBehavior/);
  assert.match(appStore, /let replacementData = try encodedStateData\(from: freshResult\.stateObject\)/);
  assert.match(appStore, /try await api\.writeStateData\(replacementData\)/);
  assert.match(appStore, /func exportStateBackup\(to url: URL\) async/);
  assert.match(appStore, /func importStateBackup\(from url: URL\) async/);

  assert.match(apiClient, /let isMatrix: Bool/);
  assert.match(apiClient, /let matrixBangBehavior: String/);
  assert.match(apiClient, /let bangMarkedRotators: \[String\]/);
  assert.match(apiClient, /"matrixBangBehavior": matrixBangBehavior/);
  assert.match(apiClient, /isMatrix = raw\?\["isMatrix"\] as\? Bool \?\? false/);
  assert.match(apiClient, /matrixBangBehavior = raw\?\["matrixBangBehavior"\] as\? String \?\? "present"/);
  assert.match(apiClient, /struct CoordinatorImportResult: Identifiable/);
  assert.match(apiClient, /let sourceFiles: \[String: String\]/);
  assert.match(apiClient, /let warnings: \[String\]/);
  assert.match(backendMain, /MAX_SOURCE_FILE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(backendMain, /source file is too large/);
  assert.match(backendMain, /path\.stat\(\)\.st_size/);
  assert.match(backendMain, /async def _read_capped_json_request/);
  assert.match(backendMain, /matrixBangBehavior must be present or exclude/);
  assert.match(backendMain, /matrix_bang_behavior=matrix_bang_behavior/);
  assert.match(backendMain, /def _absolute_local_path/);
  assert.doesNotMatch(coordinatorImport, /\/Users\/cashbailey\/Downloads/);
  assert.match(coordinatorImport, /def default_coordinator_docx_paths/);
  assert.match(coordinatorImport, /Path\.home\(\) \/ "Downloads"/);
  assert.match(backendMain, /default_paths = default_coordinator_docx_paths\(\)/);
  assert.match(backendReadme, /25 MiB source-file cap/);
  assert.match(backendReadme, /current user's Downloads folder/);
  assert.match(reviewSheet, /if result\.importMeta\.isMatrix/);
  assert.match(reviewSheet, /Layout: week-grid roster \(B\/!B marks\)/);
  assert.match(reviewSheet, /showsMatrixBangPicker/);
  assert.match(reviewSheet, /Picker\("!B cells"/);
  assert.match(reviewSheet, /Text\("Include"\)\.tag\("present"\)/);
  assert.match(reviewSheet, /Text\("Exclude"\)\.tag\("exclude"\)/);
  assert.match(coordinatorReviewSheet, /Review Coordinator DOCX Import/);
  assert.match(coordinatorReviewSheet, /Apply DOCX Import/);
  assert.match(coordinatorReviewSheet, /Source Files/);

  assert.match(verificationMap, /T-SCH-BACKEND-002/);
  assert.match(verificationMap, /T-SCH-BACKEND-003/);
  assert.match(verificationMap, /T-SCH-BACKEND-004/);
  assert.match(verificationMap, /25 MiB/);
  assert.match(verificationMap, /oversized request-body\/source rejection/);
  assert.match(verificationMap, /relative\/URL path rejection/);
  assert.match(verificationMap, /XLSX\/XLSM matrix rosters/);
  assert.match(verificationMap, /matrix `\.xlsx`\/`\.xlsm`/);
  assert.match(verificationMap, /matrixBangBehavior/);
  assert.match(verificationMap, /matrix `!B` choice/);
});

test("native Sources screen reviews imports and preserves source operations", () => {
  const sources = read("macos/PediatricScheduler/View/SourcesView.swift");
  const models = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const rosterImport = read("backend_py/roster_import.py");
  const backendExports = read("backend_py/domain/exports.py");
  const sharedScheduler = read("shared/scheduler/scheduler.js");
  const commands = read("backend_py/domain/commands.py");
  const sharedCommands = read("shared/scheduler/commands.js");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(sources, /List\(selection: \$selectedSourceId\)/);
  assert.match(sources, /SourceListRow\(source: source\)/);
  assert.match(sources, /SourceRowsPreview\(source: source\)/);
  assert.match(sources, /sourceWarnings\(source\)/);
  assert.match(sources, /import warning/);
  assert.match(sources, /source\.importWarnings\.prefix\(5\)/);
  assert.match(sources, /Text\(content\)[\s\S]{0,250}\.textSelection\(\.enabled\)/);
  assert.match(sources, /@State private var manualSourceName = "Manual source"/);
  assert.match(sources, /private var manualSourceComposer: some View/);
  assert.match(sources, /Label\("Add Note", systemImage: "note\.text\.badge\.plus"\)/);
  assert.match(sources, /private func addManualSource\(\)/);
  assert.match(sources, /await store\.run\(\s*"source\.add"/);
  assert.match(sources, /chooseRosterFile\(replacing: source\)/);
  assert.match(sources, /Choose a template roster or week-grid Excel roster to import/);
  assert.match(sources, /Choose a replacement template or week-grid Excel roster/);
  assert.match(sources, /replaceSourceId: source\?\.id/);
  assert.match(sources, /pendingRosterImport = try await store\.previewRosterFile\(/);
  assert.match(sources, /onConfirm: \{ columnMapping, matrixBangBehavior in/);
  assert.match(sources, /matrixBangBehavior: matrixBangBehavior/);
  assert.match(sources, /\.sheet\(item: \$pendingCoordinatorImport\)/);
  assert.match(sources, /CoordinatorImportReviewSheet\(/);
  assert.match(sources, /pendingCoordinatorImport = try await store\.previewCoordinatorDocx\(/);
  assert.match(sources, /let ok = await store\.commitCoordinatorImportResult\(result\)/);
  assert.match(sources, /store\.run\("source\.delete", input: \["sourceId": source\.id\]\)/);
  assert.match(sources, /confirmationDialog\("Delete source record\?"/);
  assert.match(sources, /SourcesCoordinatorBundleSelection\(urls: urls\)/);
  assert.match(sources, /SourcesImportProbe/);
  assert.match(sources, /PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT/);
  assert.match(sources, /native-ui-sources-import\.json/);
  assert.match(sources, /runSourcesImportProbeIfRequested/);
  assert.match(sources, /native-source-import-audit\.csv/);
  assert.match(sources, /let preview = try await store\.previewRosterFile\(csvURL, mode: \.merge\)/);
  assert.match(sources, /let committed = await store\.commitRosterImportResult\(preview\)/);

  assert.match(models, /var importWarningCount: Int\?/);
  assert.match(models, /var importWarnings: \[String\]/);
  assert.match(models, /var warningCount: Int/);
  assert.match(rosterImport, /"importWarningCount": len\(warnings\)/);
  assert.match(rosterImport, /"importWarnings": warnings\[:100\]/);
  assert.match(backendExports, /"importWarningCount"/);
  assert.match(backendExports, /"rows", "importWarningCount"/);
  assert.match(sharedScheduler, /importWarningCount: source\.importWarningCount \?\? \(Array\.isArray\(source\.importWarnings\)/);
  assert.match(sharedScheduler, /"rows", "importWarningCount"/);

  assert.match(commands, /def _cmd_source_add\(state: dict, type_: str, input_: dict\) -> Result:/);
  assert.match(commands, /next_state = add_source\(state/);
  assert.match(commands, /"source\.add": _cmd_source_add/);
  assert.match(sharedCommands, /function commandSourceAdd\(state, type, input\)/);
  const commandHandlers = parseSharedCommandHandlers(sharedCommands);
  assert.equal(commandHandlers.get("source.add"), "commandSourceAdd");
  assert.equal(commandHandlers.get("source.delete"), "commandSourceDelete");
  assert.equal(commandHandlers.get("source.remove"), "commandSourceDelete");
  assert.match(commandTests, /source commands add reviewed notes and delete source records without touching rotators/);
  assert.match(commandTests, /duplicate_source/);
  assert.match(backendTests, /test_source_add_manual_note_persists_reviewed_source/);
  assert.match(backendTests, /"type": "source\.add"/);
  assert.match(backendTests, /"duplicate_source"/);
  assert.match(commandInventory, /\| `source\.add` \| Native Sources manual note composer/);
  assert.match(commandInventory, /T-SCH-CMD-009/);

  assert.match(verificationMap, /T-SCH-BACKEND-005/);
  assert.match(verificationMap, /T-SCH-CMD-009/);
  assert.match(verificationMap, /Native Sources review lists decoded source records/);
  assert.match(verificationMap, /import warning metadata/);
});

test("native Clinics screen wires placement to backend commands", () => {
  const clinics = read("macos/PediatricScheduler/View/ClinicsView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const models = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");
  const settings = read("macos/PediatricScheduler/View/SettingsView.swift");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(clinics, /@State private var selectedOccurrenceId = ""/);
  assert.match(clinics, /@State private var clinicsEditProbeStarted = false/);
  assert.match(clinics, /Picker\("Clinic", selection: \$selectedOccurrenceId\)/);
  assert.match(clinics, /Picker\("Rotator", selection: \$selectedRotatorId\)/);
  assert.match(clinics, /await store\.run\("clinic\.assign", input: input\)/);
  assert.match(clinics, /await store\.run\("clinic\.delete", input: \["assignmentRef": assignment\.id\]\)/);
  assert.match(clinics, /runClinicsEditProbeIfRequested/);
  assert.match(clinics, /private enum ClinicsEditProbe/);
  assert.match(clinics, /PEDI_SCHEDULER_CLINICS_EDIT_AUDIT/);
  assert.match(clinics, /native-ui-clinics-edit\.json/);
  assert.match(clinics, /let targetOccurrenceId = "clinic-occurrence::alder::clinic-edit-monday-am::2027-01-04::AM"/);
  assert.match(clinics, /let targetRotatorId = "rot-clinics-edit-1"/);
  assert.match(clinics, /assignmentStillPresent/);
  assert.match(clinics, /private func selectableOccurrences\(block: ServiceBlock, state: SchedulerState\) -> \[ClinicOccurrence\]/);
  assert.match(clinics, /expandClinicOccurrences\(state: state, startDate: block\.startDate, endDate: block\.endDate\)/);
  assert.match(clinics, /private func effectiveAssignments\(state: SchedulerState, block: ServiceBlock\) -> \[ClinicAssignment\]/);
  assert.match(clinics, /private func eligibleRotators\(on date: String, occurrence: ClinicOccurrence\?, state: SchedulerState\) -> \[Rotator\]/);
  assert.match(clinics, /roleAllowed\(rotator: \$0, occurrence: occurrence\)/);
  assert.match(clinics, /allowedRoles: normalizedClinicRoles\(slot\.allowedRoles\)/);
  assert.match(clinics, /Label\(occurrence\.allowedRoles\.joined\(separator: ", "\), systemImage: "person\.2"\)/);
  assert.match(clinics, /private struct ClinicOccurrenceCard: View/);
  assert.match(clinics, /attending\.recurringClinics \?\? \[\]/);
  assert.match(clinics, /attending\.oneOffDates \?\? \[\]/);

  assert.match(models, /var allowedRoles: \[String\]\?/);

  assert.match(settings, /AttendingProfileSettings\(/);
  assert.match(settings, /private let clinicPolicyRoles = \["Resident", "Fellow", "Student"\]/);
  assert.match(settings, /@State private var draftRecurring: \[RecurringClinic\] = \[\]/);
  assert.match(settings, /@State private var draftOneOffs: \[OneOffClinic\] = \[\]/);
  assert.match(settings, /onSaveProfile: \{ recurring, oneOffs in\s+saveAttendingProfile\(attending: attending, recurring: recurring, oneOffs: oneOffs\)/);
  assert.match(settings, /private func saveAttendingProfile\(attending: Attending, recurring: \[RecurringClinic\], oneOffs: \[OneOffClinic\]\)/);
  assert.match(settings, /"recurringClinics": recurring\.map\(recurringPayload\)/);
  assert.match(settings, /"oneOffDates": oneOffs\.map\(oneOffPayload\)/);
  assert.match(settings, /payload\["allowedRoles"\] = allowedRoles/);
  assert.match(settings, /ClinicRolePolicyMenu\(/);
  assert.match(settings, /toggleRecurringAllowedRole/);
  assert.match(settings, /toggleOneOffAllowedRole/);
  assert.match(settings, /Label\("Save Clinic Profile", systemImage: "checkmark"\)/);
  assert.doesNotMatch(settings, /onUpdateRecurring|onUpdateOneOff|onToggleRecurring|onAddOneOff|onRemoveOneOff/);

  assert.match(verificationMap, /T-SCH-BACKEND-006/);
  assert.match(verificationMap, /T-SCH-NATIVE-023/);
  assert.match(verificationMap, /T-SCH-CMD-006[\s\S]*`allowedRoles`/);
  assert.match(verificationMap, /T-SCH-NATIVE-025[\s\S]*`allowedRoles`/);
  assert.match(verificationMap, /Native Clinics lists generated attending clinic occurrences/);
  assert.match(verificationMap, /clinics-edit\/native-ui-clinics-edit\.json/);

  assert.match(requirements, /\| PNS-CAL-007 .*`allowedRoles`/);
  assert.match(requirements, /\| PNS-OPEN-014 .*`allowedRoles`/);
  assert.match(commandInventory, /\| `clinic\.assign` .*`allowedRoles`/);
  assert.match(commandInventory, /\| `conflicts\.list` .*`clinic-role-mismatch`/);
});

test("native Reports screen wires reports, conflicts, and exports", () => {
  const commands = read("backend_py/domain/commands.py");
  const backendReports = read("backend_py/domain/reports.py");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const sharedCommands = read("shared/scheduler/commands.js");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const schedulerModels = read("macos/PediatricScheduler/Model/SchedulerModels.swift");
  const reports = read("macos/PediatricScheduler/View/ReportsView.swift");
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const inpatient = read("macos/PediatricScheduler/View/InpatientView.swift");
  const outpatient = read("macos/PediatricScheduler/View/OutpatientView.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const clinics = read("macos/PediatricScheduler/View/ClinicsView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");
  const requirements = read("docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md");

  assert.match(commands, /from backend_py\.domain\.word_exports import build_word_exports/);
  assert.match(commands, /"export\.word": _cmd_export_word/);
  assert.match(backendTests, /test_export_word_command_returns_docx_files_without_mutation/);
  assert.match(backendReports, /is_rotator_active_on/);
  assert.match(backendReports, /def _rotator_ids_in_legend\(state: dict\[str, Any\], block: dict\[str, Any\]\) -> set\[str\]:/);
  assert.match(backendReports, /def _scheduled_rotator_ids_in_block\(state: dict\[str, Any\], block: dict\[str, Any\]\) -> set\[str\]:/);
  assert.match(backendReports, /"type": "missing-legend"/);
  assert.match(backendTests, /test_conflicts_list_pins_individual_post_hoc_conflict_types/);
  assert.match(backendTests, /by_type\["missing-legend"\]\[0\]\["rotatorId"\] == "r-phantom"/);
  assert.match(backendTests, /by_type\["holiday-clinic"\]\[0\]\["date"\] == "2026-05-06"/);
  assert.match(backendTests, /by_type\["outpatient-weekend"\]\[0\]\["date"\] == "2026-05-09"/);
  assert.match(commands, /POST_FINAL_LEDGER_EXEMPT_COMMANDS = \{"block\.add", "block\.use", "block\.delete"\}/);
  assert.match(commands, /def _with_post_final_change\(state: dict, type_: str, input_: dict, result: Result\) -> Result:/);
  assert.match(commands, /input_\.get\("postFinalReason"\) or input_\.get\("changeReason"\) or input_\.get\("reason"\)/);
  assert.match(commands, /"postFinalChanges": \[/);
  assert.match(commands, /"data": \{\*\*\(result\.get\("data"\) or \{\}\), "postFinalChange": entry\}/);
  assert.match(backendTests, /Corrected display title after final review/);
  assert.match(backendTests, /post_final\["data"\]\["postFinalChange"\] == post_final_changes\[0\]/);
  assert.match(backendTests, /persisted_block\["postFinalChanges"\] == post_final_changes/);
  assert.match(sharedCommands, /const POST_FINAL_LEDGER_EXEMPT_COMMANDS = new Set\(\["block\.add", "block\.use", "block\.delete"\]\)/);
  assert.match(sharedCommands, /function withPostFinalChange\(state, type, input, result\)/);
  assert.match(sharedCommands, /input\.postFinalReason \|\| input\.changeReason \|\| input\.reason/);
  assert.match(sharedCommands, /postFinalChanges: \[/);
  assert.match(sharedCommands, /data: \{ \.\.\.\(result\.data \|\| \{\}\), postFinalChange: entry \}/);
  assert.match(commandTests, /Corrected display title after final review/);
  assert.match(commandTests, /result\.data\.postFinalChange/);
  assert.match(schedulerModels, /var postFinalChanges: \[PostFinalChange\]\?/);
  assert.match(schedulerModels, /struct PostFinalChange: Decodable, Identifiable/);
  assert.match(schedulerModels, /var displayReason: String/);
  assert.match(schedulerModels, /var displayMetadata: String/);

  assert.match(reports, /Picker\("Date", selection: \$date\)/);
  assert.match(reports, /@State private var conflictScope = conflictScopeDate/);
  assert.match(reports, /Picker\("Conflict Scope", selection: \$conflictScope\)/);
  assert.match(reports, /Text\("This Date"\)\.tag\(conflictScopeDate\)/);
  assert.match(reports, /Text\("All Dates"\)\.tag\(conflictScopeAll\)/);
  assert.match(reports, /return ScrollView \{/);
  assert.match(reports, /Button \{\s*loadConflicts\(\)/);
  assert.match(reports, /reviewFinalizePanel\(review: review, block: block\)/);
  assert.match(reports, /Label\("Review & Finalize", systemImage: "checkmark\.seal"\)/);
  assert.match(reports, /FinalReviewLine/);
  assert.match(reports, /Button \{\s*loadFinalReview\(\)/);
  assert.match(reports, /Label\("Load Review Checks", systemImage: "checklist"\)/);
  // Mark Final is destructive-ish (stamps the block Final), so the button
  // opens a confirmation dialog and only the dialog runs the command.
  assert.match(reports, /Button \{\s*confirmingMarkFinal = true/);
  assert.match(reports, /\.confirmationDialog\("Mark this block final\?", isPresented: \$confirmingMarkFinal\)/);
  assert.match(reports, /Button\("Mark Final"\) \{\s*markFinal\(block: block, review: review\)/);
  assert.match(reports, /Label\("Mark Final", systemImage: "checkmark\.seal"\)/);
  assert.match(reports, /\.disabled\(!review\.canMarkFinal \|\| isFinalizing\)/);
  assert.match(reports, /\.disabled\(!review\.canBuildFinalPacket \|\| isExportingHandoffPacket\)/);
  assert.ok(
    (reports.match(/\.disabled\(!review\.canBuildFinalPacket \|\| isExportingHandoffPacket\)/g) ?? []).length >= 2,
    "both combined handoff packet buttons should be gated by final review readiness"
  );
  assert.match(reports, /Button \{\s*exportHandoffPacket\(\)/);
  assert.match(reports, /Label\("Build Handoff Packet", systemImage: "archivebox"\)/);
  assert.match(reports, /Button \{\s*exportPackage\(\)/);
  assert.match(reports, /Button \{\s*exportPDFs\(\)/);
  assert.match(reports, /Button \{\s*exportWordDocs\(\)/);
  assert.match(reports, /exportReviewPanel\(\)/);
  assert.match(reports, /@State private var selectedExportFileName = ""/);
  assert.match(reports, /@State private var acceptedExportReview = false/);
  assert.match(reports, /private var exportReviewFiles: \[ExportReviewFile\]/);
  assert.match(reports, /private var exportReviewFingerprint: String/);
  assert.match(reports, /store\.lastExportFolderPath/);
  assert.match(reports, /store\.lastExportFileNames\.map \{ ExportReviewFile\(name: \$0\) \}/);
  assert.match(reports, /Label\("Export Review", systemImage: "checklist"\)/);
  assert.match(reports, /ExportReviewSummary\(files: files\)/);
  assert.match(reports, /ExportReviewLine\(title: "Package"/);
  assert.match(reports, /ExportReviewLine\(title: "PDF"/);
  assert.match(reports, /ExportReviewLine\(title: "Word"/);
  assert.match(reports, /ExportReviewLine\(title: "CSV"/);
  assert.match(reports, /Picker\("Review File", selection: \$selectedExportFileName\)/);
  assert.match(reports, /Label\("Show File", systemImage: "doc\.viewfinder"\)/);
  assert.match(reports, /Label\("Show in Finder", systemImage: "arrow\.up\.forward\.app"\)/);
  assert.match(reports, /Label\("Copy Path", systemImage: "doc\.on\.doc"\)/);
  assert.match(reports, /Label\(acceptedExportReview \? "Accepted" : "Accept Handoff", systemImage: acceptedExportReview \? "checkmark\.seal\.fill" : "checkmark\.seal"\)/);
  assert.match(reports, /\.disabled\(!summary\.isHandoffReady \|\| acceptedExportReview\)/);
  assert.match(reports, /store\.revealLastExportFile\(named: selected\.name\)/);
  assert.match(reports, /store\.revealLastExportFolder\(\)/);
  assert.match(reports, /store\.copyLastExportPath\(\)/);
  assert.match(reports, /await store\.run\("report\.daily", input: \["date": date\]\)/);
  assert.match(reports, /await store\.loadConflicts\(date: conflictScope == conflictScopeAll \? nil : date\)/);
  assert.match(reports, /await store\.loadConflicts\(date: nil\)/);
  assert.match(reports, /await store\.run\("block\.update", input: \[/);
  assert.match(reports, /"patch": \[\s*"status": "Final",/);
  assert.match(reports, /"finalizedAt": finalizedAt/);
  assert.match(reports, /"finalizedBy": "Native Reports Review & Finalize"/);
  assert.match(reports, /"finalReview": \[/);
  assert.match(reports, /"criticalConflictCount": review\.criticalConflictCount/);
  assert.match(reports, /"warningConflictCount": review\.warningConflictCount/);
  assert.match(reports, /"openSlots": review\.openSlots/);
  assert.match(reports, /"missingSourcePrograms": review\.missingSourcePrograms/);
  assert.match(reports, /"reason": "Reports Review & Finalize checks passed"/);
  assert.ok(reports.includes('Label("Finalized \\(finalizedAt)", systemImage: "clock.badge.checkmark")'));
  assert.match(reports, /PostFinalChangesReportSection\(changes: postFinalChanges\)/);
  assert.match(reports, /private struct PostFinalChangesReportSection: View/);
  assert.match(reports, /Label\("Post-Final Changes", systemImage: "exclamationmark\.arrow\.triangle\.2\.circlepath"\)/);
  assert.match(reports, /reports-post-final-changes-section/);
  assert.match(reports, /reports-post-final-changes-count/);
  assert.match(reports, /reports-post-final-change-row-/);
  assert.match(reports, /await store\.exportHandoffPacket\(\)/);
  assert.match(reports, /await store\.exportPackage\(\)/);
  assert.match(reports, /await store\.exportPDFs\(\)/);
  assert.match(reports, /await store\.exportWordDocs\(\)/);
  assert.match(reports, /ReportsHandoffProbe/);
  assert.match(reports, /PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT/);
  assert.match(reports, /native-ui-reports-handoff\.json/);
  assert.match(reports, /runReportsHandoffProbeIfRequested/);
  assert.match(reports, /await store\.loadConflicts\(date: nil\)/);
  assert.match(reports, /await store\.exportHandoffPacket\(\)/);
  assert.match(reports, /"exportDescription": store\.lastExportDescription \?\? ""/);
  assert.match(reports, /"hasPDFs": hasPDFs/);
  assert.match(reports, /"hasWordDocs": hasWordDocs/);
  assert.match(reports, /"exportReviewReady": exportReviewSummary\.isHandoffReady/);
  assert.match(reports, /"exportReviewAccepted": exportReviewAccepted/);
  assert.match(reports, /"exportReviewFileCount": exportReviewSummary\.fileCount/);
  assert.match(reports, /"exportReviewPackageCount": exportReviewSummary\.packageCount/);
  assert.match(reports, /"exportReviewPDFCount": exportReviewSummary\.pdfCount/);
  assert.match(reports, /"exportReviewWordCount": exportReviewSummary\.wordCount/);
  assert.match(reports, /"exportReviewCSVCount": exportReviewSummary\.csvCount/);
  // The daily report is keyed by date AND block so a block switch can't
  // show another block's report as current.
  assert.match(reports, /let reportText = store\.lastReportDate == reportDate && store\.lastReportBlockId == block\.id/);
  assert.match(reports, /let conflictQueryKey = conflictScope == conflictScopeAll \? AppStore\.allConflictsQueryKey : reportDate/);
  assert.match(reports, /let conflictsLoadedForScope = store\.lastConflictsQueryKey == conflictQueryKey/);
  assert.match(reports, /store\.lastConflictsBlockId == block\.id/);
  assert.match(reports, /let visibleConflicts = conflictsLoadedForScope \? store\.lastConflicts : \[\]/);
  assert.match(reports, /ForEach\(visibleConflicts\)/);
  assert.match(reports, /store\.focus\(conflict\)/);
  assert.match(reports, /HalfDayFactsReportSection/);
  assert.match(reports, /private struct ReportsReviewSummary/);
  assert.match(reports, /private struct ExportReviewFile/);
  assert.match(reports, /private struct ExportReviewSummary/);
  assert.match(reports, /var isHandoffReady: Bool/);
  assert.match(reports, /hasManifest && hasSchedulePackage && pdfCount > 0 && wordCount > 0 && csvCount > 0/);
  assert.match(reports, /let missingSourcePrograms: \[String\]/);
  assert.match(reports, /var canMarkFinal: Bool/);
  assert.match(reports, /var canBuildFinalPacket: Bool/);
  assert.match(reports, /let finalizedAt: String\?/);
  assert.match(reports, /criticalConflictCount/);
  assert.match(reports, /openSlots/);
  assert.match(reports, /let scopedConflicts = allConflictsLoaded\s*\?\s*conflicts\.filter \{ \$0\.date\.isEmpty \|\| dateSet\.contains\(\$0\.date\) \}\s*:\s*\[\]/);
  assert.match(reports, /criticalConflictCount = scopedConflicts\.filter \{\s*\$0\.severity\.localizedCaseInsensitiveContains\("critical"\)\s*\}\.count/);
  assert.match(reports, /state\.inpatientAssignments\.filter \{ !\$0\.isOff \}/);
  assert.match(reports, /let target = block\.inpatientCoverageTarget\(on: day\)/);
  assert.match(reports, /open \+= max\(0, target - count\)/);
  assert.match(reports, /let expected = uniquePrograms\(state\.expectedSourcePrograms \?\? \[\]\)/);
  assert.ok(reports.includes("filter(\\.isReviewed)"));
  assert.match(reports, /dates\.contains \{ rotator\.isActive\(on: \$0\) \}/);
  assert.match(reports, /return !reviewedKeys\.contains\(key\) && !activeKeys\.contains\(key\)/);
  assert.match(reports, /var blockerCount: Int \{\s*\(allConflictsLoaded \? criticalConflictCount : 1\) \+ openSlots \+ missingSourcePrograms\.count\s*\}/);
  assert.match(reports, /var canMarkFinal: Bool \{\s*!isFinal && allConflictsLoaded && blockerCount == 0\s*\}/);
  assert.match(reports, /var canBuildFinalPacket: Bool \{\s*isFinal && allConflictsLoaded && blockerCount == 0\s*\}/);
  assert.match(reports, /if isFinal && !allConflictsLoaded \{ return "Review needed" \}/);

  assert.match(appStore, /static let allConflictsQueryKey = "__all__"/);
  assert.match(appStore, /@Published var lastReportDate: String\?/);
  assert.match(appStore, /@Published var lastConflictsDate: String\?/);
  assert.match(appStore, /@Published var lastConflictsQueryKey: String\?/);
  assert.match(appStore, /@Published var lastConflictsBlockId: String\?/);
  assert.match(appStore, /@Published var lastExportFolderPath: String\?/);
  assert.match(appStore, /@Published var lastExportDescription: String\?/);
  assert.match(appStore, /@Published var lastExportFileNames: \[String\] = \[\]/);
  assert.match(appStore, /lastReportDate = type == "report\.daily" \? input\["date"\] as\? String : nil/);
  assert.match(appStore, /let filteredDate = date\?\.isEmpty == false \? date : nil/);
  assert.match(appStore, /lastConflictsDate = filteredDate/);
  assert.match(appStore, /lastConflictsQueryKey = filteredDate \?\? Self\.allConflictsQueryKey/);
  assert.match(appStore, /lastConflictsBlockId = state\?\.activeBlock\?\.id/);
  assert.match(appStore, /private func clearConflictResults\(\)/);
  assert.match(appStore, /private func shouldClearConflictResults\(after type: String, input: \[String: Any\]\) -> Bool/);
  assert.match(appStore, /Set\(patch\.keys\)\.isSubset\(of: Set\(\["status", "finalizedAt", "finalizedBy", "finalReview"\]\)\)/);
  assert.match(appStore, /func exportPackage\(\) async/);
  assert.match(appStore, /api\.command\(type: "export\.package"\)/);
  assert.match(appStore, /try writeExportPackage\(package\)/);
  assert.match(appStore, /func exportPDFs\(\) async/);
  assert.match(appStore, /api\.command\(type: "export\.pdfs"\)/);
  assert.match(appStore, /try writePDFExports\(files\)/);
  assert.match(appStore, /func exportWordDocs\(\) async/);
  assert.match(appStore, /api\.command\(type: "export\.word"\)/);
  assert.match(appStore, /try writeBase64Exports\(files\)/);
  assert.match(appStore, /func exportHandoffPacket\(\) async/);
  assert.match(appStore, /let packageResult = try await api\.command\(type: "export\.package"\)/);
  assert.match(appStore, /let pdfResult = try await api\.command\(type: "export\.pdfs"\)/);
  assert.match(appStore, /let wordResult = try await api\.command\(type: "export\.word"\)/);
  assert.match(appStore, /folder\.appendingPathComponent\("PDFs", isDirectory: true\)/);
  assert.match(appStore, /folder\.appendingPathComponent\("Word", isDirectory: true\)/);
  // A failed handoff export must remove the partial folder rather than leave
  // a misleading half-written packet in Downloads.
  assert.match(appStore, /try\? FileManager\.default\.removeItem\(at: root\)/);
  assert.match(appStore, /Handoff packet export failed/);
  assert.match(appStore, /func revealLastExportFolder\(\)/);
  assert.match(appStore, /NSWorkspace\.shared\.activateFileViewerSelecting\(\[folder\]\)/);
  assert.match(appStore, /func revealLastExportFile\(named fileName: String\)/);
  assert.match(appStore, /file\.path\.hasPrefix\(folderPath\)/);
  assert.match(appStore, /NSWorkspace\.shared\.activateFileViewerSelecting\(\[file\]\)/);
  assert.match(appStore, /func copyLastExportPath\(\)/);
  assert.match(appStore, /NSPasteboard\.general/);
  assert.match(appStore, /private func rememberExport\(_ export: ExportWriteResult, description: String\)/);
  assert.match(appStore, /lastExportFileNames = export\.files\.map/);
  assert.match(appStore, /func loadConflicts\(date: String\? = nil\) async/);
  assert.match(appStore, /api\.command\(type: "conflicts\.list", input: input\)/);
  assert.match(appStore, /func focus\(_ conflict: ConflictSummary\)/);

  assert.match(commandInventory, /\| `block\.update` \| Native Settings block editor and Reports Review & Finalize panel/);
  assert.match(commandInventory, /final status, final review metadata, and post-final change reasons/);
  assert.match(commandInventory, /T-SCH-CMD-013/);
  assert.match(commandInventory, /\| `export\.word` \| Native Reports export and handoff packet buttons/);
  assert.match(commandInventory, /editable Word\/DOCX schedule, daily report, and roster\/legend/);
  assert.match(verificationMap, /editable Word handoff files/);
  assert.match(verificationMap, /export review\/acceptance/);
  assert.match(verificationMap, /T-SCH-CMD-013/);
  assert.match(verificationMap, /Post-final edits append a durable change-reason ledger/);
  assert.match(verificationMap, /data\.postFinalChange/);
  assert.match(requirements, /\| PNS-EXP-007 \| Export versioning, timestamp\/exporter metadata, finalization, and change reasons are confirmed\. \| SHIPPED \/ TEST-ENFORCED \|/);
  assert.match(requirements, /\| PNS-OPEN-019 \| Export versioning, finalization, and change-reason metadata \| SHIPPED \/ TEST-ENFORCED \|/);
  assert.match(requirements, /post-final edits append durable change reasons and native Reports surfaces the ledger/);
  assert.match(requirements, /Post-final edit reason ledger is shipped/);
  assert.doesNotMatch(requirements, /Durable post-final edit reason ledger remains open/);

  for (const targetView of [inpatient, outpatient, planningGrid, clinics]) {
    assert.match(targetView, /ScrollViewReader/);
    assert.match(targetView, /private func scrollToFocus\(proxy: ScrollViewProxy, block: ServiceBlock\)/);
    assert.match(targetView, /proxy\.scrollTo\(focus\.date, anchor: \.center\)/);
    assert.match(targetView, /scrollToFocus\(proxy: proxy, block: block\)/);
  }
  assert.match(inpatient, /focus\?\.matches\(inpatient: a\) == true/);
  assert.match(outpatient, /focus\?\.matches\(outpatient: session\) == true/);
  assert.match(planningGrid, /cellMatchesFocus\(cell\)/);
  assert.match(planningGrid, /chipMatchesFocus\(chip\)/);
  assert.match(clinics, /focus\?\.matches\(clinic: assignment\) == true/);
  for (const targetView of [inpatient, outpatient, planningGrid, clinics]) {
    assert.match(targetView, /Color\.accentColor\.opacity\(0\.(?:10|12|18)\)/);
  }

  assert.match(verificationMap, /T-SCH-CMD-004/);
  assert.match(verificationMap, /T-SCH-BACKEND-007/);
  assert.match(verificationMap, /selected date or review all dates/);
  assert.match(verificationMap, /individual post-hoc rows for day-off\/unavailable, no-clinic holiday, weekend outpatient, inpatient\/outpatient continuity, missing legend/);
  assert.match(verificationMap, /ScrollViewReader[\s\S]*scroll the focused date into view/);
  assert.match(verificationMap, /Native Reports and exports include final clinic placements/);
  assert.match(verificationMap, /Review & Finalize panel loads block-scoped all-date conflicts/);
  assert.match(verificationMap, /stamps final review metadata/);
  assert.match(verificationMap, /marks clean blocks Final/);
  assert.match(verificationMap, /gates the combined final handoff packet/);
  assert.match(verificationMap, /records the last export folder, supports selected-file Finder reveal, and exposes export review\/acceptance/);
  assert.match(requirements, /\| PNS-CONF-005 \| Detect no-clinic outpatient sessions\. \| SHIPPED \/ TEST-ENFORCED \|/);
  assert.match(requirements, /\| PNS-CONF-007 \| Detect missing legend entries and legend\/schedule mismatch\. \| SHIPPED \/ TEST-ENFORCED \|/);
  assert.match(requirements, /\| PNS-CONF-011 \| Original post-hoc conflict checks are individually confirmed\. \| SHIPPED \/ TEST-ENFORCED \|/);
});

test("native Planning Grid consumes grid.show and exposes service display filters", () => {
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const sharedCommands = read("shared/scheduler/commands.js");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(sharedCommands, /function planningGridEffectiveBlock\(state, block, input\)/);
  assert.match(sharedCommands, /const PEEK_BUFFER_DAYS = 14;/);
  assert.match(sharedCommands, /extendBlockStart\(out, PEEK_BUFFER_DAYS\)/);
  assert.match(sharedCommands, /extendBlockEnd\(out, PEEK_BUFFER_DAYS\)/);
  assert.match(sharedCommands, /rawStartDate: block\.startDate/);
  assert.match(sharedCommands, /rawEndDate: block\.endDate/);
  assert.match(sharedCommands, /effectiveStartDate: effectiveBlock\.startDate/);
  assert.match(sharedCommands, /effectiveEndDate: effectiveBlock\.endDate/);
  assert.match(sharedCommands, /peekBeforeBlock: Boolean\(input\.peekBeforeBlock\)/);
  assert.match(sharedCommands, /peekPastBlock: Boolean\(input\.peekPastBlock\)/);
  assert.match(commandTests, /grid\.show command returns prior\/past peek metadata and effective dates/);
  assert.match(appStore, /@Published var planningGrid: PlanningGridProjection\?/);
  assert.match(appStore, /func loadPlanningGrid\(blockRef: String\? = nil, peekBeforeBlock: Bool = false, peekPastBlock: Bool = false\) async/);
  assert.match(appStore, /api\.command\(type: "grid\.show"/);
  assert.match(appStore, /struct PlanningGridProjection/);
  assert.match(appStore, /sectionRotatorIds: \[String: Set<String>\]/);

  assert.match(planningGrid, /@State private var displayMode: PlanningDisplayMode = \.master/);
  assert.match(planningGrid, /Picker\("View", selection: \$displayMode\)/);
  assert.match(planningGrid, /PlanningDisplayMode\.allCases/);
  assert.match(planningGrid, /case master/);
  assert.match(planningGrid, /case inpatient/);
  assert.match(planningGrid, /case outpatient/);
  assert.match(planningGrid, /PlanningProjectionSummary/);
  // Coordinator 2026-07-29 #2/#3: one stable flat list with true per-row filter
  // tabs replaced the category sections.
  assert.match(planningGrid, /func matches\(_ row: PlanningGridRow\) -> Bool/);
  assert.match(planningGrid, /private func visibleRows\(\) -> \[PlanningGridRow\]/);
  assert.match(planningGrid, /localizedCaseInsensitiveCompare/);
  assert.match(planningGrid, /PlanningGridHeader\(displayMode: displayMode\)/);
  assert.match(planningGrid, /displayMode\.showsInpatient/);
  assert.match(planningGrid, /displayMode\.showsOutpatient/);

  assert.match(commandInventory, /Native Planning Grid projection summary/);
  assert.match(verificationMap, /T-SCH-NATIVE-003/);
  assert.match(verificationMap, /Master\/Inpatient\/Outpatient display filters/);
});

test("native Planning Grid renders a grid.show rotator-date matrix", () => {
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const sharedCommands = read("shared/scheduler/commands.js");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(sharedCommands, /function commandInpatientDrop\(state, type, input\)/);
  assert.match(sharedCommands, /validateDrop\(state, rotator\.id, input\.date\)/);
  const commandHandlers = parseSharedCommandHandlers(sharedCommands);
  assert.equal(commandHandlers.get("inpatient.drop"), "commandInpatientDrop");
  assert.equal(commandHandlers.get("inpatient.delete"), "commandInpatientDelete");
  assert.equal(commandHandlers.get("outpatient.delete"), "commandOutpatientDelete");
  assert.match(commandTests, /planning mutation commands support inpatient drop and assignment chip deletes/);
  assert.match(appStore, /let rows: \[PlanningGridRow\]/);
  assert.match(appStore, /let sectionRows: \[String: \[PlanningGridRow\]\]/);
  assert.match(appStore, /func rows\(in sectionId: String\) -> \[PlanningGridRow\]/);
  assert.match(appStore, /struct PlanningGridRow: Identifiable/);
  assert.match(appStore, /struct PlanningGridCell: Identifiable/);
  assert.match(appStore, /status != "absent"/);
  assert.match(appStore, /struct PlanningDayTotal: Identifiable/);

  assert.match(planningGrid, /PlanningMatrixView\(/);
  assert.match(planningGrid, /private struct PlanningMatrixView: View/);
  assert.match(planningGrid, /@State private var collapsedSections: Set<String>/);
  assert.match(planningGrid, /PlanningMatrixDateHeader/);
  assert.match(planningGrid, /PlanningMatrixSectionHeader/);
  assert.match(planningGrid, /projection\.rows\(in: sectionId\)/);
  assert.match(planningGrid, /PlanningMatrixCellView/);
  assert.match(planningGrid, /onPaintCell/);
  assert.match(planningGrid, /onDropRotator/);
  assert.match(planningGrid, /@State private var draggingRotatorId: String\?/);
  assert.match(planningGrid, /private enum PlanningDropValidator/);
  assert.match(planningGrid, /PlanningDropValidator\.validate/);
  assert.match(planningGrid, /activeDropFeedback/);
  assert.match(planningGrid, /Valid inpatient drop target/);
  assert.match(planningGrid, /Invalid drop target/);
  assert.match(planningGrid, /onInvalidDrop/);
  assert.match(planningGrid, /expectedRowRotatorId/);
  assert.match(planningGrid, /state\.rules\?\.maxConsecutiveInpatientDays/);
  assert.match(planningGrid, /already has an outpatient session/);
  assert.match(planningGrid, /PlanningEditProbe/);
  assert.match(planningGrid, /PEDI_SCHEDULER_PLANNING_EDIT_AUDIT/);
  assert.match(planningGrid, /native-ui-planning-edit\.json/);
  assert.match(planningGrid, /planning-grid-apply-button/);
  assert.match(planningGrid, /planning-grid-rotator-picker/);
  assert.match(planningGrid, /planning-grid-start-date/);
  assert.match(planningGrid, /planning-grid-end-date/);
  assert.match(planningGrid, /planning-grid-phase-picker/);
  assert.match(planningGrid, /planning-grid-matrix-row-/);
  assert.match(planningGrid, /planning-grid-cell-/);
  assert.match(planningGrid, /runPlanningEditProbeIfRequested/);
  assert.match(planningGrid, /await store\.run\("assign\.range"/);
  assert.match(planningGrid, /await store\.undo\(\)/);
  assert.match(planningGrid, /await store\.redo\(\)/);
  assert.match(planningGrid, /afterEditSource\.localizedCaseInsensitiveContains\("range"\)/);
  assert.match(planningGrid, /PlanningMatrixTotalsFooter/);
  assert.match(planningGrid, /PlanningMatrixTotalRow\(title: "Inpatient"/);
  assert.match(planningGrid, /PlanningMatrixTotalRow\(title: "Outpatient"/);
  assert.match(planningGrid, /PlanningMatrixTotalRow\(title: "Unassigned"/);

  assert.match(commandInventory, /rotator-by-date rows/);
  assert.match(commandInventory, /Native Planning Grid drop-target preview/);
  assert.match(verificationMap, /T-SCH-NATIVE-004/);
  assert.match(verificationMap, /rotator-by-date matrix/);
  assert.match(verificationMap, /valid drop-target feedback/);
});

test("native Planning Grid exposes staff rows above the matrix", () => {
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(appStore, /let staffKind: String\?/);
  assert.match(appStore, /var isAttendingProjection: Bool/);
  assert.match(appStore, /let staffTitles: \[String\]/);
  assert.match(appStore, /let staffPeriods: \[String\]/);
  assert.match(appStore, /status != "absent" && staffKind != "attending"/);

  assert.match(planningGrid, /@State private var showStaffRows = true/);
  assert.match(planningGrid, /Toggle\("Staff rows", isOn: \$showStaffRows\)/);
  assert.match(planningGrid, /staffRows\(projection: projection, block: block, state: state\)/);
  assert.match(planningGrid, /private func staffRows\(projection: PlanningGridProjection, block: ServiceBlock, state: SchedulerState\) -> \[PlanningGridRow\]/);
  assert.match(planningGrid, /row\.rotator\.isPediatricNeurologyFellow[\s\S]*row\.cells\.contains/);
  assert.match(planningGrid, /private func attendingStaffRows\(state: SchedulerState, dates: \[String\]\) -> \[PlanningGridRow\]/);
  assert.match(planningGrid, /private func outpatientDetails\(for session: OutpatientSession\)/);
  assert.match(planningGrid, /PlanningStaffSession/);
  assert.match(planningGrid, /sectionId: "staff"/);
  assert.match(planningGrid, /staffFellowIds/);
  assert.match(planningGrid, /row\.rotator\.isAttendingProjection/);
  assert.match(planningGrid, /Read-only attending projection/);
  assert.match(planningGrid, /Image\(systemName: "star\.fill"\)/);
  assert.match(planningGrid, /Image\(systemName: row\.rotator\.isAttendingProjection \? "stethoscope" : "line\.3\.horizontal"\)/);
  assert.match(planningGrid, /pinnedViews: \[\.sectionHeaders\]/);
  assert.match(planningGrid, /PlanningMatrixStickyLeading/);
  assert.match(planningGrid, /rawDateCount: rawDateCount/);
  assert.match(planningGrid, /\.frame\(minHeight: 260, maxHeight: \.infinity\)/);

  assert.match(commandInventory, /Native Planning Grid staff rows/);
  assert.match(verificationMap, /T-SCH-NATIVE-005/);
  assert.match(verificationMap, /read-only attending outpatient projections/);
});

test("native Planning Grid can peek past block end as read-only context", () => {
  const appStore = read("macos/PediatricScheduler/Store/AppStore.swift");
  const planningGrid = read("macos/PediatricScheduler/View/PlanningGridView.swift");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(appStore, /func loadPlanningGrid\(blockRef: String\? = nil, peekBeforeBlock: Bool = false, peekPastBlock: Bool = false\) async/);
  assert.match(appStore, /input\["peekPastBlock"\] = true/);
  assert.match(appStore, /input\["peekBeforeBlock"\] = true/);
  assert.match(appStore, /let rawStartDate: String\?/);
  assert.match(appStore, /let rawEndDate: String\?/);
  assert.match(appStore, /let effectiveStartDate: String\?/);
  assert.match(appStore, /let effectiveEndDate: String\?/);
  assert.match(appStore, /rawStartDate: result\.data\["rawStartDate"\] as\? String/);
  assert.match(appStore, /rawEndDate: result\.data\["rawEndDate"\] as\? String/);
  assert.match(appStore, /effectiveStartDate: result\.data\["effectiveStartDate"\] as\? String/);
  assert.match(appStore, /effectiveEndDate: result\.data\["effectiveEndDate"\] as\? String/);

  assert.match(planningGrid, /@State private var peekBeforeBlock = false/);
  assert.match(planningGrid, /@State private var peekPastBlock = false/);
  assert.match(planningGrid, /Toggle\("Peek before", isOn: \$peekBeforeBlock\)/);
  assert.match(planningGrid, /Toggle\("Peek past", isOn: \$peekPastBlock\)/);
  assert.match(planningGrid, /\.onChange\(of: peekBeforeBlock\)/);
  assert.match(planningGrid, /\.onChange\(of: peekPastBlock\)/);
  assert.match(planningGrid, /loadPlanningGrid\(blockRef: block\.id, peekBeforeBlock: peekBeforeBlock, peekPastBlock: peekPastBlock\)/);
  assert.match(planningGrid, /visibleRotatorIds: \(peekBeforeBlock \|\| peekPastBlock\) \? rawBlockActiveRotatorIds\(block: block, state: state\) : nil/);
  assert.match(planningGrid, /private func rawBlockActiveRotatorIds\(block: ServiceBlock, state: SchedulerState\) -> Set<String>/);
  assert.match(planningGrid, /let rawStartDate: String\?/);
  assert.match(planningGrid, /let rawEndDate: String\?/);
  assert.match(planningGrid, /isPeekDate\(_ date: String\) -> Bool/);
  assert.match(planningGrid, /\.disabled\(actionsDisabled \|\| !cell\.isEditable \|\| isPeek\)/);
  assert.match(planningGrid, /isPeek: isPeek/);
  assert.match(planningGrid, /isEditable: cell\.isEditable/);
  assert.match(planningGrid, /Read-only peek day/);
  assert.match(planningGrid, /Peek days are read-only/);

  assert.match(commandInventory, /Native Planning Grid peek before\/past block/);
  assert.match(verificationMap, /T-SCH-NATIVE-006/);
  assert.match(verificationMap, /read-only peek days/);
});

test("native Outpatient editor preserves nested session details", () => {
  const outpatient = read("macos/PediatricScheduler/View/OutpatientView.swift");
  const sharedCommands = read("shared/scheduler/commands.js");
  const backendCommands = read("backend_py/domain/commands.py");
  const commandTests = read("tests/scheduler-commands.test.mjs");
  const backendTests = read("backend_py/tests/test_command_routes.py");
  const commandInventory = read("docs/COMMAND_INVENTORY.md");
  const verificationMap = read("docs/VERIFICATION_MAP.md");

  assert.match(outpatient, /@State private var detailRows: \[OutpatientDetailDraft\]/);
  assert.match(outpatient, /@State private var editingSessionId: String\?/);
  assert.match(outpatient, /@State private var outpatientEditProbeStarted = false/);
  assert.match(outpatient, /Picker\("Date", selection: \$date\)/);
  assert.match(outpatient, /private func clinicOpenDates\(block: ServiceBlock\) -> \[String\]/);
  assert.match(outpatient, /!CalendarUtil\.isWeekend\(day\) && !noClinicDates\.contains\(day\)/);
  assert.match(outpatient, /private func selectableRotators\(block: ServiceBlock, state: SchedulerState\) -> \[Rotator\]/);
  assert.match(outpatient, /private func isEligibleForOutpatient\(_ rotator: Rotator, on day: String, block: ServiceBlock\) -> Bool/);
  assert.match(outpatient, /private func outpatientValidationMessage\(block: ServiceBlock, state: SchedulerState\) -> String\?/);
  assert.match(outpatient, /\.disabled\(isSaving \|\| selectedRotatorId\.isEmpty \|\| date\.isEmpty \|\| validationMessage != nil\)/);
  assert.match(outpatient, /"blockRef": store\.state\?\.activeBlock\?\.id \?\? ""/);
  assert.match(outpatient, /private var detailsEditor: some View/);
  assert.match(outpatient, /input\["details"\] = detailPayload/);
  assert.match(outpatient, /private func loadSessionForEditing\(_ session: OutpatientSession\)/);
  assert.match(outpatient, /OutpatientDetailDraft\.rows\(from: session\)/);
  assert.match(outpatient, /private struct OutpatientDetailDraft: Identifiable/);
  assert.match(outpatient, /let details = \(session\.details \?\? \[\]\)\.map\(detailSummary\)/);
  assert.match(outpatient, /Image\(systemName: "pencil"\)/);
  assert.match(outpatient, /OutpatientEditProbe/);
  assert.match(outpatient, /PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT/);
  assert.match(outpatient, /native-ui-outpatient-edit\.json/);
  assert.match(outpatient, /runOutpatientEditProbeIfRequested/);
  assert.match(outpatient, /await store\.run\("outpatient\.assign"/);
  assert.match(outpatient, /await store\.run\("outpatient\.delete"/);
  assert.match(outpatient, /sessionStillPresent/);
  assert.match(outpatient, /targetRotatorId = "rot-outpatient-edit-1"/);

  assert.match(sharedCommands, /function invalidOutpatientReason\(block, rotator, date\)/);
  assert.match(sharedCommands, /weekday === "Saturday" \|\| weekday === "Sunday"/);
  assert.match(sharedCommands, /item && item\.noClinic && item\.date === date/);
  assert.match(sharedCommands, /!isRotatorActiveOn\(rotator, date\)/);
  assert.match(sharedCommands, /isRotatorUnavailable\(rotator, date\)/);
  assert.match(sharedCommands, /"invalid_outpatient_assignment"/);
  assert.match(backendCommands, /def _invalid_outpatient_reason\(block: dict \| None, rotator: dict, date: str\) -> str \| None:/);
  assert.match(backendCommands, /weekday in \{"Saturday", "Sunday"\}/);
  assert.match(backendCommands, /item\.get\("noClinic"\) and item\.get\("date"\) == date/);
  assert.match(backendCommands, /not is_rotator_active_on\(rotator, date\)/);
  assert.match(backendCommands, /is_rotator_unavailable\(rotator, date\)/);
  assert.match(backendCommands, /"invalid_outpatient_assignment"/);
  assert.match(commandTests, /outpatient\.assign rejects closed or ineligible clinic dates before mutation/);
  assert.match(backendTests, /test_outpatient_assign_rejects_closed_or_ineligible_dates/);
  assert.match(commandInventory, /nested clinic\/attending detail rows/);
  assert.match(commandInventory, /Validates active-block weekday\/non-holiday eligibility/);
  assert.match(verificationMap, /T-SCH-NATIVE-007/);
  assert.match(verificationMap, /T-SCH-CMD-011/);
  assert.match(verificationMap, /nested outpatient session details/);
  assert.match(verificationMap, /invalid_outpatient_assignment/);
});
