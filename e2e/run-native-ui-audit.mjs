#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const APP_BUNDLE_ID = "com.cashbailey.PediatricScheduler";
const APP_PROCESS = "PediatricScheduler";
const DESKTOP_ENGINE_FRAGMENT = "/Desktop/Pediatric Scheduler.app/Contents/Resources/Engine";
const SEEDED_BLOCK_ID = "block-may-2026";
const SEEDED_BLOCK_NAME = "May 2026 Pediatric Neurology";
const REPORTS_BLOCK_ID = "block-final-handoff-2026";
const REPORTS_BLOCK_NAME = "Final Handoff Week";
const DASHBOARD_DRAFT_BLOCK_ID = "block-draft-generation-2026";
const DASHBOARD_DRAFT_BLOCK_NAME = "Draft Generation Week";
const METHODIST_AUTO_BLOCK_ID = "block-methodist-auto-2026";
const METHODIST_AUTO_BLOCK_NAME = "Methodist Auto Week";
const METHODIST_AUTO_ROTATOR_ID = "rot-methodist-auto-1";
const PLANNING_EDIT_BLOCK_ID = "block-planning-edit-2026";
const PLANNING_EDIT_BLOCK_NAME = "Planning Edit Week";
const PLANNING_EDIT_ROTATOR_ID = "rot-edit-1";
const PLANNING_EDIT_DATES = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const SOURCES_IMPORT_BLOCK_ID = "block-source-import-2026";
const SOURCES_IMPORT_BLOCK_NAME = "Source Import Week";
const SOURCES_IMPORT_NAMES = ["Blake Lee", "Casey Morgan"];
const ROTATORS_EDIT_BLOCK_ID = "block-rotators-edit-2026";
const ROTATORS_EDIT_BLOCK_NAME = "Rotators Edit Week";
const ROTATORS_EDIT_TARGET = "Maya Lopez";
const ROTATORS_EDIT_DISPLAY_NAME = "Maya L.";
const OUTPATIENT_EDIT_BLOCK_ID = "block-outpatient-edit-2026";
const OUTPATIENT_EDIT_BLOCK_NAME = "Outpatient Edit Week";
const OUTPATIENT_EDIT_ROTATOR_ID = "rot-outpatient-edit-1";
const OUTPATIENT_EDIT_DATE = "2026-11-03";
const INPATIENT_EDIT_BLOCK_ID = "block-inpatient-edit-2026";
const INPATIENT_EDIT_BLOCK_NAME = "Inpatient Edit Week";
const INPATIENT_EDIT_ROTATOR_ID = "rot-inpatient-edit-1";
const INPATIENT_EDIT_DATE = "2026-12-08";
const INPATIENT_EDIT_ROLE = "Team senior";
const CLINICS_EDIT_BLOCK_ID = "block-clinics-edit-2027";
const CLINICS_EDIT_BLOCK_NAME = "Clinics Edit Week";
const CLINICS_EDIT_ROTATOR_ID = "rot-clinics-edit-1";
const CLINICS_EDIT_DATE = "2027-01-04";
const CLINICS_EDIT_SESSION = "AM";
const CLINICS_EDIT_OCCURRENCE_ID = "clinic-occurrence::alder::clinic-edit-monday-am::2027-01-04::AM";
const FELLOWS_RESOLVE_BLOCK_ID = "block-fellows-resolve-2027";
const FELLOWS_RESOLVE_BLOCK_NAME = "Fellows Resolve Week";
const FELLOWS_RESOLVE_ROTATOR_ID = "rot-fellows-resolve-1";
const FELLOWS_RESOLVE_DATES = ["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05"];
const FELLOWS_RESOLVE_CANDIDATES = ["Coordinator", "Eden"];
const SETTINGS_EDIT_BLOCK_ID = "block-settings-edit-2027";
const SETTINGS_EDIT_BLOCK_NAME = "Settings Edit Week Updated";
const SETTINGS_EDIT_HOLIDAY_DATE = "2027-03-08";
const SETTINGS_EDIT_ATTENDING = "Audit Attending";
const SETTINGS_EDIT_EXPECTED_SOURCE = "Audit Source Program";
const SETTINGS_EDIT_REMOVED_SOURCE = "UT Pediatrics";
const EXPECTED_SEEDED_NAMES = [
  "Maya Lopez",
  "Jules Nguyen",
  "Drew Quinn",
  "Noah Patel",
  "Sam Carter",
  "Dana Reyes",
];
const REQUIRED_SEEDED_SECTIONS = ["fullyIp", "fullyOp", "mixed", "needs"];
const REQUIRED_HANDOFF_PACKAGE_FILES = [
  "manifest.json",
  "roster.csv",
  "inpatient-calendar.csv",
  "conflicts.csv",
  "schedule-package.json",
];
const DEFAULT_APP_SUPPORT_DIR = join(homedir(), "Library/Application Support/PediatricScheduler");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function shell(command, options = {}) {
  return run("bash", ["-lc", command], options);
}

function osascript(script) {
  // 30s: axClick's linear scan reads AXIdentifier per element over Apple
  // Events, so matching a grid cell deep in a ~200-element tree can take
  // >10s even when everything is healthy.
  const result = run("osascript", ["-e", script], { timeout: 30_000 });
  return {
    ok: result.status === 0,
    text: (result.stdout || result.stderr || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function axClick(identifier, fallbackName = "") {
  const processName = appleScriptString(APP_PROCESS);
  const expectedIdentifier = appleScriptString(identifier);
  const expectedName = appleScriptString(fallbackName);
  const identifierResult = appleScriptString(`clicked identifier ${identifier}`);
  const nameResult = appleScriptString(`clicked name ${fallbackName}`);
  const missingMessage = appleScriptString(`AX element not found: ${identifier}`);
  return osascript(`
on axIdentifierOf(candidate)
  try
    tell application "System Events" to return value of attribute "AXIdentifier" of candidate as text
  on error
    return ""
  end try
end axIdentifierOf

on axNameOf(candidate)
  try
    tell application "System Events" to return name of candidate as text
  on error
    return ""
  end try
end axNameOf

on axIsEnabled(candidate)
  try
    tell application "System Events" to return enabled of candidate
  on error
    return true
  end try
end axIsEnabled

on pressCandidate(candidate)
  if my axIsEnabled(candidate) is false then
    error "AX element is disabled"
  end if
  tell application "System Events"
    try
      perform action "AXPress" of candidate
    on error
      click candidate
    end try
  end tell
end pressCandidate

set clickResult to ""
tell application "System Events"
  if not (exists process ${processName}) then
    error "Process ${APP_PROCESS} is not running"
  end if
  tell process ${processName}
    set frontmost to true
    -- The process can expose auxiliary AX windows (e.g. a 1440x29 menu-bar
    -- host strip) that shuffle window indices, so "window 1" is not reliably
    -- the app window. Target the first AXStandardWindow instead.
    set targetWindow to missing value
    repeat with candidateWindow in windows
      try
        if subrole of candidateWindow is "AXStandardWindow" then
          set targetWindow to candidateWindow
          exit repeat
        end if
      end try
    end repeat
    if targetWindow is missing value then set targetWindow to window 1
    set candidates to {}
    try
      set candidates to candidates & (buttons of toolbar 1 of targetWindow)
    end try
    try
      set candidates to candidates & (entire contents of toolbar 1 of targetWindow)
    end try
    try
      set candidates to candidates & (entire contents of targetWindow)
    end try
    repeat with candidate in candidates
      if my axIdentifierOf(candidate) is ${expectedIdentifier} then
        my pressCandidate(candidate)
        set clickResult to ${identifierResult}
        exit repeat
      end if
    end repeat
    if clickResult is "" and ${expectedName} is not "" then
      repeat with candidate in candidates
        if my axNameOf(candidate) is ${expectedName} then
          my pressCandidate(candidate)
          set clickResult to ${nameResult}
          exit repeat
        end if
      end repeat
    end if
  end tell
end tell
if clickResult is not "" then return clickResult
error ${missingMessage}
`);
}

function axShortcutFallback(fallbackName = "") {
  if (fallbackName === "Undo") {
    return osascript(`tell application id "${APP_BUNDLE_ID}" to activate
tell application "System Events" to keystroke "z" using command down
return "sent shortcut Undo"`);
  }
  if (fallbackName === "Redo") {
    return osascript(`tell application id "${APP_BUNDLE_ID}" to activate
tell application "System Events" to keystroke "z" using {command down, shift down}
return "sent shortcut Redo"`);
  }
  return null;
}

async function axClickWhenReady(identifier, fallbackName = "", attempts = 80) {
  let lastResult = null;
  let silentTimeouts = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    osascript(`tell application id "${APP_BUNDLE_ID}" to activate`);
    await sleep(250);
    lastResult = axClick(identifier, fallbackName);
    if (lastResult.ok) {
      return lastResult;
    }
    // A locked console / dead AX session makes osascript time out with no
    // output at all. Retrying the full budget at ~10s per attempt turns one
    // probe into minutes — bail after two consecutive silent timeouts and
    // let isAxEnvironmentIssue classify the failure as a SKIP.
    if (!`${lastResult.text ?? ""}${lastResult.stderr ?? ""}`.trim()) {
      silentTimeouts += 1;
      if (silentTimeouts >= 2) break;
    } else {
      silentTimeouts = 0;
    }
  }
  const fallback = axShortcutFallback(fallbackName);
  if (fallback?.ok) {
    return fallback;
  }
  return lastResult ?? { ok: false, text: "AX click was not attempted.", stderr: "" };
}

function isAxPermissionIssue(clickResult) {
  const text = `${clickResult?.text ?? ""} ${clickResult?.stderr ?? ""}`.toLowerCase();
  return /assistive|accessibility|not authorized|not allowed|not permitted|operation is not permitted/.test(text);
}

function isAxEnvironmentIssue(clickResult) {
  const text = `${clickResult?.text ?? ""} ${clickResult?.stderr ?? ""}`.toLowerCase();
  // A timed-out osascript is killed silently and yields a failure with no
  // output at all. That happens when the console is locked (System Events
  // enumeration hangs until the 10s timeout) — same environment class as a
  // permission error, so AX probes SKIP instead of false-FAILing.
  if (clickResult && clickResult.ok === false && !text.trim()) return true;
  return isAxPermissionIssue(clickResult) || /can.?t get window 1|invalid index|no window|window 1/.test(text);
}

function result(id, status, detail, artifact = "") {
  return { id, status, detail, artifact };
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function readRuntime() {
  const response = await fetch("http://127.0.0.1:6174/api/runtime");
  if (!response.ok) {
    throw new Error(`/api/runtime returned ${response.status}`);
  }
  return response.json();
}

async function readJsonProbe(filePath, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf8"));
    }
    await sleep(250);
  }
  return null;
}

async function readSchedulerState() {
  const response = await fetch("http://127.0.0.1:6174/api/scheduler/state");
  if (!response.ok) {
    throw new Error(`/api/scheduler/state returned ${response.status}`);
  }
  return response.json();
}

async function waitForSchedulerState(predicate, label, attempts = 40) {
  let lastState = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const state = await readSchedulerState();
      lastState = state;
      if (predicate(state)) {
        return { ok: true, state, error: "" };
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  return {
    ok: false,
    state: lastState,
    error: lastError?.message ?? `Timed out waiting for ${label}.`,
  };
}

function planningEditAssignments(state) {
  const expectedDates = new Set(PLANNING_EDIT_DATES);
  return (state?.inpatientAssignments ?? [])
    .filter((assignment) => assignment.rotatorId === PLANNING_EDIT_ROTATOR_ID && expectedDates.has(assignment.date))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function planningEditDatesMatch(assignments) {
  return sameStringSet(
    assignments.map((assignment) => assignment.date),
    PLANNING_EDIT_DATES,
  );
}

async function runGridShow(blockRef = SEEDED_BLOCK_ID) {
  const response = await fetch("http://127.0.0.1:6174/api/scheduler/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "grid.show", input: { blockRef } }),
  });
  if (!response.ok) {
    throw new Error(`/api/scheduler/command grid.show returned ${response.status}`);
  }
  return response.json();
}

function includesAllSeededNames(value) {
  const text = JSON.stringify(value ?? {});
  return EXPECTED_SEEDED_NAMES.every((name) => text.includes(name));
}

function gridSectionCounts(commandResult) {
  const sections = commandResult?.data?.grid?.sections ?? {};
  return Object.fromEntries(
    REQUIRED_SEEDED_SECTIONS.map((sectionId) => [
      sectionId,
      Array.isArray(sections[sectionId]) ? sections[sectionId].length : 0,
    ]),
  );
}

function sectionCountsArePopulated(sectionCounts) {
  return REQUIRED_SEEDED_SECTIONS.every((sectionId) => Number(sectionCounts?.[sectionId] ?? 0) > 0);
}

function summarizeState(state) {
  return {
    activeBlockId: state?.activeBlockId ?? "",
    activeBlockName: (state?.serviceBlocks ?? []).find((block) => block.id === state?.activeBlockId)?.name ?? "",
    rotators: (state?.rotators ?? []).map((rotator) => rotator.displayName || rotator.fullName || rotator.id),
  };
}

function summarizeGridShow(commandResult) {
  const grid = commandResult?.data?.grid ?? {};
  return {
    ok: commandResult?.ok ?? false,
    blockId: commandResult?.data?.blockId ?? "",
    dateCount: Array.isArray(grid.dates) ? grid.dates.length : 0,
    rowCount: Array.isArray(grid.rows) ? grid.rows.length : 0,
    sectionCounts: gridSectionCounts(commandResult),
    sampleRows: (grid.rows ?? []).slice(0, 8).map((row) => row?.rotator?.displayName || row?.rotator?.fullName || row?.rotator?.id),
  };
}

function summarizeReportsProbe(reportsProbe) {
  const fileNames = Array.isArray(reportsProbe?.fileNames) ? reportsProbe.fileNames : [];
  return {
    ok: reportsProbe?.ok === true,
    blockId: reportsProbe?.blockId ?? "",
    status: reportsProbe?.status ?? "",
    finalizedBy: reportsProbe?.finalizedBy ?? "",
    criticalConflictCount: Number(reportsProbe?.criticalConflictCount ?? -1),
    openSlots: Number(reportsProbe?.openSlots ?? -1),
    missingSourcePrograms: Array.isArray(reportsProbe?.missingSourcePrograms)
      ? reportsProbe.missingSourcePrograms
      : [],
    exportDescription: reportsProbe?.exportDescription ?? "",
    exportFolderPath: reportsProbe?.exportFolderPath ?? "",
    fileCount: fileNames.length,
    fileNames,
    exportReviewReady: reportsProbe?.exportReviewReady === true,
    exportReviewAccepted: reportsProbe?.exportReviewAccepted === true,
    exportReviewFileCount: Number(reportsProbe?.exportReviewFileCount ?? -1),
    exportReviewPackageCount: Number(reportsProbe?.exportReviewPackageCount ?? -1),
    exportReviewPDFCount: Number(reportsProbe?.exportReviewPDFCount ?? -1),
    exportReviewWordCount: Number(reportsProbe?.exportReviewWordCount ?? -1),
    exportReviewCSVCount: Number(reportsProbe?.exportReviewCSVCount ?? -1),
  };
}

function summarizeDashboardDraftProbe(dashboardDraftProbe) {
  return {
    ok: dashboardDraftProbe?.ok === true,
    blockId: dashboardDraftProbe?.blockId ?? "",
    blockName: dashboardDraftProbe?.blockName ?? "",
    beforeInpatientCount: Number(dashboardDraftProbe?.beforeInpatientCount ?? -1),
    afterInpatientCount: Number(dashboardDraftProbe?.afterInpatientCount ?? -1),
    autoDraftInpatientCount: Number(dashboardDraftProbe?.autoDraftInpatientCount ?? -1),
    draftReportInpatientAdded: Number(dashboardDraftProbe?.draftReportInpatientAdded ?? -1),
    draftReportErrorCount: Number(dashboardDraftProbe?.draftReportErrorCount ?? -1),
    draftReportUnmetCount: Number(dashboardDraftProbe?.draftReportUnmetCount ?? -1),
  };
}

function summarizeMethodistAutoProbe(methodistAutoProbe) {
  return {
    ok: methodistAutoProbe?.ok === true,
    blockId: methodistAutoProbe?.blockId ?? "",
    blockName: methodistAutoProbe?.blockName ?? "",
    targetRotatorId: methodistAutoProbe?.targetRotatorId ?? "",
    methodistStartSide: methodistAutoProbe?.methodistStartSide ?? "",
    initialInpatientCount: Number(methodistAutoProbe?.initialInpatientCount ?? -1),
    initialOutpatientCount: Number(methodistAutoProbe?.initialOutpatientCount ?? -1),
    afterGenerateInpatientCount: Number(methodistAutoProbe?.afterGenerateInpatientCount ?? -1),
    afterGenerateOutpatientCount: Number(methodistAutoProbe?.afterGenerateOutpatientCount ?? -1),
    afterRerunInpatientCount: Number(methodistAutoProbe?.afterRerunInpatientCount ?? -1),
    afterRerunOutpatientCount: Number(methodistAutoProbe?.afterRerunOutpatientCount ?? -1),
    idempotentMessage: methodistAutoProbe?.idempotentMessage ?? "",
  };
}

function summarizePlanningEditProbe(planningEditProbe) {
  return {
    ok: planningEditProbe?.ok === true,
    blockId: planningEditProbe?.blockId ?? "",
    initialCount: Number(planningEditProbe?.initialCount ?? -1),
    afterEditCount: Number(planningEditProbe?.afterEditCount ?? -1),
    afterUndoCount: Number(planningEditProbe?.afterUndoCount ?? -1),
    afterRedoCount: Number(planningEditProbe?.afterRedoCount ?? -1),
    afterEditSource: planningEditProbe?.afterEditSource ?? "",
    afterUndoContainsTarget: planningEditProbe?.afterUndoContainsTarget,
    afterRedoContainsTarget: planningEditProbe?.afterRedoContainsTarget,
  };
}

function summarizePlanningAxInteraction(planningAxInteraction) {
  return {
    ok: planningAxInteraction?.ok === true,
    status: planningAxInteraction?.status ?? "",
    blockId: planningAxInteraction?.blockId ?? "",
    rotatorId: planningAxInteraction?.rotatorId ?? "",
    initialCount: Number(planningAxInteraction?.initialCount ?? -1),
    afterApplyCount: Number(planningAxInteraction?.afterApplyCount ?? -1),
    afterUndoCount: Number(planningAxInteraction?.afterUndoCount ?? -1),
    afterRedoCount: Number(planningAxInteraction?.afterRedoCount ?? -1),
    afterRedoDates: Array.isArray(planningAxInteraction?.afterRedoDates) ? planningAxInteraction.afterRedoDates : [],
    afterRedoSources: Array.isArray(planningAxInteraction?.afterRedoSources) ? planningAxInteraction.afterRedoSources : [],
    message: planningAxInteraction?.message ?? "",
  };
}

function summarizeSourcesImportProbe(sourcesImportProbe) {
  return {
    ok: sourcesImportProbe?.ok === true,
    blockId: sourcesImportProbe?.blockId ?? "",
    blockName: sourcesImportProbe?.blockName ?? "",
    previewAdded: Number(sourcesImportProbe?.previewAdded ?? -1),
    previewRows: Number(sourcesImportProbe?.previewRows ?? -1),
    previewWarnings: Number(sourcesImportProbe?.previewWarnings ?? -1),
    afterSourceCount: Number(sourcesImportProbe?.afterSourceCount ?? -1),
    afterRotatorCount: Number(sourcesImportProbe?.afterRotatorCount ?? -1),
    importedFileName: sourcesImportProbe?.importedFileName ?? "",
    importedRotatorCount: Number(sourcesImportProbe?.importedRotatorCount ?? -1),
    importedParsedRows: Number(sourcesImportProbe?.importedParsedRows ?? -1),
    importedWarningCount: Number(sourcesImportProbe?.importedWarningCount ?? -1),
    importedRotators: Array.isArray(sourcesImportProbe?.importedRotators)
      ? sourcesImportProbe.importedRotators
      : [],
  };
}

function summarizeRotatorsEditProbe(rotatorsEditProbe) {
  return {
    ok: rotatorsEditProbe?.ok === true,
    blockId: rotatorsEditProbe?.blockId ?? "",
    blockName: rotatorsEditProbe?.blockName ?? "",
    initialRotatorCount: Number(rotatorsEditProbe?.initialRotatorCount ?? -1),
    afterRotatorCount: Number(rotatorsEditProbe?.afterRotatorCount ?? -1),
    fullName: rotatorsEditProbe?.fullName ?? "",
    displayName: rotatorsEditProbe?.displayName ?? "",
    program: rotatorsEditProbe?.program ?? "",
    level: rotatorsEditProbe?.level ?? "",
    schoolType: rotatorsEditProbe?.schoolType ?? "",
    rotationStartDate: rotatorsEditProbe?.rotationStartDate ?? "",
    methodistStartSide: rotatorsEditProbe?.methodistStartSide ?? "",
    dayOff: Array.isArray(rotatorsEditProbe?.dayOff) ? rotatorsEditProbe.dayOff : [],
    segments: Array.isArray(rotatorsEditProbe?.segments) ? rotatorsEditProbe.segments : [],
    unavailableRanges: Array.isArray(rotatorsEditProbe?.unavailableRanges) ? rotatorsEditProbe.unavailableRanges : [],
    bulkDeleteTargetStillPresent: rotatorsEditProbe?.bulkDeleteTargetStillPresent,
    dedupeRemovedCount: Number(rotatorsEditProbe?.dedupeRemovedCount ?? -1),
    duplicateRemovedId: rotatorsEditProbe?.duplicateRemovedId ?? "",
    duplicateStillPresent: rotatorsEditProbe?.duplicateStillPresent,
    duplicateInpatientRepointed: rotatorsEditProbe?.duplicateInpatientRepointed,
    duplicateOutpatientRepointed: rotatorsEditProbe?.duplicateOutpatientRepointed,
    dedupedSegments: Array.isArray(rotatorsEditProbe?.dedupedSegments) ? rotatorsEditProbe.dedupedSegments : [],
  };
}

function summarizeOutpatientEditProbe(outpatientEditProbe) {
  return {
    ok: outpatientEditProbe?.ok === true,
    blockId: outpatientEditProbe?.blockId ?? "",
    blockName: outpatientEditProbe?.blockName ?? "",
    targetDate: outpatientEditProbe?.targetDate ?? "",
    targetPeriod: outpatientEditProbe?.targetPeriod ?? "",
    targetRotatorId: outpatientEditProbe?.targetRotatorId ?? "",
    sessionId: outpatientEditProbe?.sessionId ?? "",
    clinic: outpatientEditProbe?.clinic ?? "",
    provider: outpatientEditProbe?.provider ?? "",
    details: Array.isArray(outpatientEditProbe?.details) ? outpatientEditProbe.details : [],
    initialSessionCount: Number(outpatientEditProbe?.initialSessionCount ?? -1),
    afterAssignCount: Number(outpatientEditProbe?.afterAssignCount ?? -1),
    afterDeleteCount: Number(outpatientEditProbe?.afterDeleteCount ?? -1),
    sessionStillPresent: outpatientEditProbe?.sessionStillPresent,
  };
}

function summarizeInpatientEditProbe(inpatientEditProbe) {
  return {
    ok: inpatientEditProbe?.ok === true,
    blockId: inpatientEditProbe?.blockId ?? "",
    blockName: inpatientEditProbe?.blockName ?? "",
    targetDate: inpatientEditProbe?.targetDate ?? "",
    targetRotatorId: inpatientEditProbe?.targetRotatorId ?? "",
    targetRole: inpatientEditProbe?.targetRole ?? "",
    assignmentId: inpatientEditProbe?.assignmentId ?? "",
    source: inpatientEditProbe?.source ?? "",
    initialAssignmentCount: Number(inpatientEditProbe?.initialAssignmentCount ?? -1),
    afterAssignCount: Number(inpatientEditProbe?.afterAssignCount ?? -1),
    afterDeleteCount: Number(inpatientEditProbe?.afterDeleteCount ?? -1),
    assignmentStillPresent: inpatientEditProbe?.assignmentStillPresent,
  };
}

function summarizeClinicsEditProbe(clinicsEditProbe) {
  return {
    ok: clinicsEditProbe?.ok === true,
    blockId: clinicsEditProbe?.blockId ?? "",
    blockName: clinicsEditProbe?.blockName ?? "",
    targetDate: clinicsEditProbe?.targetDate ?? "",
    targetSession: clinicsEditProbe?.targetSession ?? "",
    targetOccurrenceId: clinicsEditProbe?.targetOccurrenceId ?? "",
    targetRotatorId: clinicsEditProbe?.targetRotatorId ?? "",
    assignmentId: clinicsEditProbe?.assignmentId ?? "",
    source: clinicsEditProbe?.source ?? "",
    initialAssignmentCount: Number(clinicsEditProbe?.initialAssignmentCount ?? -1),
    afterAssignCount: Number(clinicsEditProbe?.afterAssignCount ?? -1),
    afterDeleteCount: Number(clinicsEditProbe?.afterDeleteCount ?? -1),
    assignmentStillPresent: clinicsEditProbe?.assignmentStillPresent,
  };
}

function summarizeFellowsResolveProbe(fellowsResolveProbe) {
  return {
    ok: fellowsResolveProbe?.ok === true,
    blockId: fellowsResolveProbe?.blockId ?? "",
    blockName: fellowsResolveProbe?.blockName ?? "",
    targetRotatorId: fellowsResolveProbe?.targetRotatorId ?? "",
    candidateNames: Array.isArray(fellowsResolveProbe?.candidateNames)
      ? fellowsResolveProbe.candidateNames
      : [],
    dates: Array.isArray(fellowsResolveProbe?.dates) ? fellowsResolveProbe.dates : [],
    assignmentDates: Array.isArray(fellowsResolveProbe?.assignmentDates)
      ? fellowsResolveProbe.assignmentDates
      : [],
    sourceValues: Array.isArray(fellowsResolveProbe?.sourceValues)
      ? fellowsResolveProbe.sourceValues
      : [],
    initialAssignmentCount: Number(fellowsResolveProbe?.initialAssignmentCount ?? -1),
    afterDraftAssignmentCount: Number(fellowsResolveProbe?.afterDraftAssignmentCount ?? -1),
    afterResolveAssignmentCount: Number(fellowsResolveProbe?.afterResolveAssignmentCount ?? -1),
    resolvedAssignmentCount: Number(fellowsResolveProbe?.resolvedAssignmentCount ?? -1),
    draftReportCleared: fellowsResolveProbe?.draftReportCleared,
  };
}

function summarizeSettingsEditProbe(settingsEditProbe) {
  return {
    ok: settingsEditProbe?.ok === true,
    blockId: settingsEditProbe?.blockId ?? "",
    blockName: settingsEditProbe?.blockName ?? "",
    blockStatus: settingsEditProbe?.blockStatus ?? "",
    weekdayCoverage: Number(settingsEditProbe?.weekdayCoverage ?? -1),
    saturdayCoverage: Number(settingsEditProbe?.saturdayCoverage ?? -1),
    sundayCoverage: Number(settingsEditProbe?.sundayCoverage ?? -1),
    holidayCoverage: Number(settingsEditProbe?.holidayCoverage ?? -1),
    holidayDate: settingsEditProbe?.holidayDate ?? "",
    holidayLabel: settingsEditProbe?.holidayLabel ?? "",
    holidayNoClinic: settingsEditProbe?.holidayNoClinic,
    maxConsecutiveInpatientDays: Number(settingsEditProbe?.maxConsecutiveInpatientDays ?? -1),
    honorNoClinicHolidays: settingsEditProbe?.honorNoClinicHolidays,
    posterProgramName: settingsEditProbe?.posterProgramName ?? "",
    posterChief: settingsEditProbe?.posterChief ?? "",
    posterTagline: settingsEditProbe?.posterTagline ?? "",
    posterLocations: Array.isArray(settingsEditProbe?.posterLocations) ? settingsEditProbe.posterLocations : [],
    posterNotes: Array.isArray(settingsEditProbe?.posterNotes) ? settingsEditProbe.posterNotes : [],
    attendingNames: Array.isArray(settingsEditProbe?.attendingNames) ? settingsEditProbe.attendingNames : [],
    auditRecurringClinicId: settingsEditProbe?.auditRecurringClinicId ?? "",
    auditOneOffClinicId: settingsEditProbe?.auditOneOffClinicId ?? "",
    expectedSourcePrograms: Array.isArray(settingsEditProbe?.expectedSourcePrograms)
      ? settingsEditProbe.expectedSourcePrograms
      : [],
    initialAttendingCount: Number(settingsEditProbe?.initialAttendingCount ?? -1),
    finalAttendingCount: Number(settingsEditProbe?.finalAttendingCount ?? -1),
  };
}

function writeArtifacts({
  resultsDir,
  runStamp,
  results,
  runtime,
  buildLogPath,
  reportsBuildLogPath,
  dashboardDraftBuildLogPath,
  methodistAutoBuildLogPath,
  planningEditBuildLogPath,
  planningAxBuildLogPath,
  sourcesImportBuildLogPath,
  rotatorsEditBuildLogPath,
  outpatientEditBuildLogPath,
  inpatientEditBuildLogPath,
  clinicsEditBuildLogPath,
  fellowsResolveBuildLogPath,
  settingsEditBuildLogPath,
  seedLogPath,
  reportsSeedLogPath,
  dashboardDraftSeedLogPath,
  methodistAutoSeedLogPath,
  planningEditSeedLogPath,
  planningAxSeedLogPath,
  sourcesImportSeedLogPath,
  rotatorsEditSeedLogPath,
  outpatientEditSeedLogPath,
  inpatientEditSeedLogPath,
  clinicsEditSeedLogPath,
  fellowsResolveSeedLogPath,
  settingsEditSeedLogPath,
  dataDir,
  reportsDataDir,
  dashboardDraftDataDir,
  methodistAutoDataDir,
  planningEditDataDir,
  planningAxDataDir,
  sourcesImportDataDir,
  rotatorsEditDataDir,
  outpatientEditDataDir,
  inpatientEditDataDir,
  clinicsEditDataDir,
  fellowsResolveDataDir,
  settingsEditDataDir,
  windowProbe,
  screenProbe,
  planningProbe,
  reportsProbe,
  dashboardDraftProbe,
  methodistAutoProbe,
  planningEditProbe,
  planningAxInteraction,
  sourcesImportProbe,
  rotatorsEditProbe,
  outpatientEditProbe,
  inpatientEditProbe,
  clinicsEditProbe,
  fellowsResolveProbe,
  settingsEditProbe,
  schedulerState,
  gridShow,
}) {
  const mdPath = join(resultsDir, `native-ui-audit-${runStamp}.md`);
  const jsonPath = join(resultsDir, `native-ui-audit-${runStamp}.json`);
  const schedulerStateSummary = summarizeState(schedulerState);
  const gridShowSummary = summarizeGridShow(gridShow);
  const reportsProbeSummary = summarizeReportsProbe(reportsProbe);
  const dashboardDraftProbeSummary = summarizeDashboardDraftProbe(dashboardDraftProbe);
  const methodistAutoProbeSummary = summarizeMethodistAutoProbe(methodistAutoProbe);
  const planningEditProbeSummary = summarizePlanningEditProbe(planningEditProbe);
  const planningAxSummary = summarizePlanningAxInteraction(planningAxInteraction);
  const sourcesImportProbeSummary = summarizeSourcesImportProbe(sourcesImportProbe);
  const rotatorsEditProbeSummary = summarizeRotatorsEditProbe(rotatorsEditProbe);
  const outpatientEditProbeSummary = summarizeOutpatientEditProbe(outpatientEditProbe);
  const inpatientEditProbeSummary = summarizeInpatientEditProbe(inpatientEditProbe);
  const clinicsEditProbeSummary = summarizeClinicsEditProbe(clinicsEditProbe);
  const fellowsResolveProbeSummary = summarizeFellowsResolveProbe(fellowsResolveProbe);
  const settingsEditProbeSummary = summarizeSettingsEditProbe(settingsEditProbe);

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        runAt: runStamp,
        runtime,
        results,
        buildLogPath,
        reportsBuildLogPath,
        dashboardDraftBuildLogPath,
        methodistAutoBuildLogPath,
        planningEditBuildLogPath,
        planningAxBuildLogPath,
        sourcesImportBuildLogPath,
        rotatorsEditBuildLogPath,
        outpatientEditBuildLogPath,
        inpatientEditBuildLogPath,
        clinicsEditBuildLogPath,
        fellowsResolveBuildLogPath,
        settingsEditBuildLogPath,
        seedLogPath,
        reportsSeedLogPath,
        dashboardDraftSeedLogPath,
        methodistAutoSeedLogPath,
        planningEditSeedLogPath,
        planningAxSeedLogPath,
        sourcesImportSeedLogPath,
        rotatorsEditSeedLogPath,
        outpatientEditSeedLogPath,
        inpatientEditSeedLogPath,
        clinicsEditSeedLogPath,
        fellowsResolveSeedLogPath,
        settingsEditSeedLogPath,
        dataDir,
        reportsDataDir,
        dashboardDraftDataDir,
        methodistAutoDataDir,
        planningEditDataDir,
        planningAxDataDir,
        sourcesImportDataDir,
        rotatorsEditDataDir,
        outpatientEditDataDir,
        inpatientEditDataDir,
        clinicsEditDataDir,
        fellowsResolveDataDir,
        settingsEditDataDir,
        windowProbe,
        screenProbe,
        planningProbe,
        reportsProbe,
        dashboardDraftProbe,
        methodistAutoProbe,
        planningEditProbe,
        planningAxInteraction,
        sourcesImportProbe,
        rotatorsEditProbe,
        outpatientEditProbe,
        inpatientEditProbe,
        clinicsEditProbe,
        fellowsResolveProbe,
        settingsEditProbe,
        schedulerStateSummary,
        gridShowSummary,
        reportsProbeSummary,
        dashboardDraftProbeSummary,
        methodistAutoProbeSummary,
        planningEditProbeSummary,
        planningAxSummary,
        sourcesImportProbeSummary,
        rotatorsEditProbeSummary,
        outpatientEditProbeSummary,
        inpatientEditProbeSummary,
        clinicsEditProbeSummary,
        fellowsResolveProbeSummary,
        settingsEditProbeSummary,
      },
      null,
      2,
    ),
    "utf8",
  );

  const lines = [
    "# Scheduler Native UI Audit",
    "",
    `- Run at: ${runStamp}`,
    `- Build/verify log: \`${buildLogPath}\``,
    `- Reports build/verify log: \`${reportsBuildLogPath}\``,
    `- Dashboard draft build/verify log: \`${dashboardDraftBuildLogPath}\``,
    `- Methodist auto build/verify log: \`${methodistAutoBuildLogPath}\``,
    `- Planning edit build/verify log: \`${planningEditBuildLogPath}\``,
    `- Planning AX build/verify log: \`${planningAxBuildLogPath}\``,
    `- Sources import build/verify log: \`${sourcesImportBuildLogPath}\``,
    `- Rotators edit build/verify log: \`${rotatorsEditBuildLogPath}\``,
    `- Outpatient edit build/verify log: \`${outpatientEditBuildLogPath}\``,
    `- Inpatient edit build/verify log: \`${inpatientEditBuildLogPath}\``,
    `- Clinics edit build/verify log: \`${clinicsEditBuildLogPath}\``,
    `- Fellows resolve build/verify log: \`${fellowsResolveBuildLogPath}\``,
    `- Settings edit build/verify log: \`${settingsEditBuildLogPath}\``,
    `- Seed log: \`${seedLogPath}\``,
    `- Reports seed log: \`${reportsSeedLogPath}\``,
    `- Dashboard draft seed log: \`${dashboardDraftSeedLogPath}\``,
    `- Methodist auto seed log: \`${methodistAutoSeedLogPath}\``,
    `- Planning edit seed log: \`${planningEditSeedLogPath}\``,
    `- Planning AX seed log: \`${planningAxSeedLogPath}\``,
    `- Sources import seed log: \`${sourcesImportSeedLogPath}\``,
    `- Rotators edit seed log: \`${rotatorsEditSeedLogPath}\``,
    `- Outpatient edit seed log: \`${outpatientEditSeedLogPath}\``,
    `- Inpatient edit seed log: \`${inpatientEditSeedLogPath}\``,
    `- Clinics edit seed log: \`${clinicsEditSeedLogPath}\``,
    `- Fellows resolve seed log: \`${fellowsResolveSeedLogPath}\``,
    `- Settings edit seed log: \`${settingsEditSeedLogPath}\``,
    `- Audit data dir: \`${dataDir}\``,
    `- Reports audit data dir: \`${reportsDataDir}\``,
    `- Dashboard draft audit data dir: \`${dashboardDraftDataDir}\``,
    `- Methodist auto audit data dir: \`${methodistAutoDataDir}\``,
    `- Planning edit audit data dir: \`${planningEditDataDir}\``,
    `- Planning AX audit data dir: \`${planningAxDataDir}\``,
    `- Sources import audit data dir: \`${sourcesImportDataDir}\``,
    `- Rotators edit audit data dir: \`${rotatorsEditDataDir}\``,
    `- Outpatient edit audit data dir: \`${outpatientEditDataDir}\``,
    `- Inpatient edit audit data dir: \`${inpatientEditDataDir}\``,
    `- Clinics edit audit data dir: \`${clinicsEditDataDir}\``,
    `- Fellows resolve audit data dir: \`${fellowsResolveDataDir}\``,
    `- Settings edit audit data dir: \`${settingsEditDataDir}\``,
    `- Runtime engine: \`${runtime?.engineRoot || ""}\``,
    `- Seeded state: \`${schedulerStateSummary.activeBlockId}\` / ${schedulerStateSummary.rotators.join(", ")}`,
    `- grid.show rows: ${gridShowSummary.rowCount}; sections: ${JSON.stringify(gridShowSummary.sectionCounts)}`,
    `- Reports handoff: \`${reportsProbeSummary.blockId}\` ${reportsProbeSummary.status}; files: ${reportsProbeSummary.fileCount}`,
    `- Dashboard draft: \`${dashboardDraftProbeSummary.blockId}\`; Auto-Draft IP: ${dashboardDraftProbeSummary.autoDraftInpatientCount}`,
    `- Methodist auto: \`${methodistAutoProbeSummary.blockId}\`; IP/OP ${methodistAutoProbeSummary.afterGenerateInpatientCount}/${methodistAutoProbeSummary.afterGenerateOutpatientCount}; rerun ${methodistAutoProbeSummary.afterRerunInpatientCount}/${methodistAutoProbeSummary.afterRerunOutpatientCount}`,
    `- Planning edit: \`${planningEditProbeSummary.blockId}\`; counts ${planningEditProbeSummary.initialCount} -> ${planningEditProbeSummary.afterEditCount} -> ${planningEditProbeSummary.afterUndoCount} -> ${planningEditProbeSummary.afterRedoCount}`,
    `- Planning AX edit: \`${planningAxSummary.blockId}\`; counts ${planningAxSummary.initialCount} -> ${planningAxSummary.afterApplyCount} -> ${planningAxSummary.afterUndoCount} -> ${planningAxSummary.afterRedoCount}`,
    `- Sources import: \`${sourcesImportProbeSummary.blockId}\`; added ${sourcesImportProbeSummary.previewAdded} row(s) from ${sourcesImportProbeSummary.importedFileName || "missing"}`,
    `- Rotators edit: \`${rotatorsEditProbeSummary.blockId}\`; ${rotatorsEditProbeSummary.fullName || "missing"} -> ${rotatorsEditProbeSummary.displayName || "missing"} with ${rotatorsEditProbeSummary.afterRotatorCount} rotator(s) remaining`,
    `- Outpatient edit: \`${outpatientEditProbeSummary.blockId}\`; ${outpatientEditProbeSummary.targetPeriod || "missing"} ${outpatientEditProbeSummary.targetDate || "missing"} count ${outpatientEditProbeSummary.initialSessionCount} -> ${outpatientEditProbeSummary.afterAssignCount} -> ${outpatientEditProbeSummary.afterDeleteCount}`,
    `- Inpatient edit: \`${inpatientEditProbeSummary.blockId}\`; ${inpatientEditProbeSummary.targetRole || "missing"} ${inpatientEditProbeSummary.targetDate || "missing"} count ${inpatientEditProbeSummary.initialAssignmentCount} -> ${inpatientEditProbeSummary.afterAssignCount} -> ${inpatientEditProbeSummary.afterDeleteCount}`,
    `- Clinics edit: \`${clinicsEditProbeSummary.blockId}\`; ${clinicsEditProbeSummary.targetSession || "missing"} ${clinicsEditProbeSummary.targetDate || "missing"} count ${clinicsEditProbeSummary.initialAssignmentCount} -> ${clinicsEditProbeSummary.afterAssignCount} -> ${clinicsEditProbeSummary.afterDeleteCount}`,
    `- Fellows resolve: \`${fellowsResolveProbeSummary.blockId}\`; candidates ${fellowsResolveProbeSummary.candidateNames.join(" / ") || "missing"} resolved ${fellowsResolveProbeSummary.resolvedAssignmentCount} day(s) for ${fellowsResolveProbeSummary.targetRotatorId || "missing"}`,
    `- Settings edit: \`${settingsEditProbeSummary.blockId}\`; coverage ${settingsEditProbeSummary.weekdayCoverage}/${settingsEditProbeSummary.saturdayCoverage}/${settingsEditProbeSummary.sundayCoverage}/${settingsEditProbeSummary.holidayCoverage}; attending ${settingsEditProbeSummary.attendingNames.join(" / ") || "missing"}`,
    "",
    "| ID | Status | Detail | Artifact |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of results) {
    lines.push(
      `| ${item.id} | ${item.status} | ${item.detail.replaceAll("|", "\\|")} | ${item.artifact ? `\`${item.artifact}\`` : "-"} |`,
    );
  }
  writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return { mdPath, jsonPath };
}

async function main() {
  const resultsDir = resolve(ROOT, argValue("--results-dir", "verification/results"));
  mkdirSync(resultsDir, { recursive: true });
  const runStamp = stamp();
  const buildLogPath = join(resultsDir, `native-ui-audit-build-${runStamp}.log`);
  const reportsBuildLogPath = join(resultsDir, `native-ui-audit-reports-build-${runStamp}.log`);
  const dashboardDraftBuildLogPath = join(resultsDir, `native-ui-audit-dashboard-draft-build-${runStamp}.log`);
  const methodistAutoBuildLogPath = join(resultsDir, `native-ui-audit-methodist-auto-build-${runStamp}.log`);
  const planningEditBuildLogPath = join(resultsDir, `native-ui-audit-planning-edit-build-${runStamp}.log`);
  const planningAxBuildLogPath = join(resultsDir, `native-ui-audit-planning-ax-build-${runStamp}.log`);
  const sourcesImportBuildLogPath = join(resultsDir, `native-ui-audit-sources-import-build-${runStamp}.log`);
  const rotatorsEditBuildLogPath = join(resultsDir, `native-ui-audit-rotators-edit-build-${runStamp}.log`);
  const outpatientEditBuildLogPath = join(resultsDir, `native-ui-audit-outpatient-edit-build-${runStamp}.log`);
  const inpatientEditBuildLogPath = join(resultsDir, `native-ui-audit-inpatient-edit-build-${runStamp}.log`);
  const clinicsEditBuildLogPath = join(resultsDir, `native-ui-audit-clinics-edit-build-${runStamp}.log`);
  const fellowsResolveBuildLogPath = join(resultsDir, `native-ui-audit-fellows-resolve-build-${runStamp}.log`);
  const settingsEditBuildLogPath = join(resultsDir, `native-ui-audit-settings-edit-build-${runStamp}.log`);
  const seedLogPath = join(resultsDir, `native-ui-audit-seed-${runStamp}.log`);
  const reportsSeedLogPath = join(resultsDir, `native-ui-audit-reports-seed-${runStamp}.log`);
  const dashboardDraftSeedLogPath = join(resultsDir, `native-ui-audit-dashboard-draft-seed-${runStamp}.log`);
  const methodistAutoSeedLogPath = join(resultsDir, `native-ui-audit-methodist-auto-seed-${runStamp}.log`);
  const planningEditSeedLogPath = join(resultsDir, `native-ui-audit-planning-edit-seed-${runStamp}.log`);
  const planningAxSeedLogPath = join(resultsDir, `native-ui-audit-planning-ax-seed-${runStamp}.log`);
  const sourcesImportSeedLogPath = join(resultsDir, `native-ui-audit-sources-import-seed-${runStamp}.log`);
  const rotatorsEditSeedLogPath = join(resultsDir, `native-ui-audit-rotators-edit-seed-${runStamp}.log`);
  const outpatientEditSeedLogPath = join(resultsDir, `native-ui-audit-outpatient-edit-seed-${runStamp}.log`);
  const inpatientEditSeedLogPath = join(resultsDir, `native-ui-audit-inpatient-edit-seed-${runStamp}.log`);
  const clinicsEditSeedLogPath = join(resultsDir, `native-ui-audit-clinics-edit-seed-${runStamp}.log`);
  const fellowsResolveSeedLogPath = join(resultsDir, `native-ui-audit-fellows-resolve-seed-${runStamp}.log`);
  const settingsEditSeedLogPath = join(resultsDir, `native-ui-audit-settings-edit-seed-${runStamp}.log`);
  const screenshotPath = join(resultsDir, `native-ui-audit-${runStamp}.png`);
  const dataDir = join(resultsDir, `native-ui-audit-data-${runStamp}`);
  const reportsDataDir = join(dataDir, "reports-final-handoff");
  const dashboardDraftDataDir = join(dataDir, "dashboard-draft-generation");
  const methodistAutoDataDir = join(dataDir, "methodist-auto");
  const planningEditDataDir = join(dataDir, "planning-edit-undo");
  const planningAxDataDir = join(dataDir, "planning-grid-ax");
  const sourcesImportDataDir = join(dataDir, "sources-roster-import");
  const rotatorsEditDataDir = join(dataDir, "rotators-edit");
  const outpatientEditDataDir = join(dataDir, "outpatient-edit");
  const inpatientEditDataDir = join(dataDir, "inpatient-edit");
  const clinicsEditDataDir = join(dataDir, "clinics-edit");
  const fellowsResolveDataDir = join(dataDir, "fellows-resolve");
  const settingsEditDataDir = join(dataDir, "settings-edit");
  const windowProbePath = join(dataDir, "native-ui-window.json");
  const screenProbePath = join(dataDir, "native-ui-screen.json");
  const planningProbePath = join(dataDir, "native-ui-planning-grid.json");
  const reportsProbePath = join(reportsDataDir, "native-ui-reports-handoff.json");
  const dashboardDraftProbePath = join(dashboardDraftDataDir, "native-ui-dashboard-draft.json");
  const methodistAutoProbePath = join(methodistAutoDataDir, "native-ui-methodist-auto.json");
  const planningEditProbePath = join(planningEditDataDir, "native-ui-planning-edit.json");
  const planningAxScreenProbePath = join(planningAxDataDir, "native-ui-screen.json");
  const planningAxProbePath = join(planningAxDataDir, "native-ui-planning-grid.json");
  const sourcesImportProbePath = join(sourcesImportDataDir, "native-ui-sources-import.json");
  const rotatorsEditProbePath = join(rotatorsEditDataDir, "native-ui-rotators-edit.json");
  const outpatientEditProbePath = join(outpatientEditDataDir, "native-ui-outpatient-edit.json");
  const inpatientEditProbePath = join(inpatientEditDataDir, "native-ui-inpatient-edit.json");
  const clinicsEditProbePath = join(clinicsEditDataDir, "native-ui-clinics-edit.json");
  const fellowsResolveProbePath = join(fellowsResolveDataDir, "native-ui-fellows-resolve.json");
  const settingsEditProbePath = join(settingsEditDataDir, "native-ui-settings-edit.json");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-window.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-screen.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-planning-grid.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-reports-handoff.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-dashboard-draft.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-methodist-auto.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-planning-edit.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-sources-import.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-rotators-edit.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-outpatient-edit.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-inpatient-edit.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-clinics-edit.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-fellows-resolve.json"), { force: true });
  rmSync(join(DEFAULT_APP_SUPPORT_DIR, "native-ui-settings-edit.json"), { force: true });

  const seed = run("node", ["e2e/seed-demo-state.mjs", "--data-dir", dataDir], { timeout: 20_000 });
  writeFileSync(seedLogPath, `${seed.stdout || ""}${seed.stderr || ""}`, "utf8");
  if (seed.status !== 0) {
    throw new Error(`native audit demo seed failed; see ${seedLogPath}`);
  }

  const verify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Planning Grid",
      SCHEDULER_DATA_DIR: dataDir,
    },
  });
  writeFileSync(buildLogPath, `${verify.stdout || ""}${verify.stderr || ""}`, "utf8");
  if (verify.status !== 0) {
    throw new Error(`native verify failed; see ${buildLogPath}`);
  }

  osascript(`tell application id "${APP_BUNDLE_ID}" to activate`);
  await sleep(1_000);

  const processProbe = shell(`pgrep -x ${APP_PROCESS}`);
  const frontmost = osascript('tell application "System Events" to get name of first application process whose frontmost is true');
  const windowCount = osascript(`tell application "System Events" to tell process "${APP_PROCESS}" to count windows`);
  const windowNames = osascript(`tell application "System Events" to tell process "${APP_PROCESS}" to get name of windows`);
  const windowProbe = await readJsonProbe(windowProbePath);
  const screenProbe = await readJsonProbe(screenProbePath, 40);
  const planningProbe = await readJsonProbe(planningProbePath, 60);
  const runtime = await readRuntime();
  const schedulerState = await readSchedulerState();
  const gridShow = await runGridShow(SEEDED_BLOCK_ID);

  const results = [];
  const pid = (processProbe.stdout || "").trim().split(/\s+/).filter(Boolean)[0] || "";
  const nativeWindowIsVisible = windowProbe?.windowAttached === true && windowProbe?.isVisible === true;
  results.push(
    result(
      "T-SCH-NATIVE-UI-001",
      processProbe.status === 0 && (frontmost.text === APP_PROCESS || windowProbe?.appActive === true || nativeWindowIsVisible)
        ? "PASS"
        : "FAIL",
      `Desktop app process is running${pid ? ` as pid ${pid}` : ""}; System Events frontmost is "${frontmost.text || "unknown"}"; native window active=${windowProbe?.appActive ?? "unknown"}.`,
    ),
  );

  const count = Number.parseInt(windowCount.text, 10);
  const axWindowIsVisible = Number.isFinite(count) && count > 0 && /Pediatric Scheduler/.test(windowNames.text);
  results.push(
    result(
      "T-SCH-NATIVE-UI-002",
      axWindowIsVisible || nativeWindowIsVisible ? "PASS" : "FAIL",
      `System Events sees ${Number.isFinite(count) ? count : "unknown"} app window(s): ${windowNames.text || windowCount.stderr || "no names"}; native probe window=${windowProbe?.windowTitle || "missing"} visible=${windowProbe?.isVisible ?? "unknown"} restorable=${windowProbe?.isRestorable ?? "unknown"}.`,
      windowProbe ? windowProbePath : "",
    ),
  );

  const runtimeMatchesDesktop =
    runtime?.ok === true &&
    typeof runtime.engineRoot === "string" &&
    runtime.engineRoot.endsWith(DESKTOP_ENGINE_FRAGMENT) &&
    runtime.cwd === runtime.engineRoot &&
    typeof runtime.python === "string" &&
    runtime.python.startsWith(runtime.engineRoot);
  results.push(
    result(
      "T-SCH-NATIVE-UI-003",
      runtimeMatchesDesktop ? "PASS" : "FAIL",
      "Backend runtime reports the Desktop app's bundled Engine as cwd, engineRoot, and Python home.",
    ),
  );

  const screenshot = run("screencapture", ["-x", screenshotPath], { timeout: 10_000 });
  if (screenshot.status === 0 && existsSync(screenshotPath) && statSync(screenshotPath).size > 0) {
    results.push(result("T-SCH-NATIVE-UI-004", "PASS", "macOS screenshot captured for visual review.", screenshotPath));
  } else {
    results.push(
      result(
        "T-SCH-NATIVE-UI-004",
        "SKIP",
        `macOS screenshot was unavailable in this session: ${(screenshot.stderr || screenshot.stdout || "screencapture produced no image").trim()}.`,
      ),
    );
  }

  const screenMatchesPlanningGrid =
    screenProbe?.screen === "Planning Grid" &&
    screenProbe?.phase === "ready" &&
    screenProbe?.activeBlockId === SEEDED_BLOCK_ID;
  results.push(
    result(
      "T-SCH-NATIVE-UI-005",
      screenMatchesPlanningGrid ? "PASS" : "FAIL",
      `Native screen probe reports screen="${screenProbe?.screen || "missing"}", phase="${screenProbe?.phase || "missing"}", activeBlockId="${screenProbe?.activeBlockId || "missing"}".`,
      screenProbe ? screenProbePath : "",
    ),
  );

  const planningSectionCounts = planningProbe?.sectionCounts ?? {};
  const planningProbeMatches =
    planningProbe?.screen === "Planning Grid" &&
    planningProbe?.blockId === SEEDED_BLOCK_ID &&
    planningProbe?.displayMode === "master" &&
    Number(planningProbe?.dateCount ?? 0) >= 28 &&
    Number(planningProbe?.rowCount ?? 0) >= EXPECTED_SEEDED_NAMES.length &&
    sectionCountsArePopulated(planningSectionCounts) &&
    includesAllSeededNames(planningProbe);
  results.push(
    result(
      "T-SCH-NATIVE-UI-006",
      planningProbeMatches ? "PASS" : "FAIL",
      `Planning Grid probe reports rows=${planningProbe?.rowCount ?? "missing"}, dates=${planningProbe?.dateCount ?? "missing"}, sectionCounts=${JSON.stringify(planningSectionCounts)}.`,
      planningProbe ? planningProbePath : "",
    ),
  );

  const schedulerStateSummary = summarizeState(schedulerState);
  const gridShowSummary = summarizeGridShow(gridShow);
  const apiMatchesSeed =
    schedulerStateSummary.activeBlockId === SEEDED_BLOCK_ID &&
    schedulerStateSummary.activeBlockName === SEEDED_BLOCK_NAME &&
    includesAllSeededNames(schedulerState) &&
    gridShowSummary.ok === true &&
    gridShowSummary.blockId === SEEDED_BLOCK_ID &&
    gridShowSummary.dateCount >= 28 &&
    gridShowSummary.rowCount >= EXPECTED_SEEDED_NAMES.length &&
    sectionCountsArePopulated(gridShowSummary.sectionCounts) &&
    includesAllSeededNames(gridShow);
  results.push(
    result(
      "T-SCH-NATIVE-UI-007",
      apiMatchesSeed ? "PASS" : "FAIL",
      `/api/scheduler/state and /api/scheduler/command grid.show returned seeded block "${schedulerStateSummary.activeBlockId}" with rows=${gridShowSummary.rowCount} and sections=${JSON.stringify(gridShowSummary.sectionCounts)}.`,
    ),
  );

  rmSync(reportsDataDir, { recursive: true, force: true });
  mkdirSync(reportsDataDir, { recursive: true });
  const reportsSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", reportsDataDir, "--profile", "reports-final-handoff"],
    { timeout: 20_000 },
  );
  writeFileSync(reportsSeedLogPath, `${reportsSeed.stdout || ""}${reportsSeed.stderr || ""}`, "utf8");
  if (reportsSeed.status !== 0) {
    throw new Error(`native audit reports seed failed; see ${reportsSeedLogPath}`);
  }

  const reportsVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Reports",
      SCHEDULER_DATA_DIR: reportsDataDir,
      SCHEDULER_REPORTS_HANDOFF_AUDIT: "1",
    },
  });
  writeFileSync(reportsBuildLogPath, `${reportsVerify.stdout || ""}${reportsVerify.stderr || ""}`, "utf8");
  if (reportsVerify.status !== 0) {
    throw new Error(`native reports verify failed; see ${reportsBuildLogPath}`);
  }

  const reportsProbe = await readJsonProbe(reportsProbePath, 120);
  const reportsSummary = summarizeReportsProbe(reportsProbe);
  const reportsProbeMatches =
    reportsSummary.ok === true &&
    reportsSummary.blockId === REPORTS_BLOCK_ID &&
    reportsSummary.status === "Final" &&
    reportsSummary.finalizedBy === "Native Reports Review & Finalize" &&
    reportsSummary.criticalConflictCount === 0 &&
    reportsSummary.openSlots === 0 &&
    reportsSummary.missingSourcePrograms.length === 0 &&
    reportsSummary.exportDescription === "Handoff packet" &&
    reportsSummary.exportReviewReady === true &&
    reportsSummary.exportReviewAccepted === true &&
    reportsSummary.exportReviewFileCount === reportsSummary.fileCount &&
    reportsSummary.exportReviewPackageCount >= REQUIRED_HANDOFF_PACKAGE_FILES.length &&
    reportsSummary.exportReviewPDFCount > 0 &&
    reportsSummary.exportReviewWordCount > 0 &&
    reportsSummary.exportReviewCSVCount > 0 &&
    REQUIRED_HANDOFF_PACKAGE_FILES.every((name) => reportsSummary.fileNames.includes(name)) &&
    reportsSummary.fileNames.some((name) => name.startsWith("PDFs/") && name.endsWith(".pdf")) &&
    reportsSummary.fileNames.some((name) => name.startsWith("Word/") && name.endsWith(".docx"));
  results.push(
    result(
      "T-SCH-NATIVE-UI-008",
      reportsProbeMatches ? "PASS" : "FAIL",
      `Reports handoff probe block="${reportsSummary.blockId || "missing"}" status="${reportsSummary.status || "missing"}" files=${reportsSummary.fileCount} reviewAccepted=${reportsSummary.exportReviewAccepted} folder="${reportsSummary.exportFolderPath || "missing"}".`,
      reportsProbe ? reportsProbePath : "",
    ),
  );

  const reportsState = await readSchedulerState();
  const reportsBlock = (reportsState?.serviceBlocks ?? []).find((block) => block.id === REPORTS_BLOCK_ID);
  const reportsStateMatches =
    reportsState?.activeBlockId === REPORTS_BLOCK_ID &&
    reportsBlock?.name === REPORTS_BLOCK_NAME &&
    reportsBlock?.status === "Final" &&
    reportsBlock?.finalizedBy === "Native Reports Review & Finalize" &&
    reportsBlock?.finalReview?.criticalConflictCount === 0 &&
    reportsBlock?.finalReview?.openSlots === 0 &&
    Array.isArray(reportsBlock?.finalReview?.missingSourcePrograms) &&
    reportsBlock.finalReview.missingSourcePrograms.length === 0;
  results.push(
    result(
      "T-SCH-NATIVE-UI-009",
      reportsStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Reports finalized "${reportsBlock?.name || "missing"}" with finalReview=${JSON.stringify(reportsBlock?.finalReview ?? {})}.`,
    ),
  );

  rmSync(dashboardDraftDataDir, { recursive: true, force: true });
  mkdirSync(dashboardDraftDataDir, { recursive: true });
  const dashboardDraftSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", dashboardDraftDataDir, "--profile", "dashboard-draft-generation"],
    { timeout: 20_000 },
  );
  writeFileSync(dashboardDraftSeedLogPath, `${dashboardDraftSeed.stdout || ""}${dashboardDraftSeed.stderr || ""}`, "utf8");
  if (dashboardDraftSeed.status !== 0) {
    throw new Error(`native audit dashboard draft seed failed; see ${dashboardDraftSeedLogPath}`);
  }

  const dashboardDraftVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Dashboard",
      SCHEDULER_DATA_DIR: dashboardDraftDataDir,
      SCHEDULER_DASHBOARD_DRAFT_AUDIT: "1",
    },
  });
  writeFileSync(dashboardDraftBuildLogPath, `${dashboardDraftVerify.stdout || ""}${dashboardDraftVerify.stderr || ""}`, "utf8");
  if (dashboardDraftVerify.status !== 0) {
    throw new Error(`native dashboard draft verify failed; see ${dashboardDraftBuildLogPath}`);
  }

  const dashboardDraftProbe = await readJsonProbe(dashboardDraftProbePath, 120);
  const dashboardDraftSummary = summarizeDashboardDraftProbe(dashboardDraftProbe);
  const dashboardDraftProbeMatches =
    dashboardDraftSummary.ok === true &&
    dashboardDraftSummary.blockId === DASHBOARD_DRAFT_BLOCK_ID &&
    dashboardDraftSummary.blockName === DASHBOARD_DRAFT_BLOCK_NAME &&
    dashboardDraftSummary.beforeInpatientCount === 0 &&
    dashboardDraftSummary.afterInpatientCount === 5 &&
    dashboardDraftSummary.autoDraftInpatientCount === 5 &&
    dashboardDraftSummary.draftReportInpatientAdded === 5 &&
    dashboardDraftSummary.draftReportErrorCount === 0 &&
    dashboardDraftSummary.draftReportUnmetCount === 0;
  results.push(
    result(
      "T-SCH-NATIVE-UI-010",
      dashboardDraftProbeMatches ? "PASS" : "FAIL",
      `Dashboard draft probe block="${dashboardDraftSummary.blockId || "missing"}" before=${dashboardDraftSummary.beforeInpatientCount} after=${dashboardDraftSummary.afterInpatientCount} autoDraft=${dashboardDraftSummary.autoDraftInpatientCount}.`,
      dashboardDraftProbe ? dashboardDraftProbePath : "",
    ),
  );

  const dashboardDraftState = await readSchedulerState();
  const dashboardDraftAssignments = (dashboardDraftState?.inpatientAssignments ?? []).filter(
    (assignment) => assignment.source === "Auto-Draft",
  );
  const dashboardDraftStateMatches =
    dashboardDraftState?.activeBlockId === DASHBOARD_DRAFT_BLOCK_ID &&
    dashboardDraftAssignments.length === 5 &&
    dashboardDraftAssignments.every((assignment) => assignment.rotatorId === "rot-draft-1");
  results.push(
    result(
      "T-SCH-NATIVE-UI-011",
      dashboardDraftStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Dashboard draft persisted ${dashboardDraftAssignments.length} Auto-Draft inpatient assignment(s).`,
    ),
  );

  rmSync(methodistAutoDataDir, { recursive: true, force: true });
  mkdirSync(methodistAutoDataDir, { recursive: true });
  const methodistAutoSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", methodistAutoDataDir, "--profile", "methodist-auto"],
    { timeout: 20_000 },
  );
  writeFileSync(methodistAutoSeedLogPath, `${methodistAutoSeed.stdout || ""}${methodistAutoSeed.stderr || ""}`, "utf8");
  if (methodistAutoSeed.status !== 0) {
    throw new Error(`native audit Methodist auto seed failed; see ${methodistAutoSeedLogPath}`);
  }

  const methodistAutoVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Inpatient",
      SCHEDULER_DATA_DIR: methodistAutoDataDir,
      SCHEDULER_METHODIST_AUTO_AUDIT: "1",
    },
  });
  writeFileSync(methodistAutoBuildLogPath, `${methodistAutoVerify.stdout || ""}${methodistAutoVerify.stderr || ""}`, "utf8");
  if (methodistAutoVerify.status !== 0) {
    throw new Error(`native Methodist auto verify failed; see ${methodistAutoBuildLogPath}`);
  }

  const methodistAutoProbe = await readJsonProbe(methodistAutoProbePath, 120);
  const methodistAutoSummary = summarizeMethodistAutoProbe(methodistAutoProbe);
  const methodistAutoProbeMatches =
    methodistAutoSummary.ok === true &&
    methodistAutoSummary.blockId === METHODIST_AUTO_BLOCK_ID &&
    methodistAutoSummary.blockName === METHODIST_AUTO_BLOCK_NAME &&
    methodistAutoSummary.targetRotatorId === METHODIST_AUTO_ROTATOR_ID &&
    methodistAutoSummary.methodistStartSide === "outpatient" &&
    methodistAutoSummary.initialInpatientCount === 0 &&
    methodistAutoSummary.initialOutpatientCount === 0 &&
    methodistAutoSummary.afterGenerateInpatientCount === 14 &&
    methodistAutoSummary.afterGenerateOutpatientCount === 18 &&
    methodistAutoSummary.afterRerunInpatientCount === 14 &&
    methodistAutoSummary.afterRerunOutpatientCount === 18 &&
    /already up to date/i.test(methodistAutoSummary.idempotentMessage);
  results.push(
    result(
      "T-SCH-NATIVE-UI-028",
      methodistAutoProbeMatches ? "PASS" : "FAIL",
      `Methodist auto probe block="${methodistAutoSummary.blockId || "missing"}" IP/OP=${methodistAutoSummary.afterGenerateInpatientCount}/${methodistAutoSummary.afterGenerateOutpatientCount} rerun=${methodistAutoSummary.afterRerunInpatientCount}/${methodistAutoSummary.afterRerunOutpatientCount} startSide="${methodistAutoSummary.methodistStartSide || "missing"}".`,
      methodistAutoProbe ? methodistAutoProbePath : "",
    ),
  );

  const methodistAutoState = await readSchedulerState();
  const methodistAutoBlock = (methodistAutoState?.serviceBlocks ?? []).find((block) => block.id === METHODIST_AUTO_BLOCK_ID);
  const methodistAutoRotator = (methodistAutoState?.rotators ?? []).find((rotator) => rotator.id === METHODIST_AUTO_ROTATOR_ID);
  const methodistAutoIp = (methodistAutoState?.inpatientAssignments ?? []).filter(
    (assignment) => assignment.rotatorId === METHODIST_AUTO_ROTATOR_ID && assignment.source === "Auto-Methodist",
  );
  const methodistAutoOp = (methodistAutoState?.outpatientSessions ?? []).filter(
    (session) => session.rotatorId === METHODIST_AUTO_ROTATOR_ID && session.source === "Auto-Methodist",
  );
  const methodistAutoStateMatches =
    methodistAutoState?.activeBlockId === METHODIST_AUTO_BLOCK_ID &&
    methodistAutoBlock?.name === METHODIST_AUTO_BLOCK_NAME &&
    methodistAutoRotator?.methodistStartSide === "outpatient" &&
    methodistAutoIp.length === 14 &&
    methodistAutoOp.length === 18 &&
    methodistAutoIp.some((assignment) => assignment.date === "2026-07-15") &&
    methodistAutoOp.some((session) => session.date === "2026-07-01" && session.period === "AM");
  results.push(
    result(
      "T-SCH-NATIVE-UI-029",
      methodistAutoStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Methodist 14/14 persisted ${methodistAutoIp.length} Auto-Methodist inpatient row(s) and ${methodistAutoOp.length} outpatient session(s).`,
    ),
  );

  rmSync(planningEditDataDir, { recursive: true, force: true });
  mkdirSync(planningEditDataDir, { recursive: true });
  const planningEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", planningEditDataDir, "--profile", "planning-edit-undo"],
    { timeout: 20_000 },
  );
  writeFileSync(planningEditSeedLogPath, `${planningEditSeed.stdout || ""}${planningEditSeed.stderr || ""}`, "utf8");
  if (planningEditSeed.status !== 0) {
    throw new Error(`native audit planning edit seed failed; see ${planningEditSeedLogPath}`);
  }

  const planningEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Planning Grid",
      SCHEDULER_DATA_DIR: planningEditDataDir,
      SCHEDULER_PLANNING_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(planningEditBuildLogPath, `${planningEditVerify.stdout || ""}${planningEditVerify.stderr || ""}`, "utf8");
  if (planningEditVerify.status !== 0) {
    throw new Error(`native planning edit verify failed; see ${planningEditBuildLogPath}`);
  }

  const planningEditProbe = await readJsonProbe(planningEditProbePath, 120);
  const planningEditSummary = summarizePlanningEditProbe(planningEditProbe);
  const planningEditProbeMatches =
    planningEditSummary.ok === true &&
    planningEditSummary.blockId === PLANNING_EDIT_BLOCK_ID &&
    planningEditSummary.initialCount === 0 &&
    planningEditSummary.afterEditCount === 1 &&
    planningEditSummary.afterUndoCount === 0 &&
    planningEditSummary.afterRedoCount === 1 &&
    String(planningEditSummary.afterEditSource).toLowerCase().includes("range") &&
    planningEditSummary.afterUndoContainsTarget === false &&
    planningEditSummary.afterRedoContainsTarget === true;
  results.push(
    result(
      "T-SCH-NATIVE-UI-012",
      planningEditProbeMatches ? "PASS" : "FAIL",
      `Planning Grid edit probe block="${planningEditSummary.blockId || "missing"}" counts=${planningEditSummary.initialCount}->${planningEditSummary.afterEditCount}->${planningEditSummary.afterUndoCount}->${planningEditSummary.afterRedoCount} source="${planningEditSummary.afterEditSource || "missing"}".`,
      planningEditProbe ? planningEditProbePath : "",
    ),
  );

  const planningEditState = await readSchedulerState();
  const planningEditDateAssignments = (planningEditState?.inpatientAssignments ?? []).filter(
    (assignment) => assignment.rotatorId === "rot-edit-1" && assignment.date === "2026-08-03",
  );
  const planningEditStateMatches =
    planningEditState?.activeBlockId === PLANNING_EDIT_BLOCK_ID &&
    (planningEditState?.serviceBlocks ?? []).some((block) => block.id === PLANNING_EDIT_BLOCK_ID && block.name === PLANNING_EDIT_BLOCK_NAME) &&
    planningEditDateAssignments.length === 1 &&
    String(planningEditDateAssignments[0]?.source ?? "").toLowerCase().includes("range");
  results.push(
    result(
      "T-SCH-NATIVE-UI-013",
      planningEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Planning Grid redo persisted ${planningEditDateAssignments.length} range assignment(s) for rot-edit-1 on 2026-08-03.`,
    ),
  );

  rmSync(planningAxDataDir, { recursive: true, force: true });
  mkdirSync(planningAxDataDir, { recursive: true });
  const planningAxInteraction = {
    ok: false,
    status: "not-run",
    blockId: PLANNING_EDIT_BLOCK_ID,
    rotatorId: PLANNING_EDIT_ROTATOR_ID,
    expectedDates: PLANNING_EDIT_DATES,
    initialCount: -1,
    afterApplyCount: -1,
    afterUndoCount: -1,
    afterRedoCount: -1,
    afterRedoDates: [],
    afterRedoSources: [],
    clickResults: {},
    message: "",
  };
  const planningAxSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", planningAxDataDir, "--profile", "planning-edit-undo"],
    { timeout: 20_000 },
  );
  writeFileSync(planningAxSeedLogPath, `${planningAxSeed.stdout || ""}${planningAxSeed.stderr || ""}`, "utf8");
  if (planningAxSeed.status !== 0) {
    throw new Error(`native audit Planning Grid AX seed failed; see ${planningAxSeedLogPath}`);
  }

  // Paint defaults ON and persists via UserDefaults; pin it before launch so
  // the paint probe below starts from a known state regardless of prior runs.
  shell(`defaults write ${APP_BUNDLE_ID} planningGridPaintOn -bool true`, { timeout: 10_000 });
  const planningAxVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Planning Grid",
      SCHEDULER_DATA_DIR: planningAxDataDir,
    },
  });
  writeFileSync(planningAxBuildLogPath, `${planningAxVerify.stdout || ""}${planningAxVerify.stderr || ""}`, "utf8");
  if (planningAxVerify.status !== 0) {
    throw new Error(`native Planning Grid AX verify failed; see ${planningAxBuildLogPath}`);
  }

  osascript(`tell application id "${APP_BUNDLE_ID}" to activate`);
  await sleep(1_000);
  const planningAxScreenProbe = await readJsonProbe(planningAxScreenProbePath, 40);
  const planningAxProbe = await readJsonProbe(planningAxProbePath, 80);
  const planningAxInitial = await waitForSchedulerState(
    (state) => state?.activeBlockId === PLANNING_EDIT_BLOCK_ID && planningEditAssignments(state).length === 0,
    "Planning Grid AX initial state",
    60,
  );
  planningAxInteraction.screen = planningAxScreenProbe?.screen ?? "";
  planningAxInteraction.probeBlockId = planningAxProbe?.blockId ?? "";
  planningAxInteraction.initialCount = planningEditAssignments(planningAxInitial.state).length;

  let planningAxStatus = "FAIL";
  let planningAxDetail = "";
  if (!planningAxInitial.ok) {
    planningAxInteraction.status = "failed";
    planningAxInteraction.message = planningAxInitial.error;
    planningAxDetail = `Planning Grid AX launch did not reach the seeded empty edit state: ${planningAxInitial.error}`;
  } else {
    const applyClick = await axClickWhenReady("planning-grid-apply-button", "Apply");
    planningAxInteraction.clickResults.apply = applyClick;
    if (!applyClick.ok) {
      planningAxStatus = isAxEnvironmentIssue(applyClick) ? "SKIP" : "FAIL";
      planningAxInteraction.status = planningAxStatus === "SKIP" ? "skipped" : "failed";
      planningAxInteraction.message = applyClick.text || applyClick.stderr || "Apply button was not clickable.";
      planningAxDetail = `Planning Grid AX Apply click did not run: ${planningAxInteraction.message}`;
    } else {
      const afterApply = await waitForSchedulerState((state) => {
        const assignments = planningEditAssignments(state);
        return (
          state?.activeBlockId === PLANNING_EDIT_BLOCK_ID &&
          assignments.length === PLANNING_EDIT_DATES.length &&
          planningEditDatesMatch(assignments)
        );
      }, "Planning Grid AX Apply result", 80);
      const afterApplyAssignments = planningEditAssignments(afterApply.state);
      planningAxInteraction.afterApplyCount = afterApplyAssignments.length;
      planningAxInteraction.afterApplyDates = afterApplyAssignments.map((assignment) => assignment.date);

      await sleep(250);
      const undoClick = afterApply.ok ? await axClickWhenReady("scheduler-toolbar-undo", "Undo", 8) : { ok: false, text: afterApply.error, stderr: "" };
      planningAxInteraction.clickResults.undo = undoClick;
      const afterUndo = undoClick.ok
        ? await waitForSchedulerState(
            (state) => state?.activeBlockId === PLANNING_EDIT_BLOCK_ID && planningEditAssignments(state).length === 0,
            "Planning Grid AX Undo result",
            80,
          )
        : { ok: false, state: afterApply.state, error: undoClick.text || undoClick.stderr || "Undo button was not clickable." };
      planningAxInteraction.afterUndoCount = planningEditAssignments(afterUndo.state).length;

      await sleep(250);
      const redoClick = afterUndo.ok ? await axClickWhenReady("scheduler-toolbar-redo", "Redo", 8) : { ok: false, text: afterUndo.error, stderr: "" };
      planningAxInteraction.clickResults.redo = redoClick;
      const afterRedo = redoClick.ok
        ? await waitForSchedulerState((state) => {
            const assignments = planningEditAssignments(state);
            return (
              state?.activeBlockId === PLANNING_EDIT_BLOCK_ID &&
              assignments.length === PLANNING_EDIT_DATES.length &&
              planningEditDatesMatch(assignments)
            );
          }, "Planning Grid AX Redo result", 80)
        : { ok: false, state: afterUndo.state, error: redoClick.text || redoClick.stderr || "Redo button was not clickable." };
      const afterRedoAssignments = planningEditAssignments(afterRedo.state);
      planningAxInteraction.afterRedoCount = afterRedoAssignments.length;
      planningAxInteraction.afterRedoDates = afterRedoAssignments.map((assignment) => assignment.date);
      planningAxInteraction.afterRedoSources = afterRedoAssignments.map((assignment) => assignment.source ?? "");

      const afterRedoSourcesMatch = afterRedoAssignments.every((assignment) =>
        String(assignment.source ?? "").toLowerCase().includes("range"),
      );
      const planningAxMatches =
        afterApply.ok &&
        undoClick.ok &&
        afterUndo.ok &&
        redoClick.ok &&
        afterRedo.ok &&
        planningAxInteraction.initialCount === 0 &&
        planningAxInteraction.afterApplyCount === PLANNING_EDIT_DATES.length &&
        planningAxInteraction.afterUndoCount === 0 &&
        planningAxInteraction.afterRedoCount === PLANNING_EDIT_DATES.length &&
        planningEditDatesMatch(afterRedoAssignments) &&
        afterRedoSourcesMatch;
      planningAxInteraction.ok = planningAxMatches;
      planningAxInteraction.status = planningAxMatches ? "passed" : "failed";
      planningAxInteraction.message =
        afterRedo.error ||
        afterUndo.error ||
        afterApply.error ||
        redoClick.text ||
        undoClick.text ||
        applyClick.text ||
        "";
      planningAxDetail = `Planning Grid AX clicked Apply/Undo/Redo with counts ${planningAxInteraction.initialCount}->${planningAxInteraction.afterApplyCount}->${planningAxInteraction.afterUndoCount}->${planningAxInteraction.afterRedoCount} for ${PLANNING_EDIT_ROTATOR_ID}.`;
      planningAxStatus = planningAxMatches ? "PASS" : "FAIL";
    }
  }
  results.push(
    result(
      "T-SCH-NATIVE-UI-030",
      planningAxStatus,
      planningAxDetail,
      existsSync(planningAxProbePath) ? planningAxProbePath : planningAxDataDir,
    ),
  );

  // New top-toolbar Paint mode: the toggle must be AX-discoverable; with
  // Paint ON an AXPress on a grid cell paints exactly one day through
  // assign.range (undo reverts it); with Paint OFF the same press only
  // selects the row and mutates nothing.
  const PAINT_CELL_DATE = "2026-08-05";
  const paintCellId = `planning-grid-cell-${PLANNING_EDIT_ROTATOR_ID}-${PAINT_CELL_DATE}`;
  let paintToggleStatus = "SKIP";
  let paintToggleDetail = "Planning Grid AX did not reach the paint toggle stage.";
  if (planningAxInitial.ok) {
    // Start from an empty week: one more Undo reverts 030's redone range.
    const clearClick = await axClickWhenReady("scheduler-toolbar-undo", "Undo", 8);
    planningAxInteraction.clickResults.paintPrepUndo = clearClick;
    if (!clearClick.ok) {
      paintToggleStatus = isAxEnvironmentIssue(clearClick) ? "SKIP" : "FAIL";
      paintToggleDetail = `Paint probe prep Undo was not clickable: ${clearClick.text || clearClick.stderr || "no osascript output (timeout)"}`;
    } else {
    const cleared = await waitForSchedulerState(
      (state) => planningEditAssignments(state).length === 0,
      "Paint probe cleared state",
      40,
    );
    if (!cleared.ok) {
      paintToggleStatus = "FAIL";
      paintToggleDetail = `Paint probe could not reach a cleared state: ${cleared.error}`;
    } else {
      // Paint starts ON (default pinned before launch), so a cell press
      // paints immediately; the toggle is exercised by the off-phase below.
      await sleep(400);
      const paintCellClick = await axClickWhenReady(paintCellId, "cell", 12);
      planningAxInteraction.clickResults.paintCell = paintCellClick;
      const afterPaint = paintCellClick.ok
        ? await waitForSchedulerState((state) => {
            const assignments = planningEditAssignments(state);
            return assignments.length === 1 && assignments[0].date === PAINT_CELL_DATE;
          }, "Paint probe single-day paint", 60)
        : { ok: false, state: cleared.state, error: paintCellClick.text || "Paint cell was not clickable." };
      const paintedSource = String(planningEditAssignments(afterPaint.state)[0]?.source ?? "");

      const paintUndoClick = afterPaint.ok ? await axClickWhenReady("scheduler-toolbar-undo", "Undo", 8) : { ok: false, text: afterPaint.error, stderr: "" };
      planningAxInteraction.clickResults.paintUndo = paintUndoClick;
      const afterPaintUndo = paintUndoClick.ok
        ? await waitForSchedulerState(
            (state) => planningEditAssignments(state).length === 0,
            "Paint probe undo",
            40,
          )
        : { ok: false, state: afterPaint.state, error: paintUndoClick.text || "Undo was not clickable." };

      const paintOffClick = await axClickWhenReady("planning-grid-paint-toggle", "Paint", 8);
      planningAxInteraction.clickResults.paintToggleOff = paintOffClick;
      await sleep(400);
      const offCellClick = paintOffClick.ok ? await axClickWhenReady(paintCellId, "cell", 8) : { ok: false, text: "toggle off failed", stderr: "" };
      planningAxInteraction.clickResults.paintOffCell = offCellClick;
      await sleep(600);
      const afterOffClick = await waitForSchedulerState(() => true, "Paint probe paint-off state", 10);
      const offClickCount = planningEditAssignments(afterOffClick.state).length;

      // Restore paint ON — the audit app shares the UserDefaults domain with
      // the user's real app, so a leaked OFF would change their default.
      const paintOnRestore = paintOffClick.ok ? await axClickWhenReady("planning-grid-paint-toggle", "Paint", 8) : { ok: false, text: "toggle off failed", stderr: "" };
      planningAxInteraction.clickResults.paintToggleOn = paintOnRestore;

      const paintMatches =
        afterPaint.ok &&
        paintedSource.toLowerCase().includes("range") &&
        afterPaintUndo.ok &&
        paintOffClick.ok &&
        offCellClick.ok &&
        offClickCount === 0;
      paintToggleStatus = paintMatches ? "PASS" : "FAIL";
      paintToggleDetail = paintMatches
        ? `Paint mode painted ${PAINT_CELL_DATE} via one cell press (source ${paintedSource}), Undo reverted it, and a paint-off cell press mutated nothing.`
        : `Paint probe failed: paint=${afterPaint.ok} source=${paintedSource} undo=${afterPaintUndo.ok} off=${paintOffClick.ok}/${offCellClick.ok} offCount=${offClickCount}. ${afterPaintUndo.error || afterPaint.error || ""}`;
    }
    }
  }
  results.push(
    result(
      "T-SCH-NATIVE-UI-031",
      paintToggleStatus,
      paintToggleDetail,
      existsSync(planningAxProbePath) ? planningAxProbePath : planningAxDataDir,
    ),
  );

  rmSync(sourcesImportDataDir, { recursive: true, force: true });
  mkdirSync(sourcesImportDataDir, { recursive: true });
  const sourcesImportSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", sourcesImportDataDir, "--profile", "sources-roster-import"],
    { timeout: 20_000 },
  );
  writeFileSync(sourcesImportSeedLogPath, `${sourcesImportSeed.stdout || ""}${sourcesImportSeed.stderr || ""}`, "utf8");
  if (sourcesImportSeed.status !== 0) {
    throw new Error(`native audit Sources import seed failed; see ${sourcesImportSeedLogPath}`);
  }

  const sourcesImportVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Sources",
      SCHEDULER_DATA_DIR: sourcesImportDataDir,
      SCHEDULER_SOURCES_IMPORT_AUDIT: "1",
    },
  });
  writeFileSync(sourcesImportBuildLogPath, `${sourcesImportVerify.stdout || ""}${sourcesImportVerify.stderr || ""}`, "utf8");
  if (sourcesImportVerify.status !== 0) {
    throw new Error(`native Sources import verify failed; see ${sourcesImportBuildLogPath}`);
  }

  const sourcesImportProbe = await readJsonProbe(sourcesImportProbePath, 120);
  const sourcesImportSummary = summarizeSourcesImportProbe(sourcesImportProbe);
  const sourcesImportProbeMatches =
    sourcesImportSummary.ok === true &&
    sourcesImportSummary.blockId === SOURCES_IMPORT_BLOCK_ID &&
    sourcesImportSummary.blockName === SOURCES_IMPORT_BLOCK_NAME &&
    sourcesImportSummary.previewAdded === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSummary.previewRows === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSummary.previewWarnings === 0 &&
    sourcesImportSummary.afterSourceCount === 1 &&
    sourcesImportSummary.afterRotatorCount === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSummary.importedFileName === "native-source-import-audit.csv" &&
    sourcesImportSummary.importedRotatorCount === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSummary.importedParsedRows === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSummary.importedWarningCount === 0 &&
    SOURCES_IMPORT_NAMES.every((name) => sourcesImportSummary.importedRotators.includes(name));
  results.push(
    result(
      "T-SCH-NATIVE-UI-014",
      sourcesImportProbeMatches ? "PASS" : "FAIL",
      `Sources import probe block="${sourcesImportSummary.blockId || "missing"}" added=${sourcesImportSummary.previewAdded} rows=${sourcesImportSummary.previewRows} source="${sourcesImportSummary.importedFileName || "missing"}" rotators=${sourcesImportSummary.importedRotators.join(", ") || "missing"}.`,
      sourcesImportProbe ? sourcesImportProbePath : "",
    ),
  );

  const sourcesImportState = await readSchedulerState();
  const sourcesImportBlock = (sourcesImportState?.serviceBlocks ?? []).find((block) => block.id === SOURCES_IMPORT_BLOCK_ID);
  const sourcesImportRotatorNames = (sourcesImportState?.rotators ?? []).map(
    (rotator) => rotator.displayName || rotator.fullName || rotator.id,
  );
  const sourcesImportSource = (sourcesImportState?.sources ?? []).find(
    (source) => source.fileName === "native-source-import-audit.csv",
  );
  const sourcesImportStateMatches =
    sourcesImportState?.activeBlockId === SOURCES_IMPORT_BLOCK_ID &&
    sourcesImportBlock?.name === SOURCES_IMPORT_BLOCK_NAME &&
    SOURCES_IMPORT_NAMES.every((name) => sourcesImportRotatorNames.includes(name)) &&
    sourcesImportSource?.status === "Reviewed" &&
    sourcesImportSource?.importedRotatorCount === SOURCES_IMPORT_NAMES.length &&
    sourcesImportSource?.importWarningCount === 0 &&
    Array.isArray(sourcesImportSource?.parsedRows) &&
    sourcesImportSource.parsedRows.length === SOURCES_IMPORT_NAMES.length;
  results.push(
    result(
      "T-SCH-NATIVE-UI-015",
      sourcesImportStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Sources import persisted ${sourcesImportRotatorNames.length} rotator(s) and source "${sourcesImportSource?.fileName || "missing"}" for ${sourcesImportBlock?.name || "missing"}.`,
    ),
  );

  rmSync(rotatorsEditDataDir, { recursive: true, force: true });
  mkdirSync(rotatorsEditDataDir, { recursive: true });
  const rotatorsEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", rotatorsEditDataDir, "--profile", "rotators-edit"],
    { timeout: 20_000 },
  );
  writeFileSync(rotatorsEditSeedLogPath, `${rotatorsEditSeed.stdout || ""}${rotatorsEditSeed.stderr || ""}`, "utf8");
  if (rotatorsEditSeed.status !== 0) {
    throw new Error(`native audit Rotators edit seed failed; see ${rotatorsEditSeedLogPath}`);
  }

  const rotatorsEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Rotators",
      SCHEDULER_DATA_DIR: rotatorsEditDataDir,
      SCHEDULER_ROTATORS_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(rotatorsEditBuildLogPath, `${rotatorsEditVerify.stdout || ""}${rotatorsEditVerify.stderr || ""}`, "utf8");
  if (rotatorsEditVerify.status !== 0) {
    throw new Error(`native Rotators edit verify failed; see ${rotatorsEditBuildLogPath}`);
  }

  const rotatorsEditProbe = await readJsonProbe(rotatorsEditProbePath, 120);
  const rotatorsEditSummary = summarizeRotatorsEditProbe(rotatorsEditProbe);
  const rotatorsEditProbeMatches =
    rotatorsEditSummary.ok === true &&
    rotatorsEditSummary.blockId === ROTATORS_EDIT_BLOCK_ID &&
    rotatorsEditSummary.blockName === ROTATORS_EDIT_BLOCK_NAME &&
    rotatorsEditSummary.initialRotatorCount === 0 &&
    rotatorsEditSummary.afterRotatorCount === 2 &&
    rotatorsEditSummary.fullName === ROTATORS_EDIT_TARGET &&
    rotatorsEditSummary.displayName === ROTATORS_EDIT_DISPLAY_NAME &&
    rotatorsEditSummary.program === "Methodist" &&
    rotatorsEditSummary.level === "PGY-4" &&
    rotatorsEditSummary.schoolType === "methodist" &&
    rotatorsEditSummary.rotationStartDate === "2026-10-06" &&
    rotatorsEditSummary.methodistStartSide === "outpatient" &&
    rotatorsEditSummary.bulkDeleteTargetStillPresent === false &&
    rotatorsEditSummary.dedupeRemovedCount === 1 &&
    rotatorsEditSummary.duplicateStillPresent === false &&
    rotatorsEditSummary.duplicateInpatientRepointed === true &&
    rotatorsEditSummary.duplicateOutpatientRepointed === true &&
    rotatorsEditSummary.dedupedSegments.length === 2 &&
    rotatorsEditSummary.dayOff.includes("Monday") &&
    rotatorsEditSummary.dayOff.includes("Friday") &&
    rotatorsEditSummary.segments.length === 2 &&
    rotatorsEditSummary.unavailableRanges.length === 1;
  results.push(
    result(
      "T-SCH-NATIVE-UI-016",
      rotatorsEditProbeMatches ? "PASS" : "FAIL",
      `Rotators edit probe block="${rotatorsEditSummary.blockId || "missing"}" count=${rotatorsEditSummary.initialRotatorCount}->${rotatorsEditSummary.afterRotatorCount} display="${rotatorsEditSummary.displayName || "missing"}" schoolType="${rotatorsEditSummary.schoolType || "missing"}" dedupeRemoved=${rotatorsEditSummary.dedupeRemovedCount}.`,
      rotatorsEditProbe ? rotatorsEditProbePath : "",
    ),
  );

  const rotatorsEditState = await readSchedulerState();
  const rotatorsEditBlock = (rotatorsEditState?.serviceBlocks ?? []).find((block) => block.id === ROTATORS_EDIT_BLOCK_ID);
  const rotatorsEditMaya = (rotatorsEditState?.rotators ?? []).find((rotator) => rotator.fullName === ROTATORS_EDIT_TARGET);
  const rotatorsEditBulkTarget = (rotatorsEditState?.rotators ?? []).find((rotator) => rotator.fullName === "Taylor Stone");
  const rotatorsEditStateMatches =
    rotatorsEditState?.activeBlockId === ROTATORS_EDIT_BLOCK_ID &&
    rotatorsEditBlock?.name === ROTATORS_EDIT_BLOCK_NAME &&
    (rotatorsEditState?.rotators ?? []).length === 2 &&
    !rotatorsEditBulkTarget &&
    rotatorsEditMaya?.displayName === ROTATORS_EDIT_DISPLAY_NAME &&
    rotatorsEditMaya?.program === "Methodist" &&
    rotatorsEditMaya?.level === "PGY-4" &&
    rotatorsEditMaya?.schoolType === "methodist" &&
    rotatorsEditMaya?.rotationStartDate === "2026-10-06" &&
    rotatorsEditMaya?.methodistStartSide === "outpatient" &&
    Array.isArray(rotatorsEditMaya?.segments) &&
    rotatorsEditMaya.segments.length === 2 &&
    Array.isArray(rotatorsEditMaya?.dayOff) &&
    rotatorsEditMaya.dayOff.includes("Monday") &&
    rotatorsEditMaya.dayOff.includes("Friday") &&
    Array.isArray(rotatorsEditMaya?.unavailableRanges) &&
    rotatorsEditMaya.unavailableRanges.length === 1 &&
    (rotatorsEditState?.rotators ?? []).filter((rotator) => rotator.fullName === "Drew Quinn").length === 1 &&
    (rotatorsEditState?.inpatientAssignments ?? []).some((assignment) => assignment.date === "2026-10-07" && assignment.rotatorId !== rotatorsEditSummary.duplicateRemovedId) &&
    (rotatorsEditState?.outpatientSessions ?? []).some((session) => session.date === "2026-10-08" && session.period === "AM" && session.rotatorId !== rotatorsEditSummary.duplicateRemovedId);
  results.push(
    result(
      "T-SCH-NATIVE-UI-017",
      rotatorsEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Rotators edit persisted "${rotatorsEditMaya?.displayName || "missing"}", removed the bulk-delete target, and deduped Drew Quinn; rotator count=${(rotatorsEditState?.rotators ?? []).length}.`,
    ),
  );

  rmSync(outpatientEditDataDir, { recursive: true, force: true });
  mkdirSync(outpatientEditDataDir, { recursive: true });
  const outpatientEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", outpatientEditDataDir, "--profile", "outpatient-edit"],
    { timeout: 20_000 },
  );
  writeFileSync(outpatientEditSeedLogPath, `${outpatientEditSeed.stdout || ""}${outpatientEditSeed.stderr || ""}`, "utf8");
  if (outpatientEditSeed.status !== 0) {
    throw new Error(`native audit Outpatient edit seed failed; see ${outpatientEditSeedLogPath}`);
  }

  const outpatientEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Outpatient",
      SCHEDULER_DATA_DIR: outpatientEditDataDir,
      SCHEDULER_OUTPATIENT_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(outpatientEditBuildLogPath, `${outpatientEditVerify.stdout || ""}${outpatientEditVerify.stderr || ""}`, "utf8");
  if (outpatientEditVerify.status !== 0) {
    throw new Error(`native Outpatient edit verify failed; see ${outpatientEditBuildLogPath}`);
  }

  const outpatientEditProbe = await readJsonProbe(outpatientEditProbePath, 120);
  const outpatientEditSummary = summarizeOutpatientEditProbe(outpatientEditProbe);
  const outpatientEditProbeMatches =
    outpatientEditSummary.ok === true &&
    outpatientEditSummary.blockId === OUTPATIENT_EDIT_BLOCK_ID &&
    outpatientEditSummary.blockName === OUTPATIENT_EDIT_BLOCK_NAME &&
    outpatientEditSummary.targetDate === OUTPATIENT_EDIT_DATE &&
    outpatientEditSummary.targetPeriod === "AM" &&
    outpatientEditSummary.targetRotatorId === OUTPATIENT_EDIT_ROTATOR_ID &&
    outpatientEditSummary.clinic === "Resident Clinic" &&
    outpatientEditSummary.provider === "Alder" &&
    outpatientEditSummary.initialSessionCount === 0 &&
    outpatientEditSummary.afterAssignCount === 1 &&
    outpatientEditSummary.afterDeleteCount === 0 &&
    outpatientEditSummary.sessionStillPresent === false &&
    outpatientEditSummary.details.length === 2 &&
    outpatientEditSummary.details.some((detail) => detail.clinic === "Epilepsy Clinic" && detail.attending === "Birch") &&
    outpatientEditSummary.details.some((detail) => detail.clinic === "Resident Clinic" && detail.attending === "Alder");
  results.push(
    result(
      "T-SCH-NATIVE-UI-018",
      outpatientEditProbeMatches ? "PASS" : "FAIL",
      `Outpatient edit probe block="${outpatientEditSummary.blockId || "missing"}" session="${outpatientEditSummary.sessionId || "missing"}" count=${outpatientEditSummary.initialSessionCount}->${outpatientEditSummary.afterAssignCount}->${outpatientEditSummary.afterDeleteCount} details=${outpatientEditSummary.details.length}.`,
      outpatientEditProbe ? outpatientEditProbePath : "",
    ),
  );

  const outpatientEditState = await readSchedulerState();
  const outpatientEditBlock = (outpatientEditState?.serviceBlocks ?? []).find((block) => block.id === OUTPATIENT_EDIT_BLOCK_ID);
  const outpatientEditRotator = (outpatientEditState?.rotators ?? []).find((rotator) => rotator.id === OUTPATIENT_EDIT_ROTATOR_ID);
  const outpatientEditStateMatches =
    outpatientEditState?.activeBlockId === OUTPATIENT_EDIT_BLOCK_ID &&
    outpatientEditBlock?.name === OUTPATIENT_EDIT_BLOCK_NAME &&
    outpatientEditRotator?.fullName === "Drew Quinn" &&
    Array.isArray(outpatientEditState?.outpatientSessions) &&
    outpatientEditState.outpatientSessions.length === 0;
  results.push(
    result(
      "T-SCH-NATIVE-UI-019",
      outpatientEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Outpatient assign/delete ended with ${outpatientEditState?.outpatientSessions?.length ?? "missing"} outpatient session(s) for ${outpatientEditBlock?.name || "missing"}.`,
    ),
  );

  rmSync(inpatientEditDataDir, { recursive: true, force: true });
  mkdirSync(inpatientEditDataDir, { recursive: true });
  const inpatientEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", inpatientEditDataDir, "--profile", "inpatient-edit"],
    { timeout: 20_000 },
  );
  writeFileSync(inpatientEditSeedLogPath, `${inpatientEditSeed.stdout || ""}${inpatientEditSeed.stderr || ""}`, "utf8");
  if (inpatientEditSeed.status !== 0) {
    throw new Error(`native audit Inpatient edit seed failed; see ${inpatientEditSeedLogPath}`);
  }

  const inpatientEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Inpatient",
      SCHEDULER_DATA_DIR: inpatientEditDataDir,
      SCHEDULER_INPATIENT_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(inpatientEditBuildLogPath, `${inpatientEditVerify.stdout || ""}${inpatientEditVerify.stderr || ""}`, "utf8");
  if (inpatientEditVerify.status !== 0) {
    throw new Error(`native Inpatient edit verify failed; see ${inpatientEditBuildLogPath}`);
  }

  const inpatientEditProbe = await readJsonProbe(inpatientEditProbePath, 120);
  const inpatientEditSummary = summarizeInpatientEditProbe(inpatientEditProbe);
  const inpatientEditProbeMatches =
    inpatientEditSummary.ok === true &&
    inpatientEditSummary.blockId === INPATIENT_EDIT_BLOCK_ID &&
    inpatientEditSummary.blockName === INPATIENT_EDIT_BLOCK_NAME &&
    inpatientEditSummary.targetDate === INPATIENT_EDIT_DATE &&
    inpatientEditSummary.targetRotatorId === INPATIENT_EDIT_ROTATOR_ID &&
    inpatientEditSummary.targetRole === INPATIENT_EDIT_ROLE &&
    inpatientEditSummary.source === "Manual" &&
    inpatientEditSummary.initialAssignmentCount === 0 &&
    inpatientEditSummary.afterAssignCount === 1 &&
    inpatientEditSummary.afterDeleteCount === 0 &&
    inpatientEditSummary.assignmentStillPresent === false;
  results.push(
    result(
      "T-SCH-NATIVE-UI-020",
      inpatientEditProbeMatches ? "PASS" : "FAIL",
      `Inpatient edit probe block="${inpatientEditSummary.blockId || "missing"}" assignment="${inpatientEditSummary.assignmentId || "missing"}" role="${inpatientEditSummary.targetRole || "missing"}" count=${inpatientEditSummary.initialAssignmentCount}->${inpatientEditSummary.afterAssignCount}->${inpatientEditSummary.afterDeleteCount} source="${inpatientEditSummary.source || "missing"}".`,
      inpatientEditProbe ? inpatientEditProbePath : "",
    ),
  );

  const inpatientEditState = await readSchedulerState();
  const inpatientEditBlock = (inpatientEditState?.serviceBlocks ?? []).find((block) => block.id === INPATIENT_EDIT_BLOCK_ID);
  const inpatientEditRotator = (inpatientEditState?.rotators ?? []).find((rotator) => rotator.id === INPATIENT_EDIT_ROTATOR_ID);
  const inpatientEditStateMatches =
    inpatientEditState?.activeBlockId === INPATIENT_EDIT_BLOCK_ID &&
    inpatientEditBlock?.name === INPATIENT_EDIT_BLOCK_NAME &&
    inpatientEditRotator?.fullName === "Jordan Lee" &&
    Array.isArray(inpatientEditState?.inpatientAssignments) &&
    inpatientEditState.inpatientAssignments.length === 0;
  results.push(
    result(
      "T-SCH-NATIVE-UI-021",
      inpatientEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Inpatient assign/delete ended with ${inpatientEditState?.inpatientAssignments?.length ?? "missing"} inpatient assignment(s) for ${inpatientEditBlock?.name || "missing"}.`,
    ),
  );

  rmSync(clinicsEditDataDir, { recursive: true, force: true });
  mkdirSync(clinicsEditDataDir, { recursive: true });
  const clinicsEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", clinicsEditDataDir, "--profile", "clinics-edit"],
    { timeout: 20_000 },
  );
  writeFileSync(clinicsEditSeedLogPath, `${clinicsEditSeed.stdout || ""}${clinicsEditSeed.stderr || ""}`, "utf8");
  if (clinicsEditSeed.status !== 0) {
    throw new Error(`native audit Clinics edit seed failed; see ${clinicsEditSeedLogPath}`);
  }

  const clinicsEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Clinics",
      SCHEDULER_DATA_DIR: clinicsEditDataDir,
      SCHEDULER_CLINICS_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(clinicsEditBuildLogPath, `${clinicsEditVerify.stdout || ""}${clinicsEditVerify.stderr || ""}`, "utf8");
  if (clinicsEditVerify.status !== 0) {
    throw new Error(`native Clinics edit verify failed; see ${clinicsEditBuildLogPath}`);
  }

  const clinicsEditProbe = await readJsonProbe(clinicsEditProbePath, 120);
  const clinicsEditSummary = summarizeClinicsEditProbe(clinicsEditProbe);
  const clinicsEditProbeMatches =
    clinicsEditSummary.ok === true &&
    clinicsEditSummary.blockId === CLINICS_EDIT_BLOCK_ID &&
    clinicsEditSummary.blockName === CLINICS_EDIT_BLOCK_NAME &&
    clinicsEditSummary.targetDate === CLINICS_EDIT_DATE &&
    clinicsEditSummary.targetSession === CLINICS_EDIT_SESSION &&
    clinicsEditSummary.targetOccurrenceId === CLINICS_EDIT_OCCURRENCE_ID &&
    clinicsEditSummary.targetRotatorId === CLINICS_EDIT_ROTATOR_ID &&
    clinicsEditSummary.source === "manual" &&
    clinicsEditSummary.initialAssignmentCount === 0 &&
    clinicsEditSummary.afterAssignCount === 1 &&
    clinicsEditSummary.afterDeleteCount === 0 &&
    clinicsEditSummary.assignmentStillPresent === false;
  results.push(
    result(
      "T-SCH-NATIVE-UI-022",
      clinicsEditProbeMatches ? "PASS" : "FAIL",
      `Clinics edit probe block="${clinicsEditSummary.blockId || "missing"}" assignment="${clinicsEditSummary.assignmentId || "missing"}" occurrence="${clinicsEditSummary.targetOccurrenceId || "missing"}" count=${clinicsEditSummary.initialAssignmentCount}->${clinicsEditSummary.afterAssignCount}->${clinicsEditSummary.afterDeleteCount} source="${clinicsEditSummary.source || "missing"}".`,
      clinicsEditProbe ? clinicsEditProbePath : "",
    ),
  );

  const clinicsEditState = await readSchedulerState();
  const clinicsEditBlock = (clinicsEditState?.serviceBlocks ?? []).find((block) => block.id === CLINICS_EDIT_BLOCK_ID);
  const clinicsEditRotator = (clinicsEditState?.rotators ?? []).find((rotator) => rotator.id === CLINICS_EDIT_ROTATOR_ID);
  const clinicsEditStateMatches =
    clinicsEditState?.activeBlockId === CLINICS_EDIT_BLOCK_ID &&
    clinicsEditBlock?.name === CLINICS_EDIT_BLOCK_NAME &&
    clinicsEditRotator?.fullName === "Casey Morgan" &&
    Array.isArray(clinicsEditState?.outpatientSessions) &&
    clinicsEditState.outpatientSessions.some(
      (session) => session.date === CLINICS_EDIT_DATE && session.period === CLINICS_EDIT_SESSION && session.rotatorId === CLINICS_EDIT_ROTATOR_ID,
    ) &&
    Array.isArray(clinicsEditState?.clinicAssignments) &&
    clinicsEditState.clinicAssignments.length === 0;
  results.push(
    result(
      "T-SCH-NATIVE-UI-023",
      clinicsEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Clinics assign/delete ended with ${clinicsEditState?.clinicAssignments?.length ?? "missing"} clinic assignment(s) for ${clinicsEditBlock?.name || "missing"}.`,
    ),
  );

  rmSync(fellowsResolveDataDir, { recursive: true, force: true });
  mkdirSync(fellowsResolveDataDir, { recursive: true });
  const fellowsResolveSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", fellowsResolveDataDir, "--profile", "fellows-resolve"],
    { timeout: 20_000 },
  );
  writeFileSync(fellowsResolveSeedLogPath, `${fellowsResolveSeed.stdout || ""}${fellowsResolveSeed.stderr || ""}`, "utf8");
  if (fellowsResolveSeed.status !== 0) {
    throw new Error(`native audit Fellows resolve seed failed; see ${fellowsResolveSeedLogPath}`);
  }

  const fellowsResolveVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Fellows",
      SCHEDULER_DATA_DIR: fellowsResolveDataDir,
      SCHEDULER_FELLOWS_RESOLVE_AUDIT: "1",
    },
  });
  writeFileSync(fellowsResolveBuildLogPath, `${fellowsResolveVerify.stdout || ""}${fellowsResolveVerify.stderr || ""}`, "utf8");
  if (fellowsResolveVerify.status !== 0) {
    throw new Error(`native Fellows resolve verify failed; see ${fellowsResolveBuildLogPath}`);
  }

  const fellowsResolveProbe = await readJsonProbe(fellowsResolveProbePath, 120);
  const fellowsResolveSummary = summarizeFellowsResolveProbe(fellowsResolveProbe);
  const fellowsResolveProbeMatches =
    fellowsResolveSummary.ok === true &&
    fellowsResolveSummary.blockId === FELLOWS_RESOLVE_BLOCK_ID &&
    fellowsResolveSummary.blockName === FELLOWS_RESOLVE_BLOCK_NAME &&
    fellowsResolveSummary.targetRotatorId === FELLOWS_RESOLVE_ROTATOR_ID &&
    sameStringSet(fellowsResolveSummary.candidateNames, FELLOWS_RESOLVE_CANDIDATES) &&
    sameStringSet(fellowsResolveSummary.dates, FELLOWS_RESOLVE_DATES) &&
    sameStringSet(fellowsResolveSummary.assignmentDates, FELLOWS_RESOLVE_DATES) &&
    fellowsResolveSummary.sourceValues.length === 1 &&
    fellowsResolveSummary.sourceValues[0] === "Manual" &&
    fellowsResolveSummary.initialAssignmentCount === 0 &&
    fellowsResolveSummary.afterDraftAssignmentCount === 0 &&
    fellowsResolveSummary.afterResolveAssignmentCount === FELLOWS_RESOLVE_DATES.length &&
    fellowsResolveSummary.resolvedAssignmentCount === FELLOWS_RESOLVE_DATES.length &&
    fellowsResolveSummary.draftReportCleared === true;
  results.push(
    result(
      "T-SCH-NATIVE-UI-024",
      fellowsResolveProbeMatches ? "PASS" : "FAIL",
      `Fellows resolve probe block="${fellowsResolveSummary.blockId || "missing"}" warning="fellow-blank-candidates" candidates="${fellowsResolveSummary.candidateNames.join(" / ") || "missing"}" resolved=${fellowsResolveSummary.resolvedAssignmentCount} source="${fellowsResolveSummary.sourceValues.join(", ") || "missing"}".`,
      fellowsResolveProbe ? fellowsResolveProbePath : "",
    ),
  );

  const fellowsResolveState = await readSchedulerState();
  const fellowsResolveBlock = (fellowsResolveState?.serviceBlocks ?? []).find((block) => block.id === FELLOWS_RESOLVE_BLOCK_ID);
  const fellowsResolveRotator = (fellowsResolveState?.rotators ?? []).find((rotator) => rotator.id === FELLOWS_RESOLVE_ROTATOR_ID);
  const fellowsResolveAssignments = (fellowsResolveState?.inpatientAssignments ?? []).filter(
    (assignment) => assignment.rotatorId === FELLOWS_RESOLVE_ROTATOR_ID && assignment.role === "Fellow",
  );
  const fellowsResolveStateMatches =
    fellowsResolveState?.activeBlockId === FELLOWS_RESOLVE_BLOCK_ID &&
    fellowsResolveBlock?.name === FELLOWS_RESOLVE_BLOCK_NAME &&
    fellowsResolveRotator?.fullName === "Coordinator" &&
    fellowsResolveAssignments.length === FELLOWS_RESOLVE_DATES.length &&
    fellowsResolveAssignments.every((assignment) => assignment.source === "Manual") &&
    FELLOWS_RESOLVE_DATES.every((date) => fellowsResolveAssignments.some((assignment) => assignment.date === date));
  results.push(
    result(
      "T-SCH-NATIVE-UI-025",
      fellowsResolveStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Fellows resolve persisted ${fellowsResolveAssignments.length} Manual Fellow inpatient assignment(s) for ${fellowsResolveBlock?.name || "missing"}.`,
    ),
  );

  rmSync(settingsEditDataDir, { recursive: true, force: true });
  mkdirSync(settingsEditDataDir, { recursive: true });
  const settingsEditSeed = run(
    "node",
    ["e2e/seed-demo-state.mjs", "--data-dir", settingsEditDataDir, "--profile", "settings-edit"],
    { timeout: 20_000 },
  );
  writeFileSync(settingsEditSeedLogPath, `${settingsEditSeed.stdout || ""}${settingsEditSeed.stderr || ""}`, "utf8");
  if (settingsEditSeed.status !== 0) {
    throw new Error(`native audit Settings edit seed failed; see ${settingsEditSeedLogPath}`);
  }

  const settingsEditVerify = shell("bash script/build_and_run.sh --verify", {
    timeout: 120_000,
    env: {
      ...process.env,
      SCHEDULER_INITIAL_SCREEN: "Settings",
      SCHEDULER_DATA_DIR: settingsEditDataDir,
      SCHEDULER_SETTINGS_EDIT_AUDIT: "1",
    },
  });
  writeFileSync(settingsEditBuildLogPath, `${settingsEditVerify.stdout || ""}${settingsEditVerify.stderr || ""}`, "utf8");
  if (settingsEditVerify.status !== 0) {
    throw new Error(`native Settings edit verify failed; see ${settingsEditBuildLogPath}`);
  }

  const settingsEditProbe = await readJsonProbe(settingsEditProbePath, 120);
  const settingsEditSummary = summarizeSettingsEditProbe(settingsEditProbe);
  const settingsEditProbeMatches =
    settingsEditSummary.ok === true &&
    settingsEditSummary.blockId === SETTINGS_EDIT_BLOCK_ID &&
    settingsEditSummary.blockName === SETTINGS_EDIT_BLOCK_NAME &&
    settingsEditSummary.blockStatus === "Review" &&
    settingsEditSummary.weekdayCoverage === 3 &&
    settingsEditSummary.saturdayCoverage === 1 &&
    settingsEditSummary.sundayCoverage === 0 &&
    settingsEditSummary.holidayCoverage === 2 &&
    settingsEditSummary.holidayDate === SETTINGS_EDIT_HOLIDAY_DATE &&
    settingsEditSummary.holidayLabel === "Audit Holiday" &&
    settingsEditSummary.holidayNoClinic === true &&
    settingsEditSummary.maxConsecutiveInpatientDays === 4 &&
    settingsEditSummary.honorNoClinicHolidays === false &&
    settingsEditSummary.posterProgramName === "Audit Pediatric Neurology" &&
    settingsEditSummary.posterChief === "Dr. Audit" &&
    settingsEditSummary.posterTagline === "Audit ready" &&
    sameStringSet(settingsEditSummary.posterLocations, ["Audit Main", "Audit Satellite"]) &&
    sameStringSet(settingsEditSummary.posterNotes, ["Audit note one", "Audit note two"]) &&
    settingsEditSummary.attendingNames.includes(SETTINGS_EDIT_ATTENDING) &&
    !settingsEditSummary.attendingNames.includes("Legacy Attending") &&
    settingsEditSummary.auditRecurringClinicId === "audit-monday-am" &&
    settingsEditSummary.auditOneOffClinicId === "audit-oneoff" &&
    settingsEditSummary.expectedSourcePrograms.includes(SETTINGS_EDIT_EXPECTED_SOURCE) &&
    !settingsEditSummary.expectedSourcePrograms.includes(SETTINGS_EDIT_REMOVED_SOURCE);
  results.push(
    result(
      "T-SCH-NATIVE-UI-026",
      settingsEditProbeMatches ? "PASS" : "FAIL",
      `Settings edit probe block="${settingsEditSummary.blockId || "missing"}" coverage=${settingsEditSummary.weekdayCoverage}/${settingsEditSummary.saturdayCoverage}/${settingsEditSummary.sundayCoverage}/${settingsEditSummary.holidayCoverage} attending="${settingsEditSummary.attendingNames.join(" / ") || "missing"}" expectedSources="${settingsEditSummary.expectedSourcePrograms.join(" / ") || "missing"}".`,
      settingsEditProbe ? settingsEditProbePath : "",
    ),
  );

  const settingsEditState = await readSchedulerState();
  const settingsEditBlock = (settingsEditState?.serviceBlocks ?? []).find((block) => block.id === SETTINGS_EDIT_BLOCK_ID);
  const settingsEditHoliday = (settingsEditBlock?.holidays ?? []).find((holiday) => holiday.date === SETTINGS_EDIT_HOLIDAY_DATE);
  const settingsEditRules = settingsEditState?.rules ?? {};
  const settingsEditPoster = settingsEditState?.posterSettings ?? {};
  const settingsEditPosterLocations = (settingsEditPoster.locations ?? []).map((location) => location.name).sort();
  const settingsEditAttending = (settingsEditState?.attendings ?? []).find((attending) => attending.name === SETTINGS_EDIT_ATTENDING);
  const settingsEditRecurring = (settingsEditAttending?.recurringClinics ?? [])[0] ?? {};
  const settingsEditOneOff = (settingsEditAttending?.oneOffDates ?? [])[0] ?? {};
  const settingsEditExpected = settingsEditState?.expectedSourcePrograms ?? [];
  const settingsEditStateMatches =
    settingsEditState?.activeBlockId === SETTINGS_EDIT_BLOCK_ID &&
    settingsEditBlock?.name === SETTINGS_EDIT_BLOCK_NAME &&
    settingsEditBlock?.status === "Review" &&
    settingsEditBlock?.coverage?.weekday?.ip?.count === 3 &&
    settingsEditBlock?.coverage?.saturday?.ip?.count === 1 &&
    settingsEditBlock?.coverage?.sunday?.ip?.count === 0 &&
    settingsEditBlock?.coverage?.holiday?.ip?.count === 2 &&
    settingsEditHoliday?.label === "Audit Holiday" &&
    settingsEditHoliday?.noClinic === true &&
    settingsEditRules.maxConsecutiveInpatientDays === 4 &&
    settingsEditRules.honorNoClinicHolidays === false &&
    settingsEditPoster.programName === "Audit Pediatric Neurology" &&
    settingsEditPoster.chief === "Dr. Audit" &&
    settingsEditPoster.tagline === "Audit ready" &&
    sameStringSet(settingsEditPoster.notes ?? [], ["Audit note one", "Audit note two"]) &&
    sameStringSet(settingsEditPosterLocations, ["Audit Main", "Audit Satellite"]) &&
    settingsEditAttending?.name === SETTINGS_EDIT_ATTENDING &&
    settingsEditRecurring.id === "audit-monday-am" &&
    settingsEditRecurring.weekday === "Monday" &&
    (settingsEditRecurring.session ?? settingsEditRecurring.period) === "AM" &&
    settingsEditRecurring.clinicName === "Audit Clinic" &&
    settingsEditRecurring.capacity === 3 &&
    settingsEditRecurring.active === true &&
    settingsEditOneOff.id === "audit-oneoff" &&
    settingsEditOneOff.date === "2027-03-10" &&
    (settingsEditOneOff.session ?? settingsEditOneOff.period) === "PM" &&
    settingsEditOneOff.clinicName === "Audit Follow-up" &&
    settingsEditOneOff.capacity === 1 &&
    !(settingsEditState?.attendings ?? []).some((attending) => attending.name === "Legacy Attending") &&
    settingsEditExpected.includes(SETTINGS_EDIT_EXPECTED_SOURCE) &&
    !settingsEditExpected.includes(SETTINGS_EDIT_REMOVED_SOURCE);
  results.push(
    result(
      "T-SCH-NATIVE-UI-027",
      settingsEditStateMatches ? "PASS" : "FAIL",
      `/api/scheduler/state shows Settings persisted block/rules/poster/attending/source edits for ${settingsEditBlock?.name || "missing"}.`,
    ),
  );

  const artifacts = writeArtifacts({
    resultsDir,
    runStamp,
    results,
    runtime,
    buildLogPath,
    reportsBuildLogPath,
    dashboardDraftBuildLogPath,
    methodistAutoBuildLogPath,
    planningEditBuildLogPath,
    planningAxBuildLogPath,
    sourcesImportBuildLogPath,
    rotatorsEditBuildLogPath,
    outpatientEditBuildLogPath,
    inpatientEditBuildLogPath,
    clinicsEditBuildLogPath,
    fellowsResolveBuildLogPath,
    settingsEditBuildLogPath,
    seedLogPath,
    reportsSeedLogPath,
    dashboardDraftSeedLogPath,
    methodistAutoSeedLogPath,
    planningEditSeedLogPath,
    planningAxSeedLogPath,
    sourcesImportSeedLogPath,
    rotatorsEditSeedLogPath,
    outpatientEditSeedLogPath,
    inpatientEditSeedLogPath,
    clinicsEditSeedLogPath,
    fellowsResolveSeedLogPath,
    settingsEditSeedLogPath,
    dataDir,
    reportsDataDir,
    dashboardDraftDataDir,
    methodistAutoDataDir,
    planningEditDataDir,
    planningAxDataDir,
    sourcesImportDataDir,
    rotatorsEditDataDir,
    outpatientEditDataDir,
    inpatientEditDataDir,
    clinicsEditDataDir,
    fellowsResolveDataDir,
    settingsEditDataDir,
    windowProbe,
    screenProbe,
    planningProbe,
    reportsProbe,
    dashboardDraftProbe,
    methodistAutoProbe,
    planningEditProbe,
    planningAxInteraction,
    sourcesImportProbe,
    rotatorsEditProbe,
    outpatientEditProbe,
    inpatientEditProbe,
    clinicsEditProbe,
    fellowsResolveProbe,
    settingsEditProbe,
    schedulerState,
    gridShow,
  });
  console.log(`Wrote ${artifacts.mdPath}`);
  console.log(`Wrote ${artifacts.jsonPath}`);

  process.exitCode = results.some((item) => item.status === "FAIL") ? 1 : 0;
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
