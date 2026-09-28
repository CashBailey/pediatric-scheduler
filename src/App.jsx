import {
  Activity,
  AlertTriangle,
  Archive,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  Download,
  FileDown,
  FileText,
  FileUp,
  GraduationCap,
  Hash,
  Home,
  LayoutGrid,
  ListChecks,
  Moon,
  RotateCcw,
  Undo2,
  Redo2,
  Save,
  Settings,
  ShieldCheck,
  Stethoscope,
  Sun,
  Upload,
  UserCog,
  Users
} from "lucide-react";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DragDropProvider, useDraggable, useDroppable, useDragOperation } from "@dnd-kit/react";
import {
  PAGES,
  PROGRAMS,
  activeBlock,
  activeRotatorsOn,
  addSource,
  applyImportedRoster,
  applyPreassignments,
  applyRangeAssignment,
  assessRangeAssignment,
  attendingsAvailableOn,
  buildExportPackage,
  buildPlanningGrid,
  coverageForDate,
  defaultCoverageCount,
  setBlockCoverage,
  suggestCoverageFromGrid,
  continuityClinicsForDate,
  clampDateToBlock,
  dateRange,
  extendBlockEnd,
  extendBlockStart,
  dedupeRotatorsByName,
  detectConflicts,
  expandRotatorDatesInBlock,
  applyDrop,
  focusTargetForConflict,
  validateDrop,
  generateDailyReport,
  generateExportManifest,
  generateLegend,
  getRotator,
  getRotatorSegmentPhase,
  groupedRoster,
  isPediatricNeurologyFellow,
  isRotatorUnavailable,
  migrateLoadedState,
  parseState,
  previewRangeAssignment,
  parseContinuityClinicSlots,
  formatContinuityClinicSlots,
  removeRotator,
  removeRotators,
  removeSource,
  removeServiceBlock,
  scheduleOutpatientSession,
  serializeState,
  setAttendings,
  setExpectedSourcePrograms,
  updateBlock,
  updateRotator,
  weekdayName,
  WEEKDAYS
} from "../shared/scheduler/scheduler.js";
import { executeSchedulerCommand } from "../shared/scheduler/commands.js";
import { generateDraft } from "../shared/scheduler/program-rules.js";
import {
  applyColumnMapping,
  BROWSER_EXCEL_ACCEPT,
  BROWSER_EXCEL_DESCRIPTION,
  BROWSER_EXCEL_EXTENSIONS,
  buildTemplateWorkbook,
  inferProgramFromSourceText,
  mergeRotators,
  parseRosterFromArrayBuffer
} from "../shared/scheduler/excel-import.js";
import { initialPaintState, paintReducer, selectionToContiguousRuns } from "../shared/scheduler/paint-selection.js";
import { outpatientDetailsForSession } from "../shared/scheduler/outpatient-details.js";
import { buildInpatientPdf, buildOutpatientPdf, buildSchedulePdf } from "./pdfExport.js";
import {
  hydrateFromBackend,
  isBackendStateAuthoritative,
  loadSchedulerState,
  resetSchedulerState,
  saveSchedulerState
} from "./storage.js";
import {
  classifyAssignmentRole,
  classifySession,
  groupPlanningRowsBySection,
  inpatientDayData,
  outpatientDayData,
  parseClinicMeta,
  preferenceVsActualSummary,
  rotatorsActiveInBlock
} from "../shared/scheduler/derived-views.js";
import { InpatientSchedule } from "./components/inpatient/InpatientSchedule.jsx";
import { ClinicsView } from "./components/clinics/ClinicsView.jsx";
import { OutpatientSchedule } from "./components/outpatient/OutpatientSchedule.jsx";

const pageIcons = {
  Dashboard: Home,
  Configuration: Save,
  Rotators: Users,
  Sources: FileUp,
  Attendings: UserCog,
  Fellows: GraduationCap,
  Clinics: Building2,
  "Planning Grid": LayoutGrid,
  "Inpatient Schedule": Activity,
  "Outpatient Schedule": ClipboardList,
  Reports: FileText,
  Settings: Settings
};

// Mon–Fri labels for the continuity-clinic stereo-button grid (#1). Continuity
// clinics are weekday half-days, so we slice the weekend off the canonical
// WEEKDAYS array (which is Sunday-first, Saturday-last).
const CONTINUITY_WEEKDAYS = WEEKDAYS.slice(1, 6);
const CONTINUITY_PERIODS = ["AM", "PM"];

// Real local calendar date as YYYY-MM-DD (not UTC — matches the app's
// local-date convention so the picker never lands on the wrong calendar day).
// Was previously hardcoded to a frozen "2026-05-11" stub.
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function updateStateFromCommand(state, updateState, command, messageOverride = null) {
  const result = executeSchedulerCommand(state, command);
  if (!result.ok) {
    updateState(state, result.error.message);
    return result;
  }
  updateState(result.state, messageOverride || result.message);
  return result;
}

// U3 — bounded undo/redo history, as pure helpers so the reducer-ish logic is
// unit-tested in isolation and the updater stays pure (StrictMode double-invokes
// updaters; impure history mutation inside one would corrupt the stack). History
// holds REFERENCES to past immutable state objects (cheap — structural sharing),
// is in-memory only, and never touches localStorage.
export const MAX_UNDO_HISTORY = 50;

export function recordUndo(history, current, next, max = MAX_UNDO_HISTORY) {
  if (next === current) return history; // no-op change → no history entry
  const past = [...history.past, current];
  if (past.length > max) past.shift();
  return { past, future: [] }; // a fresh change invalidates the redo stack
}

export function applyUndo(history, current) {
  if (history.past.length === 0) return null;
  const prev = history.past[history.past.length - 1];
  return {
    state: prev,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] }
  };
}

export function applyRedo(history, current) {
  if (history.future.length === 0) return null;
  const [next, ...future] = history.future;
  return { state: next, history: { past: [...history.past, current], future } };
}

export function App() {
  const [state, setState] = useState(() => loadSchedulerState());

  // U3 — undo/redo. `stateRef` mirrors the latest state so updateState computes
  // `next` and records history OUTSIDE the setState updater (keeps updaters pure
  // for StrictMode). `historyRef` mirrors the history for the global keydown
  // handler (captured once, must read the live stacks).
  const stateRef = useRef(state);
  const [history, setHistory] = useState({ past: [], future: [] });
  const historyRef = useRef(history);

  // Phase 8.1: on first mount, try to hydrate state from the local
  // backend's JSON file. If the backend has user data (any rotators
  // / assignments / sessions or more than the default block), adopt
  // it as the source of truth — recovers from a localStorage clear
  // or browser profile reset. Otherwise leave the localStorage-
  // derived initial state alone.
  useEffect(() => {
    let cancelled = false;
    hydrateFromBackend().then((backendState) => {
      if (cancelled) return;
      if (!isBackendStateAuthoritative(backendState)) return;
      setState(migrateLoadedState(backendState));
    });
    return () => { cancelled = true; };
  }, []);

  const [page, setPage] = useState("Dashboard");
  const [theme, setTheme] = useState(() => localStorage.getItem("pedi-theme") || "dark");
  const [notice, setNotice] = useState("Saved in app data.");

  useEffect(() => {
    saveSchedulerState(state);
  }, [state]);

  // Keep the refs in lockstep with the latest values for paths that bypass
  // updateState (backend hydrate, the preassignments effect, undo/redo itself).
  useEffect(() => { stateRef.current = state; });
  useEffect(() => { historyRef.current = history; });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pedi-theme", theme);
  }, [theme]);

  // U3 — global Ctrl/⌘+Z (undo) and Ctrl/⌘+Shift+Z / Ctrl+Y (redo). Skipped
  // inside editable fields so native text undo still works, and preventDefault
  // so the browser's own undo doesn't also fire.
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const block = activeBlock(state);
  const conflicts = useMemo(() => detectConflicts(state), [state]);
  const manifest = useMemo(() => generateExportManifest(state), [state]);

  // Auto-apply per-segment pre-assignments whenever the active block
  // OR the rotators array changes. Coordinator wants IP/OP pre-assignments
  // set on the rotator profile to show up immediately in the planning
  // grid without re-opening the block. Idempotent: applyPreassignments
  // returns the same state reference when no new records would be added
  // and doesn't touch state.rotators, so this effect doesn't loop.
  // Include block.startDate/endDate in the deps so editing the block
  // window (which keeps the same block.id) still triggers a re-apply for
  // any newly-covered weekdays.
  useEffect(() => {
    if (!block) return;
    setState((current) => applyPreassignments(current, activeBlock(current)));
  }, [block?.id, block?.startDate, block?.endDate, state.rotators]);

  function updateState(nextStateOrUpdater, message) {
    // Single mutation funnel. Compute `next` from the synced ref so undo history
    // is recorded OUTSIDE the setState updater (pure updater → StrictMode-safe).
    // The functional form still works for async callbacks (FileReader.onload,
    // setTimeout) — stateRef is kept in lockstep so even rapid successive calls
    // see the latest state, not a stale closure.
    const current = stateRef.current;
    const next = typeof nextStateOrUpdater === "function" ? nextStateOrUpdater(current) : nextStateOrUpdater;
    if (next !== current) {
      setHistory((h) => recordUndo(h, current, next));
    }
    stateRef.current = next;
    setState(next);
    // When message is undefined, keep the previous notice — used by
    // text-field keystrokes that shouldn't spam a new toast per character.
    if (message !== undefined) setNotice(message);
  }

  function undo() {
    const result = applyUndo(historyRef.current, stateRef.current);
    if (!result) { setNotice("Nothing to undo."); return; }
    historyRef.current = result.history;
    stateRef.current = result.state;
    setHistory(result.history);
    setState(result.state);
    setNotice("Undid the last change. (Ctrl+Shift+Z to redo)");
  }

  function redo() {
    const result = applyRedo(historyRef.current, stateRef.current);
    if (!result) { setNotice("Nothing to redo."); return; }
    historyRef.current = result.history;
    stateRef.current = result.state;
    setHistory(result.history);
    setState(result.state);
    setNotice("Redid the change.");
  }

  function importStateFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = parseState(String(reader.result));
        updateState(next, `Restored backup from ${file.name}.`);
      } catch (error) {
        setNotice(error.message);
      }
    };
    reader.readAsText(file);
  }

  function exportStateFile() {
    downloadText("pedi-scheduler-backup.json", serializeState(state), "application/json");
    setNotice("Backup saved to your Downloads folder.");
  }

  function resetState() {
    const next = resetSchedulerState();
    updateState(next, "Reset to demo data.");
  }

  // 2026-05-28 redesign: each top-level workflow stage routes to its own page.
  // Planning Grid is the service-level construction tool (PlanningGridPage
  // directly, no longer the CombinedPlanningPage tab container). Inpatient/
  // Outpatient Schedule are read-only projections; Clinics owns clinic
  // placement. Reports/Settings consolidate the legacy utility pages.
  const PageComponent = {
    Dashboard: DashboardPage,
    Configuration: ConfigurationPage,
    Rotators: RosterPage,
    Sources: SourcesPage,
    Attendings: AttendingsPage,
    Fellows: FellowsPage,
    Clinics: ClinicsPage,
    "Planning Grid": PlanningGridPage,
    "Inpatient Schedule": InpatientSchedulePage,
    "Outpatient Schedule": OutpatientSchedulePage,
    Reports: ReportsPage,
    Settings: SettingsPage
  }[page];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Scheduler navigation">
        <div className="brand">
          <div className="brand-mark">PN</div>
          <div>
            <strong>Pediatric Neurology</strong>
            <span>Local Scheduler</span>
          </div>
        </div>
        <nav className="nav-list">
          {/* 2026-05-28 redesign: Inpatient Schedule and Outpatient Schedule
              are now first-class top-level destinations (read-only projections),
              not tabs hidden inside the planning view, so the sidebar renders
              every entry in PAGES directly. */}
          {PAGES.map((label) => {
            const Icon = pageIcons[label];
            return (
              <button
                key={label}
                className={page === label ? "nav-item active" : "nav-item"}
                onClick={() => setPage(label)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="local-badge">
          <ShieldCheck size={18} />
          <span>No off-machine runtime calls</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <BlockSwitcher state={state} updateState={updateState} />
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={undo}
              disabled={history.past.length === 0}
              title="Undo (Ctrl+Z)"
              aria-label="Undo last change"
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon-button"
              onClick={redo}
              disabled={history.future.length === 0}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo change"
            >
              <Redo2 size={18} />
            </button>
            <label className="file-button" title="Load a previously saved backup of this app's data">
              <Upload size={17} />
              Restore backup
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => importStateFromFile(event.target.files?.[0])}
              />
            </label>
            <button className="icon-button" onClick={exportStateFile} title="Save a backup of this app's data">
              <Download size={18} />
            </button>
            <button className="icon-button" onClick={resetState} title="Reset demo data">
              <RotateCcw size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <section className="notice" role="status">
          <Database size={18} />
          <span>{notice}</span>
        </section>

        <PageComponent
          state={state}
          block={block}
          conflicts={conflicts}
          manifest={manifest}
          setNotice={setNotice}
          updateState={updateState}
          setPage={setPage}
          page={page}
        />
      </main>
    </div>
  );
}

function DashboardPage({ state, block, conflicts, manifest, setPage }) {
  const inpatientDays = new Set(state.inpatientAssignments.map((item) => item.date)).size;
  const outpatientDays = new Set(state.outpatientSessions.map((item) => item.date)).size;
  const expected = state.expectedSourcePrograms || [];
  const submittedPrograms = new Set((state.sources || []).map((s) => s.program));
  const missingPrograms = expected.filter((p) => !submittedPrograms.has(p));
  const manifestFileNames = new Set((manifest.files || []).map((file) => file.name));
  const exportReady = [
    "manifest.json",
    "roster.json",
    "roster.csv",
    "inpatient-calendar.json",
    "inpatient-calendar.csv",
    "outpatient-calendar.json",
    "outpatient-calendar.csv",
    "daily-reports.txt",
    "legend.json",
    "legend.csv",
    "conflicts.json",
    "conflicts.csv",
    "source-import-summary.json",
    "source-import-summary.csv",
    "schedule-package.json"
  ].every((name) => manifestFileNames.has(name));

  return (
    <div className="page-grid dashboard-grid">
      <Metric label="Service block" value={formatDateRange(block.startDate, block.endDate)} detail={block.status} />
      <Metric label="Rotators" value={state.rotators.length} detail={`${groupedRoster(state).length} programs`} />
      <Metric
        label="Sources"
        value={state.sources.length}
        detail={expected.length === 0
          ? "Local files reviewed"
          : missingPrograms.length === 0
            ? "All expected sources in"
            : `Waiting on ${missingPrograms.length} of ${expected.length}`}
      />
      <Metric
        label="Open conflicts"
        value={conflicts.length}
        tone={conflicts.length > 0 ? "metric-alert" : undefined}
        detail={conflicts.length ? "Needs review" : "Clear"}
      />

      <section className="panel wide">
        <h2>How scheduling works</h2>
        <ol className="workflow-steps">
          <li>
            <strong>Import the schedule data.</strong> Upload each program's roster on the{" "}
            <button type="button" className="link-button" onClick={() => setPage?.("Sources")}>
              Sources
            </button>{" "}
            page.
          </li>
          <li>
            <strong>Enter any requested days off or other constraints.</strong> Set each
            rotator's availability and preferences on the Rotators page.
          </li>
          <li>
            <strong>Generate a draft schedule.</strong> The scheduler splits each rotator's
            block into inpatient and outpatient service.
          </li>
          <li>
            <strong>Review and finalize.</strong> Resolve any flagged conflicts in the Planning
            Grid, then finalize the schedule.
          </li>
        </ol>
      </section>

      <section className="panel wide">
        <h2>Schedule Pipeline</h2>
        <div className="pipeline">
          <Step done={Boolean(block)} label="Block" />
          <Step done={state.rotators.length > 0} label="Roster" />
          <Step done={inpatientDays > 0} label="Inpatient" />
          <Step done={outpatientDays > 0} label="Outpatient" />
          <Step done={conflicts.length === 0} label="Conflicts" />
          <Step done={exportReady} label="Export" />
        </div>
      </section>

      <section className="panel">
        <h2>Adult Neuro AY Log</h2>
        <div className="dense-list">
          {(() => {
            const adultNeuro = state.rotators.filter(
              (rotator) => rotator.program.includes("Adult") || rotator.program === "Methodist"
            );
            if (adultNeuro.length === 0) {
              return <p className="empty-note">No Adult Neuro or Methodist rotators in the roster yet.</p>;
            }
            return adultNeuro.map((rotator) => (
              <div key={rotator.id} className="list-row">
                <strong>{rotator.displayName}</strong>
                <span>{rotator.program} · {formatRotatorDates(rotator)}</span>
              </div>
            ));
          })()}
        </div>
      </section>

      <section className="panel">
        <h2>Export Readiness</h2>
        <div className="manifest-list">
          {manifest.files.map((file) => (
            <div key={file.name}>
              <span>{file.label ?? file.name}</span>
              <strong>{file.rows}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function BlockSwitcher({ state, updateState }) {
  const current = activeBlock(state);
  const blocks = state.serviceBlocks || [];

  function onChange(event) {
    const value = event.target.value;
    if (value === "__new__") {
      const result = executeSchedulerCommand(state, { type: "block.add" });
      if (!result.ok) {
        updateState(state, result.error.message);
        return;
      }
      const newBlock = result.ok ? result.state.serviceBlocks.at(-1) : null;
      if (newBlock) updateState(result.state, `Created new block "${newBlock.name}" and switched to it.`);
      return;
    }
    if (value === current.id) return;
    const target = blocks.find((b) => b.id === value);
    updateStateFromCommand(state, updateState, { type: "block.use", input: { blockRef: value } }, `Switched to ${target?.name || "block"}.`);
  }

  return (
    <label className="block-switcher" title="Switch between rotation blocks, or add a new one">
      <span className="eyebrow">Block</span>
      <select value={current?.id || ""} onChange={onChange}>
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value="__new__">+ New block…</option>
      </select>
    </label>
  );
}

// Compare two block objects by serialized content. Used by the
// BlockSetupPage dirty-state guard to decide whether the user has
// unsaved edits relative to what's persisted. JSON stringify is fine
// here — blocks are small flat-ish records (holidays is the only
// nested array) and we don't need cycle handling.
function shallowBlockEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function BlockSetupPage({ state, block, updateState }) {
  const [draft, setDraft] = useState(block);
  // Track which block id the draft is currently mirroring, so a re-
  // render driven by something other than a block switch (e.g., the
  // user typing into a field) doesn't wipe the draft. We only sync the
  // draft when block.id actually changes.
  const syncedBlockIdRef = useRef(block?.id);
  // Hold the latest draft in a ref so the sync effect can read it for the
  // dirty-check WITHOUT listing `draft` as a dependency. Listing `draft`
  // made the effect re-run on every keystroke and immediately revert the
  // edit (the matching-id branch used to call setDraft(block)); name/date
  // fields became uneditable as a result.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!block) return;
    if (syncedBlockIdRef.current === block.id) {
      // Same block id, new `block` reference (a saveBlock() round-trip or
      // an unrelated state change such as the live coverage controls). Do
      // NOT re-sync — that would clobber the user's unsaved edits. The
      // draft already holds the latest content the user has typed.
      return;
    }
    // A real block switch (id changed). If the draft has unsaved edits
    // relative to the previously-synced block, confirm before discarding.
    const prevId = syncedBlockIdRef.current;
    const prevPersisted = (state.serviceBlocks || []).find((b) => b.id === prevId);
    const dirty = prevPersisted ? !shallowBlockEquals(draftRef.current, prevPersisted) : false;
    if (dirty) {
      const ok = window.confirm(
        `You have unsaved changes to "${prevPersisted?.name || "the previous block"}". Switch anyway and discard them?`
      );
      if (!ok) return; // stay on the previous block; keep the dirty draft
    }
    setDraft(block);
    syncedBlockIdRef.current = block.id;
  }, [block, state.serviceBlocks]);

  function saveBlock(event) {
    event.preventDefault();
    // Save the draft-managed fields (name/status/dates/generate), but keep
    // `coverage` from the live block — coverage is edited separately and
    // direct-to-state, so the draft's copy can be stale.
    updateState(updateBlock(state, { ...draft, coverage: block.coverage }), "Service block saved in app data.");
  }

  function addBlock() {
    const result = executeSchedulerCommand(state, { type: "block.add" });
    if (!result.ok) {
      updateState(state, result.error.message);
      return;
    }
    const newBlock = result.state.serviceBlocks.at(-1);
    updateState(result.state, `Created new block "${newBlock.name}" and switched to it.`);
  }

  // Coverage demand (auto-draft, piece 1 of 4). Reads/writes the
  // per-day-type inpatient headcount on the ACTIVE block. When unset, the form
  // shows the SAME default the engine enforces (defaultCoverageCount) so the
  // displayed number never drifts from what actually flags gaps — post-Coordinator
  // #6 that's at least two every day, weekends and holidays included.
  //
  // Writes go straight to global state via updateState(setBlockCoverage(...)),
  // NOT through the `draft` used by the name/date fields above: the draft
  // sync effect re-mirrors `block` whenever `draft` changes, which would
  // revert an in-progress coverage edit. Going direct (like the rotator
  // inline edits elsewhere) sidesteps that and saves immediately.
  const covCount = (dayType) => {
    const v = block.coverage?.[dayType]?.ip?.count;
    return Number.isFinite(v) ? v : defaultCoverageCount(dayType);
  };
  const setCov = (dayType, raw) => {
    const count = Math.max(0, Math.floor(Number(raw) || 0));
    const nextCoverage = {
      ...(block.coverage || {}),
      [dayType]: { ...(block.coverage?.[dayType] || {}), ip: { ...(block.coverage?.[dayType]?.ip || {}), count } }
    };
    updateState(setBlockCoverage(state, block.id, nextCoverage), "Coverage demand saved in app data.");
  };
  const prefillCoverage = () =>
    updateState(setBlockCoverage(state, block.id, suggestCoverageFromGrid(state, block)), "Coverage demand pre-filled from this block's schedule.");

  return (
    <form className="block-setup" onSubmit={saveBlock}>
      <section className="panel full">
        <h2>All Blocks</h2>
        <p className="muted">Switch between rotation blocks here. Each block has its own dates, holidays, and calendar — but the provider roster is shared across all of them.</p>
        <div className="dense-list">
          {(state.serviceBlocks || []).map((b) => (
            <div key={b.id} className="list-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <strong>{b.name}</strong>
                <span>{b.startDate} to {b.endDate} · {b.status}</span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {b.id === state.activeBlockId ? (
                  <span className="muted">Active</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => updateStateFromCommand(
                      state,
                      updateState,
                      { type: "block.use", input: { blockRef: b.id } },
                      `Switched to ${b.name}.`
                    )}
                  >
                    Switch to this block
                  </button>
                )}
                {(state.serviceBlocks || []).length > 1 && (
                  <button
                    type="button"
                    className="link-button"
                    title="Delete this block. The provider roster and any assignments stay; they'll show up again under any future block covering the same dates."
                    onClick={() => {
                      const ok = window.confirm(`Delete the block "${b.name}" (${b.startDate} to ${b.endDate})? The provider roster and any assignments stay on file.`);
                      if (!ok) return;
                      const result = removeServiceBlock(state, b.id);
                      if (result.ok) {
                        updateState(result.state, `Deleted block "${b.name}".`);
                      } else {
                        updateState(state, result.reason);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="action-bar" style={{ marginTop: "12px" }}>
          <button type="button" className="secondary-button" onClick={addBlock}>
            + Add a new block
          </button>
        </div>
      </section>
      <div className="block-setup-cols">
        <div className="block-setup-col">
          <section className="panel">
            <h2>Block Details — {draft.name}</h2>
            <div className="form-grid">
              <TextField label="Block name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
              <TextField label="Status" value={draft.status} onChange={(status) => setDraft({ ...draft, status })} />
              <TextField label="Start date" type="date" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} />
              <TextField label="End date" type="date" value={draft.endDate} onChange={(endDate) => setDraft({ ...draft, endDate })} />
            </div>
          </section>
          <section className="panel">
            <h2>Calendars To Generate</h2>
            {Object.entries(draft.generate).map(([key, value]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) =>
                    setDraft({ ...draft, generate: { ...draft.generate, [key]: event.target.checked } })
                  }
                />
                <span>{labelize(key)}</span>
              </label>
            ))}
          </section>
        </div>
        <div className="block-setup-col">
          <section className="panel">
            <h2>Coverage Demand</h2>
            <p className="muted">
              How many residents inpatient coverage needs each day — saved as you type. The "Generate draft
              schedule" tool fills to these numbers, and any short day is flagged on the Conflicts page.
              Defaults match the previous behavior (weekdays need 1, weekends and holidays 0) until you change them.
            </p>
            <div className="form-grid">
              {[["weekday", "Weekday"], ["saturday", "Saturday"], ["sunday", "Sunday"], ["holiday", "Holiday"]].map(([key, label]) => (
                <label key={key}>
                  {label} — inpatient bodies
                  <input type="number" min="0" step="1" value={covCount(key)} onChange={(event) => setCov(key, event.target.value)} />
                </label>
              ))}
            </div>
            <div className="action-bar" style={{ marginTop: "12px" }}>
              <button type="button" className="secondary-button" onClick={prefillCoverage}>
                Pre-fill from this block's current schedule
              </button>
            </div>
          </section>
          <section className="panel">
            <h2>Holidays</h2>
            <div className="dense-list">
              {draft.holidays.length === 0 ? (
                <p className="empty-note">No holidays added for this block.</p>
              ) : (
                draft.holidays.map((holiday) => (
                  <div key={holiday.date} className="list-row">
                    <strong>{holiday.label}</strong>
                    <span>{holiday.date} · {holiday.noClinic ? "No clinic" : "Clinic allowed"}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      <div className="action-bar wide">
        <button className="primary-button" type="submit">
          <Save size={18} />
          Save block
        </button>
      </div>
    </form>
  );
}

function sourceProgramFromRows(rows, fileName, fallbackProgram) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const program = row?.program;
    if (program && program !== "Other") {
      counts.set(program, (counts.get(program) || 0) + 1);
    }
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  return inferProgramFromSourceText(fileName, fallbackProgram || "Other");
}

function SourcesPage({ state, updateState, setNotice }) {
  const [program, setProgram] = useState(PROGRAMS[0]);
  const [openSourceId, setOpenSourceId] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [replacingSourceId, setReplacingSourceId] = useState(null);
  const [importingCoordinatorDocx, setImportingCoordinatorDocx] = useState(false);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  function startReplace(sourceId) {
    setReplacingSourceId(sourceId);
    replaceInputRef.current?.click();
  }

  function addUploadedFile(file) {
    if (!file) {
      updateState(
        addSource(state, {
          program,
          fileName: "Manual source",
          fileType: "manual",
          content: "",
          parsedRows: []
        }),
        "Added Manual source to source review."
      );
      return;
    }
    const fileName = file.name;
    const fileType = (fileName.split(".").pop() || "manual").toLowerCase();

    if (BROWSER_EXCEL_EXTENSIONS.includes(`.${fileType}`)) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const buffer = reader.result;
          const replaceTarget = replacingSourceId
            ? state.sources.find((s) => s.id === replacingSourceId)
            : null;
          const fallbackProgram = replaceTarget?.program || program;
          const parsed = await parseRosterFromArrayBuffer(buffer, {
            fileName,
            sourceLabel: fileName,
            defaultProgram: fallbackProgram
          });
          const sourceProgram = sourceProgramFromRows(parsed.rows, fileName, fallbackProgram);
          setPendingImport({
            fileName,
            fileType,
            program: sourceProgram,
            fallbackProgram,
            rows: parsed.rows,
            warnings: parsed.warnings,
            replaceSourceId: replacingSourceId,
            // New fields powering the column-mapping UI. Both parse
            // branches stashed so the layout-override toggle can flip
            // between them without re-reading the file.
            isMatrix: parsed.isMatrix,
            templateParse: parsed.templateParse,
            matrixParse: parsed.matrixParse
          });
          setReplacingSourceId(null);
          const verb = replaceTarget ? "Replacing" : "Found";
          setNotice(`${verb} ${replaceTarget ? `${replaceTarget.fileName} with ` : ""}${fileName}: ${parsed.rows.length} rotator${parsed.rows.length === 1 ? "" : "s"} found. Choose how to add them.`);
        } catch (error) {
          setReplacingSourceId(null);
          setNotice(error.message || "We couldn't read this file. Please check the column headers match the template.");
        }
      };
      reader.onerror = () => {
        setNotice("We couldn't read that file. Please try uploading it again.");
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    // Functional-update form: state could have moved on by the time
    // the async FileReader.onload fires (another effect ran, the user
    // clicked something), so reading `state` from this closure would
    // clobber any intervening changes. updateState forwards a function
    // to setState's updater form.
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      updateState(
        (current) => addSource(current, {
          program,
          fileName,
          fileType,
          content: text,
          parsedRows: []
        }),
        `Added ${fileName} to source review.`
      );
    };
    reader.onerror = () => {
      updateState(
        (current) => addSource(current, {
          program,
          fileName,
          fileType,
          content: "",
          parsedRows: []
        }),
        `Added ${fileName} (contents could not be read).`
      );
    };
    reader.readAsText(file);
  }

  function commitImport(mode, options = {}) {
    if (!pendingImport) return;
    // Template path uses the user-chosen mapping to re-derive rows;
    // matrix path uses the pre-parsed matrix rows (no mapping needed).
    let importRows = pendingImport.rows;
    if (options.layoutMode === "template" && options.userMapping && pendingImport.templateParse) {
      const tp = pendingImport.templateParse;
      const remap = applyColumnMapping(tp.headers, tp.dataRows, options.userMapping, {
        headerRowIndex: tp.headerRowIndex,
        fileName: pendingImport.fileName,
        sourceLabel: pendingImport.fileName,
        defaultProgram: pendingImport.fallbackProgram || pendingImport.program
      });
      importRows = remap.rows;
    } else if (options.layoutMode === "matrix" && pendingImport.matrixParse) {
      importRows = pendingImport.matrixParse.rows;
    }
    const merged = mergeRotators(state.rotators, importRows, mode);
    const next = applyImportedRoster(
      state,
      { ...merged, parsedRows: importRows.map(rotatorPreviewRow) },
      {
        program: sourceProgramFromRows(importRows, pendingImport.fileName, pendingImport.program),
        fileName: pendingImport.fileName,
        fileType: pendingImport.fileType,
        replaceSourceId: pendingImport.replaceSourceId
      }
    );
    const parts = [];
    if (merged.added) parts.push(`added ${merged.added}`);
    if (merged.updated) parts.push(`updated ${merged.updated}`);
    if (merged.removed) parts.push(`removed ${merged.removed} previous`);
    const summary = parts.length ? parts.join(", ") : "no changes";
    const verb = pendingImport.replaceSourceId ? "Replaced" : "Imported";
    updateState(next, `${verb} ${pendingImport.fileName}: ${summary}.`);
    setPendingImport(null);
  }

  async function importCoordinatorDocxBundle() {
    const ok = window.confirm(
      "Import the latest complete Coordinator DOCX bundle from Downloads? This replaces the current schedule data, while keeping your attending and settings configuration."
    );
    if (!ok) return;
    setImportingCoordinatorDocx(true);
    try {
      const response = await fetch("/api/import/coordinator-docx/default", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const missing = Array.isArray(payload.missing) && payload.missing.length
          ? ` Missing: ${payload.missing.join(", ")}`
          : "";
        throw new Error(`${payload.error || "Could not import the Coordinator DOCX bundle."}${missing}`);
      }
      const generated = payload.schedulerStatePreview;
      if (!generated) throw new Error("The Coordinator DOCX import did not return scheduler state.");
      const next = migrateLoadedState({
        ...generated,
        attendings: state.attendings,
        expectedSourcePrograms: state.expectedSourcePrograms,
        posterSettings: state.posterSettings,
        rules: { ...(generated.rules || {}), ...(state.rules || {}) }
      });
      const acceptance = payload.acceptance || {};
      const warnings = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
      const mismatchCount = payload.reconciliation?.mismatches ?? 0;
      const halfDayFacts = acceptance.halfDayFacts ?? generated.halfDayFacts?.length ?? 0;
      updateState(
        next,
        `Imported Coordinator DOCX bundle: ${acceptance.rotators ?? 0} rotators, ${acceptance.inpatientAssignments ?? 0} inpatient assignments, ${acceptance.outpatientSessions ?? 0} outpatient sessions, ${halfDayFacts} half-day facts. ${mismatchCount} reconciliation mismatches. ${warnings} warning${warnings === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setNotice(error.message || "Could not import the Coordinator DOCX bundle.");
    } finally {
      setImportingCoordinatorDocx(false);
    }
  }

  function downloadTemplate() {
    const buffer = buildTemplateWorkbook();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roster-template.xlsx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice("Roster template saved to your Downloads folder.");
  }

  const openSource = state.sources.find((source) => source.id === openSourceId) || null;

  return (
    <div className="page-flex">
      <section className="panel">
        <h2>Source Intake</h2>
        <div className="form-grid single">
          <label>
            Program
            <select value={program} onChange={(event) => setProgram(event.target.value)}>
              {PROGRAMS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={18} />
            Choose local file
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept={BROWSER_EXCEL_ACCEPT}
            onChange={(event) => {
              addUploadedFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <p className="muted">
            Upload an Excel roster ({BROWSER_EXCEL_DESCRIPTION}) and we will create a profile for each rotator
            automatically. Expected columns: Name, Program, Level, Start, End, Continuity Clinic,
            Day Off, Unavailable. Other formats are saved as-is for review.
          </p>
          <button className="link-button" type="button" onClick={downloadTemplate}>
            Download blank roster template
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={importCoordinatorDocxBundle}
            disabled={importingCoordinatorDocx}
          >
            <FileText size={18} />
            {importingCoordinatorDocx ? "Importing DOCX..." : "Import Coordinator DOCX bundle"}
          </button>
        </div>
      </section>
      <section className="panel wide">
        <h2>Reviewed Sources</h2>
        <p className="muted">Click a row to open the file and review what was uploaded.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>File</th>
                <th>Status</th>
                <th>Imported</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.sources.length === 0 && (
                <tr>
                  <td className="table-empty" colSpan={5}>No sources imported yet — choose a file to get started.</td>
                </tr>
              )}
              {state.sources.map((source) => (
                <tr
                  key={source.id}
                  className="clickable-row"
                  onClick={() => setOpenSourceId(source.id)}
                >
                  <td>{source.program}</td>
                  <td>{source.fileName}</td>
                  <td>{source.status}</td>
                  <td>{source.importedAt}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenSourceId(source.id);
                      }}
                    >
                      Open
                    </button>
                    <span className="muted"> · </span>
                    <button
                      className="link-button"
                      title="Upload a new file to replace this one. Providers from the new file replace this source's record."
                      onClick={(event) => {
                        event.stopPropagation();
                        startReplace(source.id);
                      }}
                    >
                      Replace
                    </button>
                    <span className="muted"> · </span>
                    <button
                      className="link-button"
                      title="Remove this source's record. The providers already imported from it stay on the roster — clear those separately on the Who's On Pedi tab if you want a full reset."
                      onClick={(event) => {
                        event.stopPropagation();
                        const ok = window.confirm(
                          `Remove the source record for ${source.fileName}? Providers already imported from this file will stay on the roster — delete them on the Who's On Pedi tab if you also want a full reset.`
                        );
                        if (!ok) return;
                        updateState(removeSource(state, source.id), `Removed source ${source.fileName}.`);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <input
        ref={replaceInputRef}
        hidden
        type="file"
        accept={BROWSER_EXCEL_ACCEPT}
        onChange={(event) => {
          addUploadedFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {openSource && (
        <SourceViewer source={openSource} onClose={() => setOpenSourceId(null)} />
      )}
      {pendingImport && (
        <ImportConfirm
          key={`${pendingImport.fileName}:${pendingImport.fileType}`}
          pending={pendingImport}
          existingCount={state.rotators.length}
          existingRotators={state.rotators}
          onCancel={() => setPendingImport(null)}
          onConfirm={commitImport}
        />
      )}
    </div>
  );
}

function rotatorPreviewRow(rotator) {
  return {
    Name: rotator.fullName,
    Program: rotator.program,
    Level: rotator.level,
    Start: rotator.segments?.[0]?.start ?? "",
    End: rotator.segments?.[rotator.segments.length - 1]?.end ?? "",
    "Continuity Clinic": rotator.continuityClinic || "",
    "Day Off": Array.isArray(rotator.dayOff) ? rotator.dayOff.join(", ") : "",
    Unavailable: Array.isArray(rotator.unavailableRanges)
      ? rotator.unavailableRanges.map((r) => (r.start === r.end ? r.start : `${r.start} to ${r.end}`)).join("; ")
      : ""
  };
}

// Field keys shown in the column-mapping panel — order matters; it
// drives tab order, dropdown rendering, and the preview table.
const MAPPING_FIELDS = [
  { key: "fullName", label: "Name", required: true },
  { key: "program", label: "Program" },
  { key: "level", label: "Level" },
  { key: "startDate", label: "Start" },
  { key: "endDate", label: "End" },
  { key: "continuityClinic", label: "Continuity Clinic" },
  { key: "dayOff", label: "Day Off" },
  { key: "unavailableRanges", label: "Unavailable" }
];

// Excel-style column letter from 0-based index (0 → A, 25 → Z, 26 → AA).
function colLetter(idx) {
  let n = idx;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export function ImportConfirm({ pending, existingCount, existingRotators, onCancel, onConfirm }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllPreview, setShowAllPreview] = useState(false);
  const [layoutMode, setLayoutMode] = useState(pending.isMatrix ? "matrix" : "template");
  const [userMapping, setUserMapping] = useState(
    () => (pending.templateParse ? { ...pending.templateParse.detectedMapping } : {})
  );
  const headingRef = useRef(null);

  // Recompute the live preview from the current mapping. For matrix
  // mode we reuse the pre-parsed rows. Re-runs on every dropdown flip.
  const livePreview = useMemo(() => {
    if (layoutMode === "matrix") {
      return pending.matrixParse
        ? { rows: pending.matrixParse.rows, warnings: pending.matrixParse.warnings }
        : { rows: pending.rows, warnings: pending.warnings };
    }
    if (pending.templateParse) {
      const tp = pending.templateParse;
      return applyColumnMapping(tp.headers, tp.dataRows, userMapping, {
        headerRowIndex: tp.headerRowIndex
      });
    }
    return { rows: pending.rows, warnings: pending.warnings };
  }, [layoutMode, userMapping, pending]);

  // Focus heading on open + Escape to close.
  useEffect(() => {
    headingRef.current?.focus();
    function onKey(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const existingNames = useMemo(
    () => new Set((existingRotators || []).map((r) => String(r.fullName || "").trim().toLowerCase())),
    [existingRotators]
  );
  const collisions = livePreview.rows.filter((r) => existingNames.has(String(r.fullName || "").trim().toLowerCase()));
  const collisionCount = collisions.length;

  // Mapping panel warnings — these stand apart from the muted per-row
  // list and surface destructive-default configurations Coordinator might
  // miss.
  const startCol = userMapping.startDate;
  const endCol = userMapping.endDate;
  const nameMissing = layoutMode === "template" && (userMapping.fullName == null);
  const startMissing = layoutMode === "template" && (startCol == null);
  const endMissing = layoutMode === "template" && (endCol == null);
  const sameColTwice = layoutMode === "template"
    && startCol != null && endCol != null && startCol === endCol;

  const importDisabled = nameMissing;

  function handleMappingChange(fieldKey, colIndex) {
    setUserMapping((prev) => {
      const next = { ...prev };
      if (colIndex == null) {
        delete next[fieldKey];
      } else {
        next[fieldKey] = colIndex;
      }
      return next;
    });
  }

  function commitWithOptions(mode) {
    onConfirm(mode, { layoutMode, userMapping });
  }

  function confirmAdd() {
    if (collisionCount > 0) {
      const ok = window.confirm(
        `This will add ${collisionCount} rotator${collisionCount === 1 ? "" : "s"} with name${collisionCount === 1 ? "" : "s"} that already exist (e.g., ${collisions[0].fullName}), creating duplicates. Click OK to proceed anyway, or Cancel and use "Add new and update matches" instead.`
      );
      if (!ok) return;
    }
    commitWithOptions("add");
  }

  const previewLimit = showAllPreview ? livePreview.rows.length : 5;
  const previewRows = livePreview.rows.slice(0, previewLimit);
  const totalRows = livePreview.rows.length;
  const canToggleMatrix = !!pending.matrixParse;
  const canToggleTemplate = !!pending.templateParse;

  // When a panel-level missing-date banner is up, collapse per-row
  // missing-date warnings into a single summary line to avoid flooding.
  const visibleWarnings = useMemo(() => {
    if (!(startMissing || endMissing)) return livePreview.warnings;
    const filtered = livePreview.warnings.filter((w) => !/missing a (start|end) date/i.test(w));
    const collapsed = livePreview.warnings.length - filtered.length;
    if (collapsed > 0) {
      filtered.push(`...and ${collapsed} more row${collapsed === 1 ? "" : "s"} missing dates because the column isn't picked above.`);
    }
    return filtered;
  }, [livePreview.warnings, startMissing, endMissing]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Import roster from ${pending.fileName}`}
      onClick={onCancel}
    >
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2 tabIndex={-1} ref={headingRef}>Import roster from {pending.fileName}</h2>
            <p className="muted">
              Found {totalRows} rotator{totalRows === 1 ? "" : "s"}.
              You currently have {existingCount} on the list.
            </p>
            {(canToggleMatrix || canToggleTemplate) && (
              <fieldset className="import-layout-toggle">
                <legend>Layout</legend>
                <label>
                  <input
                    type="radio"
                    name="layout-mode"
                    value="template"
                    checked={layoutMode === "template"}
                    disabled={!canToggleTemplate}
                    onChange={() => setLayoutMode("template")}
                  />
                  <span>Template (one row per rotator)</span>
                  {!canToggleTemplate && <span className="muted"> — no Name column found</span>}
                </label>
                <label>
                  <input
                    type="radio"
                    name="layout-mode"
                    value="matrix"
                    checked={layoutMode === "matrix"}
                    disabled={!canToggleMatrix}
                    onChange={() => setLayoutMode("matrix")}
                  />
                  <span>Grid (week columns with B / !B marks)</span>
                  {!canToggleMatrix && <span className="muted"> — no matrix-style date headers detected</span>}
                </label>
              </fieldset>
            )}
          </div>
          <button className="secondary-button" onClick={onCancel}>Cancel</button>
        </header>
        <div className="modal-body">
          {layoutMode === "template" && pending.templateParse && (
            <ColumnMappingPanel
              headers={pending.templateParse.headers}
              detectedMapping={pending.templateParse.detectedMapping}
              userMapping={userMapping}
              onChange={handleMappingChange}
            />
          )}
          {nameMissing && (
            <div className="import-warning-banner import-warning-error" role="alert">
              A Name column is required to import.
            </div>
          )}
          {startMissing && endMissing && !nameMissing && (
            <div className="import-warning-banner">
              No Start or End column selected — rotators will import with no dates and won't appear on the schedule.
            </div>
          )}
          {startMissing && !endMissing && !nameMissing && (
            <div className="import-warning-banner">
              No Start column selected — rotators will import with no dates and won't appear on the schedule. Pick a Start column above.
            </div>
          )}
          {endMissing && !startMissing && !nameMissing && (
            <div className="import-warning-banner">
              No End column selected — rotators will import with no dates and won't appear on the schedule. Pick an End column above.
            </div>
          )}
          {sameColTwice && (
            <div className="import-warning-banner import-warning-mild">
              Start and End both map to column {colLetter(startCol)}. Imports will be single-day rotations.
            </div>
          )}
          {visibleWarnings.length > 0 && (
            <div className="muted" style={{ marginBottom: "0.75rem" }}>
              <strong>Notes from the file:</strong>
              <ul>
                {visibleWarnings.slice(0, 6).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
                {visibleWarnings.length > 6 && <li>...and {visibleWarnings.length - 6} more.</li>}
              </ul>
            </div>
          )}
          <div
            className="table-wrap"
            style={showAllPreview ? { maxHeight: "50vh", overflowY: "auto" } : undefined}
          >
            <table>
              <thead>
                <tr>
                  {/* One "Dates" column to match the single combined date cell
                      below (formatRotatorDates renders "start to end", or a
                      joined list for multi-segment rotators). The header
                      previously declared separate Start + End columns — 6
                      headers over 5 body cells — which shifted every value
                      right of Level one column left, so the date range showed
                      under Start, continuity clinic under End, and Clinic read
                      empty. The committed roster was always correct; only this
                      preview was misaligned. */}
                  <th>Name</th><th>Program</th><th>Level</th><th>Dates</th><th>Clinic</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.fullName}</td>
                    <td>{row.program}</td>
                    <td>{row.level}</td>
                    <td>{formatRotatorDates(row)}</td>
                    <td>{row.continuityClinic || "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalRows > 5 && (
              <p className="muted" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  {showAllPreview
                    ? `Showing all ${totalRows} rotators`
                    : `Showing first ${Math.min(5, totalRows)} of ${totalRows}`}
                  {layoutMode === "template" && pending.templateParse && (
                    <span> — updates as you remap.</span>
                  )}
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowAllPreview((v) => !v)}
                >
                  {showAllPreview ? "Show first 5" : `Show all ${totalRows}`}
                </button>
              </p>
            )}
          </div>
          <div className="action-bar" style={{ marginTop: "1rem", gap: "0.5rem" }}>
            <button
              className="primary-button"
              onClick={() => commitWithOptions("merge")}
              disabled={importDisabled}
              aria-disabled={importDisabled}
              aria-describedby={importDisabled ? "import-disabled-reason" : undefined}
            >
              Add new and update matches
            </button>
            <button
              className="secondary-button"
              onClick={() => commitWithOptions("replace")}
              disabled={importDisabled}
              aria-disabled={importDisabled}
              aria-describedby={importDisabled ? "import-disabled-reason" : undefined}
            >
              Replace existing roster
            </button>
          </div>
          {importDisabled && (
            <p id="import-disabled-reason" className="muted" style={{ marginTop: "0.25rem" }}>
              Pick a Name column above to enable Import.
            </p>
          )}
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            Merge (recommended) keeps existing rotators and updates anyone
            whose name matches — safe to use on re-uploads.
            Replace removes the {existingCount} rotators already on the list.
          </p>
          <div style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="link-button"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced option" : "Show advanced option"}
            </button>
            {showAdvanced && (
              <div style={{ marginTop: "0.5rem" }}>
                <button
                  className="secondary-button"
                  onClick={confirmAdd}
                  disabled={importDisabled}
                >
                  Add all as new (may create duplicates)
                </button>
                <p className="muted" style={{ marginTop: "0.25rem" }}>
                  Only use this if you intentionally want a second copy of
                  each provider — for example, two separate entries with the
                  same name.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnMappingPanel({ headers, detectedMapping, userMapping, onChange }) {
  // Build dropdown option list once — each header becomes one option,
  // labeled with its column letter for disambiguation (handles duplicate
  // and blank headers cleanly).
  const options = headers.map((header, index) => {
    const text = header.trim();
    const letter = colLetter(index);
    if (text === "") return { value: index, label: `(blank — col ${letter})` };
    return { value: index, label: `${text} (col ${letter})` };
  });

  return (
    <section className="import-mapping-panel">
      <header>
        <strong>Column mapping</strong>
        <p className="muted" style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.85rem" }}>
          Tell us which column in your spreadsheet means what. Auto-detected matches are pre-selected.
        </p>
      </header>
      <div className="import-mapping-grid">
        {MAPPING_FIELDS.map((field) => {
          const autoIdx = detectedMapping[field.key];
          const value = userMapping[field.key] ?? "";
          const isAuto = autoIdx != null && userMapping[field.key] === autoIdx;
          return (
            <label key={field.key} htmlFor={`map-${field.key}`}>
              <span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
              <select
                id={`map-${field.key}`}
                value={value}
                onChange={(event) => {
                  const raw = event.target.value;
                  onChange(field.key, raw === "" ? null : Number(raw));
                }}
              >
                <option value="">— pick one —</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {isAuto && <span className="import-mapping-auto"> (auto)</span>}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function SourceViewer({ source, onClose }) {
  const rows = Array.isArray(source.parsedRows) ? source.parsedRows : [];
  const text = typeof source.content === "string" ? source.content : "";
  const hasRows = rows.length > 0;
  const hasText = text.trim().length > 0;

  let body;
  if (hasRows) {
    const columns = Array.from(
      rows.reduce((set, row) => {
        Object.keys(row || {}).forEach((key) => set.add(key));
        return set;
      }, new Set())
    );
    body = (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column}>{row?.[column] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (hasText) {
    body = <pre className="source-preview-text">{text}</pre>;
  } else {
    body = (
      <p className="muted">
        This file was added before previews were available, or its contents could not be
        read here. Upload it again to see the rows or text inside.
      </p>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${source.fileName}`}
      onClick={onClose}
    >
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{source.fileName}</h2>
            <p className="muted">
              {source.program} · Imported {source.importedAt} · {source.status}
            </p>
          </div>
          <button className="secondary-button" onClick={onClose}>Close</button>
        </header>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}

function RosterPage({ state, block, updateState }) {
  const [form, setForm] = useState({
    fullName: "",
    program: "UT Pediatrics",
    level: "PGY-2",
    startDate: block.startDate,
    endDate: block.endDate
  });
  const [onlyThisBlock, setOnlyThisBlock] = useState(true);
  // #8 (Coordinator): group profile cards by source. The closest existing
  // "source" field is rotator.program (documented default D8 — there is no
  // dedicated source/importSource field). "view all" / group-by toggle is
  // DEFAULT ON: when on, cards are grouped under program headers; when off,
  // the roster renders as one flat list (matches the file's filter-toggle
  // idiom, parallel to onlyThisBlock).
  const [groupByProgram, setGroupByProgram] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [expandedProfileIds, setExpandedProfileIds] = useState(() => new Set());

  function toggleSelected(rotatorId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rotatorId)) next.delete(rotatorId);
      else next.add(rotatorId);
      return next;
    });
  }

  function toggleProfileExpanded(rotatorId) {
    setExpandedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(rotatorId)) next.delete(rotatorId);
      else next.add(rotatorId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function deleteSelected() {
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = window.confirm(
      `Remove ${count} rotator${count === 1 ? "" : "s"} from the roster? Their inpatient and outpatient assignments will also be removed. Use Sources to re-import if you change your mind.`
    );
    if (!ok) return;
    const ids = new Set(selectedIds);
    updateState(
      removeRotators(state, ids),
      `Removed ${count} rotator${count === 1 ? "" : "s"} from the roster.`
    );
    clearSelection();
  }

  function submit(event) {
    event.preventDefault();
    if (!form.fullName.trim()) return;
    const result = updateStateFromCommand(
      state,
      updateState,
      {
        type: "rotator.add",
        input: {
          fullName: form.fullName,
          program: form.program,
          level: form.level,
          startDate: form.startDate,
          endDate: form.endDate
        }
      },
      `${form.fullName} added to the local roster.`
    );
    if (result.ok) setForm({ ...form, fullName: "" });
  }

  // Detect duplicate names so we can offer the cleanup affordance only
  // when it's actually useful.
  const nameCount = new Map();
  for (const r of state.rotators) {
    const key = String(r.fullName || "").trim().toLowerCase();
    if (!key) continue;
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  const duplicateCount = [...nameCount.values()].filter((n) => n > 1).reduce((s, n) => s + (n - 1), 0);

  function cleanupDupes() {
    const ok = window.confirm(
      `Combine ${duplicateCount} duplicate provider entr${duplicateCount === 1 ? "y" : "ies"} into single profiles? Date ranges from all duplicates will be merged into one profile per name. Assignments stay linked.`
    );
    if (!ok) return;
    const { state: nextState, removedCount } = dedupeRotatorsByName(state);
    updateState(nextState, `Cleaned up ${removedCount} duplicate provider entr${removedCount === 1 ? "y" : "ies"}.`);
  }

  // Filter logic for the per-block view. "Only show providers active in
  // this block" hides rotators whose segments don't overlap the block
  // window. Default ON because Coordinator explicitly asked for this; toggle
  // off if she wants the full roster.
  const visibleRotators = onlyThisBlock
    ? state.rotators.filter((r) => expandRotatorDatesInBlock(r, block).length > 0)
    : state.rotators;

  // #8: group the visible rotators by program ("source"). Known programs
  // (PROGRAMS) keep their canonical order; any other non-empty program is
  // appended alphabetically; rotators with no/blank program land in
  // "Unassigned", which always renders last. Returns [{ label, rotators }].
  function groupRotatorsByProgram(rotators) {
    const UNASSIGNED = "Unassigned";
    const byLabel = new Map();
    for (const r of rotators) {
      const label = r.program && r.program.trim() ? r.program.trim() : UNASSIGNED;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(r);
    }
    const labels = [...byLabel.keys()];
    const known = PROGRAMS.filter((p) => byLabel.has(p));
    const others = labels
      .filter((l) => l !== UNASSIGNED && !PROGRAMS.includes(l))
      .sort((a, b) => a.localeCompare(b));
    const ordered = [...known, ...others];
    if (byLabel.has(UNASSIGNED)) ordered.push(UNASSIGNED);
    // Coordinator #7: sort people alphabetically WITHIN each program group (by
    // displayName) so the current-block roster is easy to scan and edit. The
    // group order above is unchanged; .slice() avoids mutating the buckets.
    return ordered.map((label) => ({
      label,
      rotators: byLabel
        .get(label)
        .slice()
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))
    }));
  }

  // One profile card. Shared by the grouped and flat renderings so all
  // existing per-card functionality (select, remove, edits) is identical.
  function renderRotatorCard(rotator) {
    const preferenceActualRanges = preferenceVsActualSummary(state, rotator, block).ranges;
    const isExpanded = expandedProfileIds.has(rotator.id);
    const isSelected = selectedIds.has(rotator.id);
    const cardActions = (
      <RotatorProfileActions
        rotator={rotator}
        expanded={isExpanded}
        selected={isSelected}
        onToggleExpanded={() => toggleProfileExpanded(rotator.id)}
        onToggleSelected={() => toggleSelected(rotator.id)}
      />
    );

    return (
      <div
        key={rotator.id}
        className={`roster-row${isSelected ? " selected" : ""}${isExpanded ? " expanded" : " collapsed"}`}
      >
        {isExpanded ? (
          <AvailabilityEditor
            rotator={rotator}
            actions={cardActions}
            preferenceActualRanges={preferenceActualRanges}
            onToggle={() => toggleProfileExpanded(rotator.id)}
            onChange={(patch) =>
              updateState(
                updateRotator(state, rotator.id, patch),
                `${rotator.displayName} updated.`
              )
            }
            onChangeQuiet={(patch) =>
              updateState(updateRotator(state, rotator.id, patch))
            }
            onRemove={() => {
              if (window.confirm(
                `Remove ${rotator.displayName}? Their inpatient and outpatient assignments will also be removed. Use Sources to re-import if you change your mind.`
              )) {
                updateState(
                  removeRotator(state, rotator.id),
                  `${rotator.displayName} removed from the roster.`
                );
                setSelectedIds((prev) => {
                  if (!prev.has(rotator.id)) return prev;
                  const next = new Set(prev);
                  next.delete(rotator.id);
                  return next;
                });
                setExpandedProfileIds((prev) => {
                  if (!prev.has(rotator.id)) return prev;
                  const next = new Set(prev);
                  next.delete(rotator.id);
                  return next;
                });
              }
            }}
          />
        ) : (
          <CollapsedRotatorProfile
            rotator={rotator}
            actions={cardActions}
            preferenceActualRanges={preferenceActualRanges}
            onToggle={() => toggleProfileExpanded(rotator.id)}
          />
        )}
      </div>
    );
  }

  const rotatorGroups = groupByProgram ? groupRotatorsByProgram(visibleRotators) : null;

  return (
    <div className="page-grid">
      <form className="panel" onSubmit={submit}>
        <h2>Add Rotator</h2>
        <div className="form-grid single">
          <TextField label="Full name" value={form.fullName} onChange={(fullName) => setForm({ ...form, fullName })} />
          <label>
            Program
            <select value={form.program} onChange={(event) => setForm({ ...form, program: event.target.value })}>
              {PROGRAMS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <TextField label="Level" value={form.level} onChange={(level) => setForm({ ...form, level })} />
          <TextField label="Start" type="date" value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} />
          <TextField label="End" type="date" value={form.endDate} onChange={(endDate) => setForm({ ...form, endDate })} />
          <button className="primary-button" type="submit">Add rotator</button>
        </div>
      </form>
      <section className="panel wide">
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
          <h2 style={{ margin: 0 }}>Who's On Pedi</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
              <input
                type="checkbox"
                className="toggle-switch"
                checked={onlyThisBlock}
                onChange={(event) => setOnlyThisBlock(event.target.checked)}
              />
              <span>Only show providers active in this block</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
              <input
                type="checkbox"
                className="toggle-switch"
                checked={groupByProgram}
                onChange={(event) => setGroupByProgram(event.target.checked)}
              />
              <span>Group by source</span>
            </label>
            {duplicateCount > 0 && (
              <button type="button" className="secondary-button" onClick={cleanupDupes}>
                Combine {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}
              </button>
            )}
            {selectedIds.size > 0 && (
              <>
                <button
                  type="button"
                  className="danger-button"
                  onClick={deleteSelected}
                  title="Permanently remove every selected rotator and their assignments."
                >
                  Delete {selectedIds.size} selected
                </button>
                <button type="button" className="secondary-button" onClick={clearSelection}>
                  Clear selection
                </button>
              </>
            )}
          </div>
        </header>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Each card below holds everything for one provider: name, program, level,
          continuity clinic, recurring day off, time-off ranges, and their date
          ranges on service. Edits save as you type.
          {onlyThisBlock ? " Showing only providers active in this block." : ""}
        </p>
        {visibleRotators.length === 0 && state.rotators.length > 0 ? (
          <p className="muted">
            No providers in your roster have dates inside this block ({block.startDate} to {block.endDate}).
            Uncheck the filter to see your full roster.
          </p>
        ) : groupByProgram ? (
          rotatorGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: "1rem" }}>
              <h3
                className="muted"
                style={{
                  margin: "0 0 0.5rem",
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: "0.25rem"
                }}
              >
                {group.label} <span style={{ opacity: 0.7 }}>({group.rotators.length})</span>
              </h3>
              <div className="form-grid single">
                {group.rotators.map((rotator) => renderRotatorCard(rotator))}
              </div>
            </div>
          ))
        ) : (
          <div className="form-grid single">
            {visibleRotators.map((rotator) => renderRotatorCard(rotator))}
          </div>
        )}
      </section>
    </div>
  );
}

function RotatorProfileActions({ rotator, expanded, selected, onToggleExpanded, onToggleSelected }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  const label = expanded ? "Collapse" : "Expand";
  return (
    <div className="roster-card-actions">
      <label
        className="roster-row-checkbox"
        title={selected ? "Unselect" : "Select for bulk delete"}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
        />
        <span>Select</span>
      </label>
      <button
        type="button"
        className="secondary-button roster-profile-toggle"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={`${label} ${rotator.displayName} profile`}
        title={`${label} ${rotator.displayName} profile`}
      >
        <Icon size={16} />
        {label}
      </button>
    </div>
  );
}

function CollapsedRotatorProfile({ rotator, actions, preferenceActualRanges = [], onToggle }) {
  const dayOff = Array.isArray(rotator.dayOff) ? rotator.dayOff : [];
  const ranges = Array.isArray(rotator.unavailableRanges) ? rotator.unavailableRanges : [];
  const phaseSummary = summarizeSegmentPhases(rotator);

  return (
    <section className="panel roster-profile-summary" aria-label={`${rotator.displayName} collapsed profile`}>
      <header className="roster-profile-summary-head">
        {/* U1 — clicking the name/program area toggles expand (the dedicated
            Expand button in `actions` stays for a11y). cursor + no-select so it
            reads as clickable without grabbing text on a double-click. */}
        <div
          className="roster-profile-summary-title roster-profile-clickable"
          onClick={onToggle}
          title={onToggle ? "Expand profile" : undefined}
        >
          <h3>{rotator.displayName}</h3>
          <p className="muted">{rotator.program || "Unassigned"} · {rotator.level || "—"}</p>
        </div>
        {actions}
      </header>
      <dl className="roster-profile-facts">
        <div>
          <dt>Dates</dt>
          <dd>{formatRotatorDates(rotator)}</dd>
        </div>
        <div>
          <dt>Clinic</dt>
          <dd>{rotator.continuityClinic || "No continuity clinic"}</dd>
        </div>
        <div>
          <dt>Day off</dt>
          <dd>{dayOff.length ? dayOff.join(", ") : "No weekly day off"}</dd>
        </div>
        <div>
          <dt>Time off</dt>
          <dd>{summarizeUnavailableRanges(ranges)}</dd>
        </div>
        {phaseSummary && (
          <div className="roster-profile-fact-wide">
            <dt>Pre-assign</dt>
            <dd>{phaseSummary}</dd>
          </div>
        )}
        {preferenceActualRanges.length > 0 && (
          <div className="roster-profile-fact-wide">
            <dt>Actual differs</dt>
            <dd>{preferenceActualRanges.map(formatPreferenceActualRange).join("; ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function AvailabilityEditor({ rotator, actions, preferenceActualRanges = [], onChange, onChangeQuiet, onRemove, onToggle }) {
  const dayOff = Array.isArray(rotator.dayOff) ? rotator.dayOff : [];
  const ranges = Array.isArray(rotator.unavailableRanges) ? rotator.unavailableRanges : [];
  // Pull display name (which is normalized + canonicalized) but allow
  // editing the underlying fullName when the user changes it.
  const nameValue = rotator.fullName ?? rotator.displayName ?? "";
  // For keystroke edits (name, level), use onChangeQuiet so we don't fire a
  // toast on every character. onChange stays for discrete intents (continuity
  // toggle, day-off toggle, time-off range add/remove, segment changes).
  const onText = onChangeQuiet || onChange;

  function toggleDay(day) {
    const next = dayOff.includes(day)
      ? dayOff.filter((item) => item !== day)
      : [...dayOff, day];
    onChange({ dayOff: next });
  }

  function addRange() {
    const defaultDate = rotator.segments?.[0]?.start ?? "";
    onChange({
      unavailableRanges: [
        ...ranges,
        { start: defaultDate, end: defaultDate }
      ]
    });
  }


  function updateRange(index, patch) {
    onText({
      unavailableRanges: ranges.map((range, i) =>
        i === index ? { ...range, ...patch } : range
      )
    });
  }

  function removeRange(index) {
    onChange({
      unavailableRanges: ranges.filter((_, i) => i !== index)
    });
  }

  return (
    <div className="panel roster-profile-editor">
      <header className="roster-profile-editor-head">
        {/* U1 — clicking the heading collapses the card (only when a toggle is
            wired; the name is edited via the field in the body, not this h3). */}
        <h3
          className={onToggle ? "roster-profile-clickable" : undefined}
          style={{ margin: 0 }}
          onClick={onToggle}
          title={onToggle ? "Collapse profile" : undefined}
        >
          {rotator.displayName} <span className="muted">({rotator.program} · {rotator.level || "—"})</span>
        </h3>
        <div className="roster-card-actions">
          {actions}
          {onRemove && (
            // U2 — danger styling so the destructive action reads as destructive
            // (it also goes through a window.confirm guard at the call site).
            <button
              type="button"
              className="danger-button"
              onClick={onRemove}
              title="Delete this rotator profile and any assignments tied to it"
            >
              Remove rotator
            </button>
          )}
        </div>
      </header>
      {preferenceActualRanges.length > 0 && (
        <div
          aria-label="Actual assignments differ from profile preference"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            flexWrap: "wrap",
            marginBottom: "0.65rem"
          }}
        >
          <strong style={{ fontSize: "0.85rem" }}>Actual differs from profile:</strong>
          {preferenceActualRanges.map((range) => (
            <span
              key={`${range.startDate}-${range.endDate}-${range.preference}-${range.actual}`}
              className={`chip ${range.actual === "both" ? "chip-crit" : "chip-warn"}`}
              title={`Profile preference is ${formatPhaseLabel(range.preference)}; Planning Grid has ${formatPhaseLabel(range.actual)}.`}
            >
              {formatPreferenceActualRange(range)}
            </span>
          ))}
        </div>
      )}
      <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
        <TextField
          label="Full name"
          value={nameValue}
          onChange={(fullName) => onText({
            fullName,
            displayName: fullName.replace(/\s+/g, " ").trim()
          })}
        />
        <label>
          Program
          <select
            value={rotator.program}
            onChange={(event) => onChange({ program: event.target.value })}
          >
            {PROGRAMS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <TextField
          label="Level"
          value={rotator.level || ""}
          onChange={(level) => onText({ level })}
        />
      </div>
      <ContinuityClinicEditor
        value={rotator.continuityClinic}
        onChange={(continuityClinic) => onChange({ continuityClinic })}
      />
      {(() => {
        const slots = parseContinuityClinicSlots(rotator.continuityClinic);
        if (slots.length === 0) return null;
        return (
          <div
            className="muted"
            style={{
              marginTop: "0.5rem",
              padding: "0.4rem 0.6rem",
              borderRadius: "6px",
              background: "rgba(180, 140, 50, 0.12)",
              fontSize: "0.85rem"
            }}
            aria-label="Continuity clinic auto-block"
          >
            <strong>Auto-blocked half-day{slots.length === 1 ? "" : "s"}:</strong>{" "}
            {slots.map((s) => `${s.weekday} ${s.period}`).join(", ")}
            <span> — {slots.length === 1 ? "this period is" : "these periods are"} treated as unavailable on every matching weekday the rotator is on service. Outpatient sessions for other clinics that day/period will fire a continuity-clinic conflict.</span>
          </div>
        );
      })()}
      <div>
        <strong>Day off each week</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
          {WEEKDAYS.map((day) => (
            <label key={day} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <input
                type="checkbox"
                checked={dayOff.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {day}
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <strong>Time off (vacation / single days)</strong>
        <p className="muted" style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.85rem" }}>
          Add a range for a week off, or set From and To to the same day for a single day off.
        </p>
        {ranges.length === 0 && (
          <p className="muted" style={{ margin: "0.25rem 0" }}>No time off scheduled.</p>
        )}
        {ranges.map((range, index) => (
          <div
            key={index}
            style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.25rem" }}
          >
            <label>
              From
              <input
                type="date"
                value={range.start || ""}
                onChange={(event) => updateRange(index, { start: event.target.value })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={range.end || ""}
                onChange={(event) => updateRange(index, { end: event.target.value })}
              />
            </label>
            <button type="button" onClick={() => removeRange(index)}>Remove</button>
          </div>
        ))}
        <button
          type="button"
          style={{ marginTop: "0.5rem" }}
          onClick={addRange}
        >
          Add time-off range
        </button>
      </div>
      <SegmentEditor rotator={rotator} onChange={onChange} onChangeQuiet={onChangeQuiet} />
    </div>
  );
}

// #1 (Coordinator): structured continuity-clinic picker. Replaces the old
// free-text input with an AM/PM × Mon–Fri grid of "stereo buttons" that
// supports MULTIPLE slots. We SEED the selected toggles from the existing
// rotator.continuityClinic string via parseContinuityClinicSlots, and on
// every toggle we persist the canonical string back through the existing
// rotator-update path via formatContinuityClinicSlots — the field stays a
// STRING (schema requires it). We deliberately do NOT rewrite the string on
// mount, only on an actual toggle, so a legacy non-canonical value (e.g.
// "tuesday pm") loads with the right buttons lit but is preserved verbatim
// until the user touches it (back-compat / round-trip-if-untouched).
function ContinuityClinicEditor({ value, onChange }) {
  const slots = parseContinuityClinicSlots(value);
  const isSelected = (weekday, period) =>
    slots.some((s) => s.weekday === weekday && s.period === period);

  function toggleSlot(weekday, period) {
    const exists = isSelected(weekday, period);
    const next = exists
      ? slots.filter((s) => !(s.weekday === weekday && s.period === period))
      : [...slots, { weekday, period }];
    onChange(formatContinuityClinicSlots(next));
  }

  return (
    <div style={{ marginTop: "0.25rem", marginBottom: "0.75rem" }}>
      <strong>Continuity clinic</strong>
      <p className="muted" style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.85rem" }}>
        Pick the recurring half-days this provider has continuity clinic. Multiple
        slots are allowed; each lit button blocks that weekday/period on every
        matching day they're on service.
      </p>
      <div
        role="group"
        aria-label="Continuity clinic half-days"
        style={{ display: "grid", gridTemplateColumns: `auto repeat(${CONTINUITY_PERIODS.length}, 1fr)`, gap: "0.25rem 0.4rem", alignItems: "center", maxWidth: "320px" }}
      >
        <span aria-hidden="true" />
        {CONTINUITY_PERIODS.map((period) => (
          <span key={period} className="muted" style={{ textAlign: "center", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
            {period}
          </span>
        ))}
        {CONTINUITY_WEEKDAYS.map((weekday) => (
          <React.Fragment key={weekday}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>{weekday.slice(0, 3)}</span>
            {CONTINUITY_PERIODS.map((period) => {
              const on = isSelected(weekday, period);
              return (
                <button
                  key={period}
                  type="button"
                  className="day-toggle"
                  aria-pressed={on}
                  title={`${weekday} ${period}${on ? " (clinic) — click to clear" : " — click to set continuity clinic"}`}
                  onClick={() => toggleSlot(weekday, period)}
                  style={
                    on
                      ? { background: "rgba(180, 140, 50, 0.85)", borderColor: "rgba(180, 140, 50, 0.85)", color: "#fff" }
                      : undefined
                  }
                >
                  {period}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SegmentEditor({ rotator, onChange, onChangeQuiet }) {
  const segments = Array.isArray(rotator.segments) ? rotator.segments : [];
  // Quiet update for per-character date edits; loud onChange for add/remove
  // since those are discrete user intents worth a toast.
  const quiet = onChangeQuiet || onChange;

  function updateSegment(index, patch) {
    quiet({
      segments: segments.map((seg, i) => (i === index ? { ...seg, ...patch } : seg))
    });
  }

  function addSegment() {
    // Default the new range to the rotator's existing window if any,
    // otherwise leave blank for the user to fill in.
    const last = segments[segments.length - 1];
    const start = last?.end || last?.start || "";
    const end = last?.end || "";
    onChange({ segments: [...segments, { start, end }] });
  }

  function removeSegment(index) {
    onChange({ segments: segments.filter((_, i) => i !== index) });
  }

  function setPhase(index, value) {
    const phase = value === "" ? null : value;
    if (phase === null) {
      onChange({
        segments: segments.map((seg, i) => {
          if (i !== index) return seg;
          const next = { ...seg };
          delete next.defaultPhase;
          return next;
        })
      });
    } else {
      updateSegment(index, { defaultPhase: phase });
    }
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <strong>Date ranges (on service)</strong>
      {segments.length === 0 && (
        <p className="muted" style={{ margin: "0.25rem 0" }}>No date ranges yet. Add them by uploading a roster on the Sources tab or by adding the rotator on this page.</p>
      )}
      {segments.map((seg, index) => (
        <div
          key={index}
          style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.25rem", flexWrap: "wrap" }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", margin: 0 }}>
            From
            <input
              type="date"
              value={seg.start || ""}
              onChange={(event) => updateSegment(index, { start: event.target.value })}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", margin: 0 }}>
            To
            <input
              type="date"
              value={seg.end || ""}
              onChange={(event) => updateSegment(index, { end: event.target.value })}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", margin: 0 }}>
            Pre-assign:
            <select
              value={seg.defaultPhase || ""}
              onChange={(event) => setPhase(index, event.target.value)}
            >
              <option value="">— none —</option>
              <option value="outpatient">Outpatient (auto-fills placeholder clinics, hides from inpatient dropdowns)</option>
              <option value="inpatient">Inpatient (auto-fills inpatient assignments, hides from outpatient dropdowns)</option>
            </select>
          </label>
          <button type="button" onClick={() => removeSegment(index)}>Remove</button>
        </div>
      ))}
      <button type="button" style={{ marginTop: "0.5rem" }} onClick={addSegment}>
        Add date range
      </button>
      <p className="muted" style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
        Add a second range here if this person comes back later in the year. Pre-assignments fire automatically when the block containing the date range is opened.
      </p>
    </div>
  );
}

// Rotator × date grid view. Coordinator needs to see at a glance who is on
// IP vs OP across the block (including midweek starts/leaves) and where
// coverage gaps sit. The daily totals row is the "action item" — when
// Unassigned > 0 it's highlighted because that's a gap she needs to fill.
// Section order on screen. Classification is by COMPLETION STATE
// (Needs Assignment / Mixed / Fully IP / Fully OP / Not in block) — NOT
// by phase. This matches Coordinator's correction that the unit of
// assignment is (person + date range), not person; a single rotator can
// be IP for two weeks then OP for two weeks and that's a Mixed row.
// "Not in block" stays last and visible in every view for context.
const PLANNING_SECTIONS = [
  {
    id: "needs",
    title: "Needs Assignment",
    description: "Rotators with at least one available day not yet assigned to IP or OP. Act on these first."
  },
  {
    id: "mixed",
    title: "Mixed Assignments",
    description: "Rotators with both IP and OP days in this block — split schedules that deserve extra eyes."
  },
  {
    id: "fullyIp",
    title: "Fully Inpatient",
    description: "Rotators whose entire active block is inpatient."
  },
  {
    id: "fullyOp",
    title: "Fully Outpatient",
    description: "Rotators whose entire active block is outpatient."
  },
  {
    id: "unavailable",
    title: "Not in block",
    description: "Rotators with no date range in this block — shown for context."
  }
];

// C2 — Planning Grid view filter (restores the regression removed in 18abb08,
// but as the EDITABLE row-filter Coordinator actually asked for, not the old
// embedded calendar views). Master shows every section; Inpatient/Outpatient
// narrow the same construction grid to only the rotators on that service.
// Mixed rotators appear in BOTH IP and OP views because they do both. This is
// distinct from the read-only Inpatient/Outpatient Schedule projection pages.
export const PLANNING_VIEW_TABS = [
  { id: "master", label: "Master Planning", sub: "All rotators × dates" },
  { id: "inpatient", label: "Inpatient", sub: "Only rotators on inpatient" },
  { id: "outpatient", label: "Outpatient", sub: "Only rotators on outpatient" }
];

export function planningSectionVisibleInView(sectionId, view) {
  if (view === "inpatient") return sectionId === "mixed" || sectionId === "fullyIp";
  if (view === "outpatient") return sectionId === "mixed" || sectionId === "fullyOp";
  return true; // "master" (and any unknown view) shows every section
}

const STAFF_PLANNING_SECTION = {
  id: "staff",
  title: "Staff rows",
  description: "Pinned fellows and attending clinic projections for quick staff review."
};

function isActiveFellowPlanningRow(row) {
  const rotator = row?.rotator || {};
  return isPediatricNeurologyFellow(rotator)
    && (row.cells || []).some((cell) => cell.status !== "absent");
}

function buildAttendingPlanningRows(state, dates) {
  if (!state || !Array.isArray(dates) || dates.length === 0) return [];
  const dateSet = new Set(dates);
  const byAttending = new Map();
  for (const session of state.outpatientSessions || []) {
    if (!dateSet.has(session.date)) continue;
    for (const detail of outpatientDetailsForSession(session)) {
      const provider = String(detail.attending || "").trim();
      if (!provider) continue;
      const key = provider.toLowerCase();
      if (!byAttending.has(key)) {
        byAttending.set(key, { name: provider, sessionsByDate: new Map() });
      }
      const bucket = byAttending.get(key).sessionsByDate;
      const projectedSession = {
        ...session,
        clinic: detail.clinic || session.clinic,
        provider
      };
      bucket.set(session.date, [...(bucket.get(session.date) || []), projectedSession]);
    }
  }
  return [...byAttending.values()]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((attending) => ({
      rotator: {
        id: `staff-attending::${attending.name.toLowerCase()}`,
        displayName: attending.name,
        fullName: attending.name,
        program: "Attending",
        level: "Attending",
        role: "Attending",
        syntheticStaffRow: "attending"
      },
      cells: dates.map((date) => {
        const sessions = attending.sessionsByDate.get(date) || [];
        if (sessions.length === 0) {
          return { date, status: "absent", staffKind: "attending" };
        }
        return { date, status: "outpatient", op: sessions, staffKind: "attending" };
      })
    }));
}

function outpatientSessionTitle(cell) {
  const sessions = Array.isArray(cell?.op) ? cell.op : [];
  if (sessions.length === 0) return "";
  return sessions.map((session) => {
    const period = session.period === "PM" ? "PM" : "AM";
    const clinic = String(session.clinic || "Clinic").trim() || "Clinic";
    const provider = String(session.provider || "").trim();
    return provider ? `${period} ${clinic} with ${provider}` : `${period} ${clinic}`;
  }).join("; ");
}

function outpatientCellBody(cell) {
  if (cell?.staffKind !== "attending") return "OP";
  const periods = [...new Set((cell.op || []).map((session) => session.period === "PM" ? "PM" : "AM"))];
  if (periods.length === 0) return "OP";
  return periods.length === 1 ? periods[0] : "AM+PM";
}

// #3b (2026-05-27): one-click PDF export for the Inpatient/Outpatient planning
// tabs. Coordinator asked to drop the standalone Inpatient/Outpatient menu pages now
// that the tabs cover the same ground — but the Export page's per-side PDF
// download was the one feature not reachable from the planning view. This small
// toolbar surfaces it inside the IP/OP tab panels so nothing is stranded when the
// standalone nav entries are hidden. It reuses the same builders
// (buildInpatientPdf / buildOutpatientPdf) and the same save-as-download pattern
// as ExportPage.savePdfBlob — no duplicated PDF logic.
function PlanningPdfToolbar({ state, block, kind, setNotice }) {
  function safeBlockName() {
    return (block?.name || "schedule").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  }

  function savePdfBlob(blob, suffix, noticeLabel) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeBlockName()}-${suffix}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    if (setNotice) setNotice(`${noticeLabel} saved to your Downloads folder.`);
  }

  function downloadPdf() {
    if (kind === "inpatient") {
      savePdfBlob(buildInpatientPdf(state, block), "inpatient", "Inpatient schedule PDF");
    } else {
      savePdfBlob(buildOutpatientPdf(state, block), "outpatient", "Outpatient schedule PDF");
    }
  }

  const label = kind === "inpatient" ? "Download inpatient PDF" : "Download outpatient PDF";
  const title = kind === "inpatient"
    ? "Save the inpatient calendar (plus legend and inpatient-relevant conflicts) as its own PDF for distribution."
    : "Save the outpatient calendar (plus legend and outpatient-relevant conflicts) as its own PDF for distribution.";

  return (
    <div className="button-row" style={{ marginBottom: "12px" }}>
      <button className="secondary-button" onClick={downloadPdf} title={title}>
        <FileDown size={18} />
        {label}
      </button>
    </div>
  );
}

// 2026-05-28 redesign: CombinedPlanningPage (the old Planning Grid + Inpatient
// + Outpatient tab container) has been removed. Planning Grid now routes
// directly to PlanningGridPage (service-level construction only); Inpatient
// Schedule and Outpatient Schedule are separate read-only destinations.
// PlanningPdfToolbar, InpatientPage, and OutpatientPage are retained below and
// are rewired into the new schedule pages in Phases 4 & 6.

// Fixed read-only context shown on either side of the active block.
const PEEK_BUFFER_DAYS = 14;

// Collapse a raw draft-report check list into human-readable lines for the
// report panel. The per-day `ip-below-min` checks are grouped into a single
// summary line (one row per under-staffed day would swamp the panel and they
// already appear individually on the Conflicts page); every other check id is
// shown verbatim. Returns [{ severity, message }] ordered errors-first.
export function summarizeDraftChecks(checks) {
  const lines = [];
  const belowMin = checks.filter((c) => c.id === "ip-below-min");
  if (belowMin.length > 0) {
    lines.push({
      severity: "error",
      message: `${belowMin.length} day${belowMin.length === 1 ? "" : "s"} below minimum inpatient staffing — see the Conflicts page for each day.`
    });
  }
  for (const c of checks) {
    if (c.id === "ip-below-min") continue;
    lines.push({ severity: c.severity, message: c.message });
  }
  return lines.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
}

export function PlanningGridPage({ state, block, updateState }) {
  // Peek windows show short read-only context before/after the current block so
  // Coordinator can confirm continuity without switching blocks.
  const [peekBeforeBlock, setPeekBeforeBlock] = useState(false);
  const [peekPastBlock, setPeekPastBlock] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  // Per Coordinator's phone-call ask (2026-05-22): only show rotators
  // active in the current block so she's not scanning past names
  // she doesn't care about until next month. Mirrors the existing
  // RosterPage "Only show providers active in this block" toggle —
  // same label, same default-on.
  const [onlyThisBlock, setOnlyThisBlock] = useState(true);
  const [showStaffRows, setShowStaffRows] = useState(true);
  // A3: the most recent auto-draft validation report (null until "Generate
  // draft" runs). Rendered as a dismissible panel below the toolbar.
  const [draftReport, setDraftReport] = useState(null);
  // Paint tool: a master on/off toggle (paintOn) gates pointer-paint; when on,
  // paintTool ("IP"/"OP"/"offday"/"clear") picks what a drag-sweep commits via
  // applyRangeAssignment. `paintMode` is the EFFECTIVE mode the grid reads:
  // "off" whenever the toggle is off (no painting — normal clicking), otherwise
  // the selected tool. Keeping paintMode derived (not state) preserves the
  // `paintActive = paintMode !== "off"` invariant for every downstream consumer.
  // Replaces the old neutral "Select" radio: toggling Paint mode off IS the
  // not-painting state now, so there's no fifth no-op option to confuse.
  const [paintOn, setPaintOn] = useState(false);
  const [paintTool, setPaintTool] = useState("IP");
  const paintMode = paintOn ? paintTool : "off";
  // C2 — which rotators are shown: master (all), inpatient-only, outpatient-only.
  const [planningView, setPlanningView] = useState("master");
  const [paintState, paintDispatch] = useReducer(paintReducer, initialPaintState);
  // The row the current paint sweep started in. Stored separately
  // because applyRangeAssignment needs (rotatorId, start, end) per run.
  const paintRotatorRef = useRef(null);
  // #2 profile-override warn-and-allow: persistent set of `${rotatorId}::${date}`
  // keys for cells where a manual paint/drop knowingly overrode the rotation
  // profile's defaultPhase. Cells render a badge until the same (rotator,date)
  // is re-painted in a way that no longer contradicts the profile.
  const [overrideBadgeKeys, setOverrideBadgeKeys] = useState(() => new Set());
  // #2 (Coordinator 2026-06-02): a paint/drop that contradicts the imported rotation
  // profile now CONFIRMS first via a popup ("Change from original preference" /
  // "Cancel action") instead of silently allowing it. While a confirmable action
  // is pending, this holds { warnings, onConfirm } until the user decides.
  const [pendingOverride, setPendingOverride] = useState(null);

  // #2 single funnel for every mutating paint/drop. Runs assessRangeAssignment
  // BEFORE applyRangeAssignment over the same (rotatorId, range, phase) and
  // computes the resulting state + any profile-override warnings WITHOUT
  // committing. `ranges` is an array of { startDate, endDate }. Returns
  // { next, warnings, stamp }: `next` is the would-be state, `warnings` lists
  // profile contradictions, and `stamp()` records/clears the persistent badges
  // for the touched cells — call it ONLY when the action is actually applied
  // (so a cancelled override leaves no badge and changes nothing).
  function applyRangesWithOverrideCheck(baseState, rotatorId, ranges, phase) {
    let next = baseState;
    const allWarnings = [];
    for (const { startDate, endDate } of ranges) {
      const args = { rotatorId, startDate, endDate, phase };
      // Clamp against the RAW block: peek is view-only, so paint never writes
      // past the block end even if a sweep's range extends into peek columns
      // (the peek cells are also non-interactive — see PlanningCell readOnly).
      const { warnings } = assessRangeAssignment(next, block, args);
      if (warnings.length) allWarnings.push(...warnings);
      next = applyRangeAssignment(next, block, args);
    }
    // Clear any stale badges across the touched ranges, then stamp the cells
    // that actually warned this time. A non-warning cell in the range loses
    // its old badge even when a sibling cell in the same sweep warns.
    const stamp = () => setOverrideBadgeKeys((prev) => {
      const out = new Set(prev);
      let changed = false;
      for (const { startDate, endDate } of ranges) {
        for (const d of dateRange(startDate, endDate)) {
          if (out.delete(`${rotatorId}::${d}`)) changed = true;
        }
      }
      for (const w of allWarnings) {
        const key = `${w.rotatorId}::${w.date}`;
        if (!out.has(key)) { out.add(key); changed = true; }
      }
      return changed ? out : prev;
    });
    return { next, warnings: allWarnings, stamp };
  }

  // #2 commit a computed paint/drop result, gated by the confirm popup when it
  // would override the rotation profile. No override -> apply immediately. With
  // override -> stash { next, message, stamp } behind the modal; Cancel keeps
  // the profile (nothing changes), Confirm commits the state + stamps badges.
  function runWithOverrideConfirm({ next, warnings, stamp }, message) {
    const apply = () => {
      if (typeof stamp === "function") stamp();
      updateState(next, message);
    };
    if (warnings.length) {
      setPendingOverride({ warnings, onConfirm: apply });
    } else {
      apply();
    }
  }

  // Drag-drop end handler. @dnd-kit/react fires this after a drop.
  // event.operation.target is null when the drop landed on a disabled
  // cell or off-grid — the chess-style "drop refused" signal, verified
  // by the spike at /tmp/team-planning-EzabSPRU/drag-drop/spike/.
  function handleDragEnd(event) {
    if (event.canceled || !event.operation?.target) return;
    const rotatorId = event.operation.source?.id;
    const target = event.operation.target;
    if (typeof rotatorId !== "string") return;
    const rotator = getRotator(state, rotatorId);
    const targetId = typeof target.id === "string" ? target.id : "";

    // #5 Section-header drop targets. Dropping a rotator onto Inpatient /
    // Outpatient / Mixed writes a block-range paint across the rotator's
    // active range. Inpatient → phase inpatient, Outpatient → outpatient,
    // Mixed → clear (so days can be freely mixed afterward).
    if (targetId.startsWith("section::")) {
      const sectionId = target.data?.sectionId ?? targetId.split("::").pop();
      const phaseBySection = { fullyIp: "inpatient", fullyOp: "outpatient", mixed: "clear" };
      const phase = phaseBySection[sectionId];
      if (!phase) return; // "needs" / "unavailable" are not drop targets
      const result = applyRangesWithOverrideCheck(
        state,
        rotatorId,
        [{ startDate: block.startDate, endDate: block.endDate }],
        phase
      );
      if (result.next === state) {
        updateState(state, "No changes — the rotator has no applicable days in this block.");
        return;
      }
      const verb = phase === "clear"
        ? `Cleared ${rotator?.displayName ?? "Rotator"}'s block role (now mixable)`
        : `Set ${rotator?.displayName ?? "Rotator"} to ${phase === "inpatient" ? "inpatient" : "outpatient"} for the block`;
      const warnNote = result.warnings.length
        ? ` — changed from the rotation profile on ${result.warnings.length} day${result.warnings.length === 1 ? "" : "s"}`
        : "";
      runWithOverrideConfirm(result, `${verb}${warnNote}.`);
      return;
    }

    // The droppable id is synthetic+unique (`cell::<rotatorId>::<date>`)
    // so the same calendar date in different rotator rows doesn't collide
    // in @dnd-kit's id-keyed registry. The semantic date rides in `data`;
    // fall back to parsing it off the id if a future @dnd-kit drops `data`.
    const date = target.data?.date
      ?? (targetId ? targetId.split("::").pop() : null);
    if (typeof date !== "string") return;
    // Peek is view-only: refuse drops onto days outside the raw block. PlanningCell
    // already disables the droppable for readOnly peek cells, so a drop should
    // never reach here — this is defense-in-depth in case a future change wires
    // a different drop path.
    if (isOutsideRawBlock(date)) {
      updateState(state, "That day is outside the block (view-only) — switch off Peek to see only assignable days.");
      return;
    }
    // #2 a single-day cell drop is an inpatient assignment; run the override
    // assessment over the one-day range so cell-drop is uniform with paint —
    // including the confirm popup. applyDrop stays the writer (Drag-Drop tag);
    // the badge is stamped/cleared only when the drop is actually applied.
    const { warnings } = assessRangeAssignment(state, block, {
      rotatorId, startDate: date, endDate: date, phase: "inpatient"
    });
    const key = `${rotatorId}::${date}`;
    const stamp = () => setOverrideBadgeKeys((prev) => {
      if (warnings.length) return prev.has(key) ? prev : new Set(prev).add(key);
      if (!prev.has(key)) return prev;
      const out = new Set(prev);
      out.delete(key);
      return out;
    });
    const warnNote = warnings.length ? " (changed from the rotation profile)" : "";
    runWithOverrideConfirm(
      { next: applyDrop(state, rotatorId, date), warnings, stamp },
      `${rotator?.displayName ?? "Rotator"} assigned to inpatient on ${date}.${warnNote}`
    );
  }

  // Commit the paint selection — group into contiguous runs (weekend-aware
  // for IP/OFF/clear so Sat/Sun stay in-run; weekday-only for OP), then call
  // applyRangeAssignment once per run with the snapshotted mode for the row
  // the sweep started in. #2 override warnings funnel through the shared
  // helper (toast + persistent badge, warn-and-allow).
  function commitPaintSelection(rotatorId, mode, selected) {
    if (!rotatorId || !mode || selected.size === 0) return;
    const phase = { IP: "inpatient", OP: "outpatient", offday: "off", clear: "clear" }[mode];
    if (!phase) return;
    // #6: OP cannot land on weekend/holiday cells. The blocked cells gate
    // their own pointer handlers, but a sweep that DRAGS THROUGH a blocked
    // cell still resolves it via elementFromPoint; and applyRangeAssignment's
    // OP branch only skips Sat/Sun (not noClinic holidays). Drop blocked dates
    // here so a holiday weekday can never receive an OP session.
    let painted = selected;
    if (phase === "outpatient") {
      painted = new Set([...selected].filter((d) => !outpatientBlockedDates.has(d)));
      if (painted.size === 0) return;
    }
    // OP paints skip weekends; IP/OFF/clear span them (contract §3 B / 1b).
    const includeWeekends = phase !== "outpatient";
    const runs = selectionToContiguousRuns(painted, { includeWeekends });
    const ranges = runs.map((run) => ({ startDate: run.start, endDate: run.end }));
    const result = applyRangesWithOverrideCheck(state, rotatorId, ranges, phase);
    const skipped = selected.size - painted.size;
    const dayCount = `${painted.size} day${painted.size === 1 ? "" : "s"}`;
    const label = phase === "clear" ? "unassigned" : phase === "off" ? "off" : phase;
    const base = phase === "clear"
      ? `Reset ${dayCount} to ${label}.`
      : `Painted ${dayCount} as ${label}.`;
    const skipNote = skipped > 0
      ? ` Skipped ${skipped} weekend/holiday day${skipped === 1 ? "" : "s"} (no outpatient).`
      : "";
    const warnNote = result.warnings.length
      ? ` Changed from the rotation profile on ${result.warnings.length} day${result.warnings.length === 1 ? "" : "s"}.`
      : "";
    runWithOverrideConfirm(result, `${base}${skipNote}${warnNote}`);
  }

  // Peek is always a fixed two-week context window. Neighboring block lengths
  // never widen it; the raw block remains the edit boundary for drag/drop,
  // paint, and range assignment.
  const effectiveBlock = useMemo(() => {
    if (!block) return block;
    let out = block;
    if (peekBeforeBlock) {
      out = extendBlockStart(out, PEEK_BUFFER_DAYS);
    }
    if (peekPastBlock) {
      out = extendBlockEnd(out, PEEK_BUFFER_DAYS);
    }
    const holidays = [];
    const seenHolidayDates = new Set();
    for (const sourceBlock of [block, ...(state.serviceBlocks || [])]) {
      for (const holiday of sourceBlock.holidays || []) {
        const date = String(holiday?.date || "");
        if (!date || seenHolidayDates.has(date) || date < out.startDate || date > out.endDate) {
          continue;
        }
        seenHolidayDates.add(date);
        holidays.push(holiday);
      }
    }
    return { ...out, holidays };
  }, [block, state.serviceBlocks, peekBeforeBlock, peekPastBlock]);

  function isOutsideRawBlock(date) {
    return !!((block?.startDate && date < block.startDate) || (block?.endDate && date > block.endDate));
  }

  const grid = useMemo(() => buildPlanningGrid(state, effectiveBlock), [state, effectiveBlock]);

  // Block-active filter (Coordinator ask). Set of rotator ids whose
  // segments touch the ORIGINAL block — NOT effectiveBlock. "Only show
  // providers active in this block" must keep the roster pinned to Coordinator's
  // block while peek only extends the COLUMNS; otherwise turning peek on would
  // surface people who are active solely in the next block, defeating the whole
  // point ("see if MY people continue"). Computed per block change and applied
  // between grid construction and section grouping so the section totals +
  // planning-cell rendering both see the filtered set.
  const activeRotatorIdSet = useMemo(() => {
    if (!onlyThisBlock || !block) return null;
    return new Set(
      rotatorsActiveInBlock(state, block).map((r) => r.id)
    );
  }, [state, block, onlyThisBlock]);

  // #6: render EVERY day as its own cell — Sat/Sun/holidays included (the
  // weekday-only mask was removed). The inpatient side is paintable every
  // day; outpatient cells on Sat/Sun and no-clinic holidays are BLOCKED
  // (OP has no weekend/holiday demand model). `outpatientBlockedDates` is
  // the set of dates where OP paint must be refused.
  const outpatientBlockedDates = useMemo(() => {
    const holidaySet = new Set(
      (effectiveBlock?.holidays || [])
        .filter((h) => h && h.noClinic)
        .map((h) => h.date)
    );
    const blocked = new Set();
    for (const d of grid.dates) {
      const wd = weekdayName(d);
      if (wd === "Saturday" || wd === "Sunday" || holidaySet.has(d)) blocked.add(d);
    }
    return blocked;
  }, [grid.dates, effectiveBlock]);

  // Block-active row filter + group rows into sections, each alphabetically
  // sorted. Sections drive both row classification and cell coloring (cells
  // inherit their row's section band color). No date mask any more (#6).
  const { dates, totals, sections, staffRows } = useMemo(() => {
    const filteredRows = activeRotatorIdSet
      ? grid.rows.filter((r) => activeRotatorIdSet.has(r.rotator.id))
      : grid.rows;
    const fellowStaffRows = showStaffRows
      ? filteredRows.filter(isActiveFellowPlanningRow)
      : [];
    const fellowStaffIds = new Set(fellowStaffRows.map((row) => row.rotator.id));
    const regularRows = showStaffRows
      ? filteredRows.filter((row) => !fellowStaffIds.has(row.rotator.id))
      : filteredRows;
    const attendingStaffRows = showStaffRows
      ? buildAttendingPlanningRows(state, grid.dates)
      : [];
    return {
      dates: grid.dates,
      totals: grid.totals,
      sections: groupPlanningRowsBySection(regularRows),
      staffRows: [...fellowStaffRows, ...attendingStaffRows]
    };
  }, [grid, activeRotatorIdSet, showStaffRows, state]);

  if (grid.rows.length === 0) {
    return (
      <section className="panel full">
        <h2>Planning Grid</h2>
        <div className="empty-state">
          <Users size={26} />
          Add rotators on the Rotators page to populate the planning grid.
        </div>
      </section>
    );
  }

  function toggleSection(sectionId) {
    setCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }

  // A1: the single auto-draft entry point. generateDraft seeds every program
  // (Methodist 14/14 + deterministic inpatient fair-fill) and returns a
  // post-generate validation report. It LOCKS existing assignments — manual
  // edits are never overwritten — so it's always safe to re-run. Generation
  // targets the real active `block`, not the peek-extended view.
  function runGenerateDraft() {
    const { state: next, report } = generateDraft(state, block);
    const added = report.summary.inpatientAdded + report.summary.outpatientAdded;
    if (added === 0) {
      // Still surface the report: even with nothing to add, the validation
      // checks (missing fellow, below-min staffing, ...) are worth showing.
      setDraftReport(report);
      updateState(state, "Generate draft: every cell that could be auto-filled is already covered — see the report below.");
      return;
    }
    const errs = report.summary.errorCount;
    const ok = window.confirm(
      `Generate a draft for "${block.name}"?\n\n` +
      `This fills ${added} open cell${added === 1 ? "" : "s"} (inpatient coverage + program rules), fairly and within the rules.` +
      (errs > 0 ? ` ${errs} day${errs === 1 ? "" : "s"} still can't be fully staffed and will be flagged.` : "") +
      `\n\nYour existing assignments are kept. You can edit everything afterward.`
    );
    if (!ok) return;
    setDraftReport(report);
    updateState(
      next,
      `Draft generated: ${added} cell${added === 1 ? "" : "s"} filled` +
      (errs > 0 ? `, ${errs} staffing gap${errs === 1 ? "" : "s"} flagged in the report` : "") + "."
    );
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
    <section className="panel full">
      <OverrideConfirmModal
        pending={pendingOverride}
        onConfirm={() => { pendingOverride?.onConfirm?.(); setPendingOverride(null); }}
        onCancel={() => { setPendingOverride(null); updateState(state, "Cancelled — kept the rotation profile."); }}
      />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Planning Grid</h2>
        <div className="planning-grid-header-actions">
          <button
            type="button"
            className="primary-button"
            onClick={runGenerateDraft}
            title="Auto-fill open inpatient/outpatient cells using the program rules. Never overwrites your manual edits."
          >
            Generate draft
          </button>
          <label className="planning-staff-toggle">
            <input
              type="checkbox"
              className="toggle-switch"
              checked={showStaffRows}
              onChange={(event) => setShowStaffRows(event.target.checked)}
            />
            <span>Staff rows</span>
          </label>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Active block: <strong>{block.name}</strong> · {block.startDate}–{block.endDate}
          </span>
        </div>
      </header>
      <div className="combined-tabs" role="tablist" aria-label="Planning views">
        {PLANNING_VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={planningView === tab.id}
            className={`combined-tab combined-tab-${tab.id}${planningView === tab.id ? " is-active" : ""}`}
            // Switching the row filter cancels any in-progress paint so a sweep
            // started in one view can't half-commit after the visible rows change.
            onClick={() => { setPlanningView(tab.id); setPaintOn(false); }}
          >
            <span className="combined-tab-label">{tab.label}</span>
            <span className="combined-tab-sub">{tab.sub}</span>
          </button>
        ))}
      </div>
      <p className="muted">
        Build the schedule for this block. Each cell is one day's assignment:
        green = IP, blue = OP, amber = unassigned, gray = off. Rows are grouped
        by completion state, so the people who still need work float to the top
        and split (Mixed) schedules get their own section. Use the
        Master / Inpatient / Outpatient tabs above to filter to only the
        rotators on each service.
        <strong> Drag a rotator name onto a cell to assign them inpatient</strong> —
        invalid drops (rotator off / out of range) won't land. Or
        <strong> turn on Paint mode</strong> to drag-select multiple days —
        Inpatient or Outpatient to assign, or <strong>Reset</strong> to clear
        whatever's already there back to unassigned.
      </p>
      <div className="paint-toolbar" role="toolbar" aria-label="Paint tool">
        <label className="paint-toolbar-toggle" style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={paintOn}
            onChange={(event) => setPaintOn(event.target.checked)}
          />
          <span className="paint-toolbar-label">Paint mode</span>
        </label>
        {paintOn && [
          // Tools shown only while Paint mode is on. There is no neutral
          // "Select" cursor anymore — switching the toggle off is the
          // not-painting state (paintMode resolves to "off", normal clicking).
          // paintTool defaults to "IP" so the toggle is never on with nothing
          // selected. #7: "Off" (id "offday") → applyRangeAssignment phase
          // "off" → role:"Off"/marked-off; "Reset" (id "clear") wipes a cell.
          { id: "IP", label: "Inpatient" },
          { id: "OP", label: "Outpatient" },
          { id: "offday", label: "Off" },
          { id: "clear", label: "Reset" }
        ].map((opt) => (
          <label key={opt.id} className={`paint-toolbar-option${paintTool === opt.id ? " is-active" : ""}`}>
            <input
              type="radio"
              name="paint-mode"
              checked={paintTool === opt.id}
              onChange={() => setPaintTool(opt.id)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
      {draftReport && (
        <div
          className="panel"
          role="status"
          style={{ borderLeft: "4px solid var(--accent)", margin: "0.5rem 0", padding: "0.75rem 1rem" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <strong>Draft report — {draftReport.summary.blockName}</strong>
            <button type="button" className="secondary-button" onClick={() => setDraftReport(null)}>
              Dismiss
            </button>
          </div>
          <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>
            Filled {draftReport.summary.inpatientAdded} inpatient and {draftReport.summary.outpatientAdded} outpatient
            {" "}cell{draftReport.summary.inpatientAdded + draftReport.summary.outpatientAdded === 1 ? "" : "s"}.
            {" "}{draftReport.summary.errorCount} error{draftReport.summary.errorCount === 1 ? "" : "s"},
            {" "}{draftReport.summary.warningCount} warning{draftReport.summary.warningCount === 1 ? "" : "s"}.
          </p>
          {draftReport.checks.length === 0 ? (
            <p style={{ margin: 0 }}>✓ No issues flagged — this draft meets every rule that can be checked.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {summarizeDraftChecks(draftReport.checks).map((line, i) => (
                <li key={i} style={{ margin: "0.15rem 0" }}>
                  <strong>{line.severity === "error" ? "⛔ " : "⚠ "}</strong>
                  {line.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={onlyThisBlock}
            onChange={(event) => setOnlyThisBlock(event.target.checked)}
          />
          <span>Only show providers active in this block</span>
        </label>
        {/* Always available and always exactly two weeks on either side. */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={peekBeforeBlock}
            onChange={(event) => setPeekBeforeBlock(event.target.checked)}
          />
          <span>{`Peek before block start (${PEEK_BUFFER_DAYS} days)`}</span>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", margin: 0 }}>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={peekPastBlock}
            onChange={(event) => setPeekPastBlock(event.target.checked)}
          />
          <span>{`Peek past block end (${PEEK_BUFFER_DAYS} days)`}</span>
        </label>
      </div>
      {/* Range-assign clamps to the RAW block, not effectiveBlock — peek is
          view-only, so the From/To range can't write into the peeked days. */}
      <RangeAssignForm state={state} block={block} updateState={updateState} />
      <CalendarLegendKey
        items={[
          { className: "planning-swatch planning-swatch-unassigned", label: "Available (no assignment)" },
          { className: "planning-swatch planning-swatch-ip", label: "IP — inpatient" },
          { className: "planning-swatch planning-swatch-op", label: "OP — outpatient" },
          { className: "planning-swatch planning-swatch-both", label: "Both (conflict)" },
          { className: "planning-swatch planning-swatch-markedoff", label: "Off (marked off)" },
          { className: "planning-swatch planning-swatch-off", label: "Unavailable (off-service)" },
          { className: "planning-swatch planning-swatch-absent", label: "Not in block" }
        ]}
      />
      <div className="planning-grid-wrap">
        <table className="planning-grid">
          <thead>
            <tr>
              <th className="planning-rowhead planning-sticky-col">Rotator</th>
              {dates.map((date, i) => {
                const wd = weekdayName(date);
                const isWeekend = wd === "Saturday" || wd === "Sunday";
                const isHoliday = (effectiveBlock?.holidays || []).some(
                  (h) => h && h.date === date && h.noClinic
                );
                // Days outside the ORIGINAL block are the "peek" window — tint
                // them, and draw a divider where the context meets the block.
                const isPeekBefore = !!(block?.startDate && date < block.startDate);
                const isPeekAfter = !!(block?.endDate && date > block.endDate);
                const isPeek = isPeekBefore || isPeekAfter;
                const isPeekStart = isPeekAfter && !(i > 0 && dates[i - 1] > block.endDate);
                const isPeekEnd = isPeekBefore && !(i + 1 < dates.length && dates[i + 1] < block.startDate);
                const headCls = [
                  "planning-datehead",
                  isWeekend ? "planning-datehead-weekend" : "",
                  isHoliday ? "planning-datehead-holiday" : "",
                  isPeek ? "planning-datehead-peek" : "",
                  isPeekStart ? "planning-datehead-peek-start" : "",
                  isPeekEnd ? "planning-datehead-peek-end" : ""
                ].filter(Boolean).join(" ");
                return (
                  <th
                    key={date}
                    className={headCls}
                    title={isPeek ? `${date} — outside this block` : (isHoliday ? `${date} — no-clinic holiday (OP blocked)` : date)}
                  >
                    <div className="planning-datehead-weekday">{wd.slice(0, 3)}</div>
                    <div className="planning-datehead-date">{formatMonthDay(date)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          {showStaffRows && staffRows.length > 0 && (
            <tbody className="planning-section planning-section-staff">
              <SectionHeader
                section={STAFF_PLANNING_SECTION}
                colSpan={dates.length + 1}
                count={staffRows.length}
                isCollapsed={!!collapsed.staff}
                onToggle={() => toggleSection("staff")}
              />
              {!collapsed.staff && staffRows.map(({ rotator, cells }) => {
                const isAttending = rotator.syntheticStaffRow === "attending";
                const continuityByWeekday = continuityWeekdayMap(rotator);
                return (
                  <tr
                    key={`staff-${rotator.id}`}
                    className={`planning-row planning-row-staff planning-row-${isAttending ? "attending" : "fellow"}`}
                    data-staff-row={isAttending ? "attending" : "fellow"}
                  >
                    {isAttending ? (
                      <StaticStaffRowHeader rotator={rotator} />
                    ) : (
                      <DraggableRotatorHeader rotator={rotator} />
                    )}
                    {cells.map((cell) => (
                      <PlanningCell
                        key={cell.date}
                        cell={cell}
                        state={state}
                        rotatorId={rotator.id}
                        paintMode={paintMode}
                        paintState={paintState}
                        paintDispatch={paintDispatch}
                        paintRotatorRef={paintRotatorRef}
                        onPaintCommit={commitPaintSelection}
                        outpatientBlocked={outpatientBlockedDates.has(cell.date)}
                        overrideBadge={!isAttending && overrideBadgeKeys.has(`${rotator.id}::${cell.date}`)}
                        continuityByWeekday={continuityByWeekday}
                        readOnly={isAttending || isOutsideRawBlock(cell.date)}
                        readOnlyReason={isAttending ? "staff" : "peek"}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          )}
          {PLANNING_SECTIONS.filter((section) =>
            planningSectionVisibleInView(section.id, planningView)
          ).map((section) => {
            const rowsInSection = sections[section.id];
            const colSpan = dates.length + 1;
            const isCollapsed = !!collapsed[section.id];
            return (
              <tbody key={section.id} className={`planning-section planning-section-${section.id}`}>
                <SectionHeader
                  section={section}
                  colSpan={colSpan}
                  count={rowsInSection.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleSection(section.id)}
                />
                {!isCollapsed && rowsInSection.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="planning-section-empty muted">
                      {section.id === "needs" && "Nobody is waiting for an assignment — every available day is set."}
                      {section.id === "mixed" && "No split schedules in this block."}
                      {section.id === "fullyIp" && "No one is fully inpatient for this block."}
                      {section.id === "fullyOp" && "No one is fully outpatient for this block."}
                      {section.id === "unavailable" && "Everyone is in the block."}
                    </td>
                  </tr>
                )}
                {!isCollapsed && rowsInSection.map(({ rotator, cells }) => {
                  const continuityByWeekday = continuityWeekdayMap(rotator);
                  return (
                    <tr key={rotator.id} className={`planning-row planning-row-${section.id}`}>
                      <DraggableRotatorHeader rotator={rotator} />
                      {cells.map((cell) => (
                        <PlanningCell
                          key={cell.date}
                          cell={cell}
                          state={state}
                          rotatorId={rotator.id}
                          paintMode={paintMode}
                          paintState={paintState}
                          paintDispatch={paintDispatch}
                          paintRotatorRef={paintRotatorRef}
                          onPaintCommit={commitPaintSelection}
                          outpatientBlocked={outpatientBlockedDates.has(cell.date)}
                          overrideBadge={overrideBadgeKeys.has(`${rotator.id}::${cell.date}`)}
                          continuityByWeekday={continuityByWeekday}
                          // Peek days (outside the ORIGINAL block) are view-only:
                          // visible + tinted so Coordinator can confirm continuity, but
                          // no paint/drag/range-assign lands there. Editing the next
                          // block from this view would be a separate feature.
                          readOnly={isOutsideRawBlock(cell.date)}
                        />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
          <tfoot>
              <tr className="planning-total-row planning-total-ip">
                <th className="planning-rowhead planning-sticky-col">Inpatient</th>
                {totals.map((t) => (
                  <td key={`ip-${t.date}`} className="planning-total-cell">
                    {t.ip || ""}
                  </td>
                ))}
              </tr>
              <tr className="planning-total-row planning-total-op">
                <th className="planning-rowhead planning-sticky-col">Outpatient</th>
                {totals.map((t) => (
                  <td key={`op-${t.date}`} className="planning-total-cell">
                    {t.op || ""}
                  </td>
                ))}
              </tr>
              <tr className="planning-total-row planning-total-unassigned">
                <th className="planning-rowhead planning-sticky-col">Unassigned</th>
                {totals.map((t) => (
                  <td
                    key={`un-${t.date}`}
                    className={`planning-total-cell${t.unassigned > 0 ? " has-gap" : ""}`}
                    title={t.unassigned > 0 ? `${t.unassigned} rotator${t.unassigned === 1 ? "" : "s"} present without an assignment` : ""}
                  >
                    {t.unassigned || ""}
                  </td>
                ))}
              </tr>
          </tfoot>
        </table>
      </div>
    </section>
    </DragDropProvider>
  );
}

// Draggable rotator header: wraps the row's <th> with @dnd-kit/react's
// useDraggable. The rotator's id is the source id. Dropping onto a
// planning cell triggers handleDragEnd in PlanningGridPage, which
// runs the chess-style validateDrop + applyDrop pure helpers.
function DraggableRotatorHeader({ rotator }) {
  const { ref, isDragging } = useDraggable({ id: rotator.id });
  // F1 — fellows are pinned at the top of the grid; mark them with a ★ so they
  // read as the always-on-service anchor (half IP / half OP) the rest of the
  // schedule is built around.
  const isFellow = isPediatricNeurologyFellow(rotator);
  return (
    <th
      ref={ref}
      className={`planning-rowhead planning-sticky-col planning-rowhead-draggable${isDragging ? " is-dragging" : ""}`}
      title={`${rotator.program} · ${rotator.level}${isFellow ? " · fellow (pinned)" : ""} — drag to assign inpatient`}
    >
      {isFellow && <span className="planning-fellow-star" aria-label="Fellow">★</span>}
      {rotator.displayName}
    </th>
  );
}

function StaticStaffRowHeader({ rotator }) {
  return (
    <th
      className="planning-rowhead planning-sticky-col planning-rowhead-staff planning-rowhead-attending"
      title={`${rotator.program} — read-only projection from outpatient sessions`}
    >
      {rotator.displayName}
    </th>
  );
}

// #5 Section-header drop target. The Fully Inpatient / Fully Outpatient /
// Mixed Assignments headers are droppable: dropping a dragged rotator on
// Inpatient/Outpatient writes a block-range paint (phase inpatient/outpatient);
// dropping on Mixed clears the block-range role so the days may mix. The
// "Needs Assignment" and "Not in block" headers are NOT droppable (no
// meaningful block-range action) — for those we render a plain header with no
// useDroppable ref. The hook must be unconditional, so it's hosted in this
// dedicated component (one instance per section) rather than inside the .map.
const SECTION_DROP_PHASE = { fullyIp: "inpatient", fullyOp: "outpatient", mixed: "clear" };
function SectionHeader({ section, colSpan, count, isCollapsed, onToggle }) {
  const droppable = SECTION_DROP_PHASE[section.id] != null;
  const { source: activeSource } = useDragOperation();
  const dragActive = typeof activeSource?.id === "string";
  const { ref, isDropTarget } = useDroppable({
    id: `section::${section.id}`,
    disabled: !droppable,
    data: { sectionId: section.id }
  });
  const dropHint = section.id === "fullyIp"
    ? "Drop a rotator here to set them inpatient for the whole block"
    : section.id === "fullyOp"
      ? "Drop a rotator here to set them outpatient for the whole block"
      : section.id === "mixed"
        ? "Drop a rotator here to clear their block role (days may then mix)"
        : null;
  const cls = [
    "planning-section-header",
    `planning-section-header-${section.id}`,
    droppable && dragActive ? "section-droppable" : "",
    isDropTarget ? "section-drop-active" : ""
  ].filter(Boolean).join(" ");
  return (
    <tr className={cls}>
      <th
        colSpan={colSpan}
        className="planning-sticky-col"
        ref={droppable ? ref : undefined}
        title={droppable && dragActive ? dropHint : undefined}
      >
        <button
          type="button"
          className="planning-section-toggle"
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          title={section.description}
        >
          <span className="planning-section-chevron">{isCollapsed ? "▶" : "▼"}</span>
          <span className="planning-section-title">{section.title}</span>
          <span className="planning-section-count">({count})</span>
          {droppable && dragActive && (
            <span className="planning-section-drophint">— drop to assign</span>
          )}
        </button>
      </th>
    </tr>
  );
}

// groupPlanningRowsBySection extracted to shared/scheduler/derived-views.js
// in Phase 3.2 of the frontend/backend refactor. See that module's
// JSDoc for the section-classification rules. The in-grid IP/OP filter
// (gridView state + rowHasPhase + rowVisibleInView + PLANNING_VIEWS)
// was removed in the 2026-05-22 tab-merge — the top-level Inpatient /
// Outpatient sidebar tabs now serve that purpose.

// Coordinator #3/#5: build a { weekday: ["AM"|"PM", ...] } map of a rotator's weekly
// continuity-clinic half-days, computed once per row so each planning cell can
// show a continuity marker on the matching weekday regardless of cell status.
function continuityWeekdayMap(rotator) {
  const map = {};
  for (const slot of parseContinuityClinicSlots(rotator?.continuityClinic)) {
    if (!map[slot.weekday]) map[slot.weekday] = [];
    map[slot.weekday].push(slot.period);
  }
  return map;
}

function PlanningCell({
  cell,
  state,
  rotatorId,
  paintMode,
  paintState,
  paintDispatch,
  paintRotatorRef,
  onPaintCommit,
  outpatientBlocked = false,
  overrideBadge = false,
  continuityByWeekday = null,
  readOnly = false,
  readOnlyReason = "peek"
}) {
  const wd = weekdayName(cell.date);
  // Continuity-clinic half-days for THIS weekday (Coordinator #3/#5): shown on the
  // cell no matter its IP/OP/Off status — the person is at clinic, unavailable.
  const continuityPeriods = (continuityByWeekday && continuityByWeekday[wd]) || [];
  // Read the active drag once (or no-op if there's no drag) — used to
  // mark this cell `disabled` when a drag is happening and validateDrop
  // says the drop would be invalid. @dnd-kit's collision detector
  // filters disabled cells out, so the chess-style "drop can't land"
  // mechanic falls out automatically.
  const { source: activeSource } = useDragOperation();
  const activeRotatorId = typeof activeSource?.id === "string" ? activeSource.id : null;
  const dropValidity = activeRotatorId && state
    ? validateDrop(state, activeRotatorId, cell.date)
    : { valid: true };
  const dragActive = activeRotatorId != null;
  const dropDisabled = dragActive && !dropValidity.valid;
  // The droppable id must be unique across the whole grid — the same
  // calendar date repeats in every rotator row and every section, so a
  // bare `cell.date` id registers hundreds of colliding droppables and
  // breaks @dnd-kit's id-keyed registry (no collision ever resolves).
  // Synthesize a unique id; carry the semantic date in `data` for the
  // drop handler.
  const { ref, isDropTarget } = useDroppable({
    id: `cell::${rotatorId}::${cell.date}`,
    // readOnly peek cells are never drop targets (view-only).
    disabled: dropDisabled || readOnly,
    data: { date: cell.date }
  });

  // Paint preview: highlight cells currently inside the active sweep.
  const paintActive = paintMode !== "off";
  // #6: outpatient weekend/holiday cells are not paintable. Gate OP paint
  // on this cell; IP/OFF/Reset stay paintable every day. readOnly peek cells
  // (past the block end) are never paintable — view-only.
  const paintBlocked = paintMode === "OP" && outpatientBlocked;
  const paintEnabled = paintActive && !paintBlocked && !readOnly;
  const inPaint =
    paintEnabled &&
    paintState?.isDragging &&
    paintRotatorRef?.current === rotatorId &&
    paintState.selected?.has(cell.date);

  // Cells are self-coloring: the cell's status (IP / OP / unassigned /
  // off / absent / both) drives the color directly.
  // #7: marked-off cells render in a distinct DARK color (vs the lighter
  // off-service slash). Keyed off the grid cell's reason, per contract §1a.
  const markedOff = cell.status === "off" && cell.reason === "marked-off";
  const cls = [
    "planning-cell",
    `planning-cell-${cell.status}`,
    markedOff ? "planning-cell-markedoff" : "",
    dragActive && !dropValidity.valid ? "drop-invalid" : "",
    isDropTarget ? "drop-target-active" : "",
    inPaint ? "paint-preview" : "",
    paintEnabled ? `paint-mode-${paintMode.toLowerCase()}` : "",
    paintBlocked ? "paint-blocked" : "",
    overrideBadge ? "has-override-badge" : "",
    continuityPeriods.length ? "has-continuity-badge" : "",
    readOnly ? "planning-cell-readonly" : "",
    readOnly && readOnlyReason === "staff" ? "planning-cell-staff-readonly" : "",
    readOnly && readOnlyReason !== "staff" ? "planning-cell-peek-readonly" : ""
  ].filter(Boolean).join(" ");

  // Paint event handlers: only attach when paint mode is on. Single-row
  // sweep — once the sweep starts in this rotator's row, only cells in
  // the same row count (paintRotatorRef gate).
  const paintHandlers = paintEnabled
    ? {
        onPointerDown: (event) => {
          if (event.button !== 0) return;
          paintRotatorRef.current = rotatorId;
          paintDispatch({ type: "down", date: cell.date, mode: paintMode });
          // Capture so we still get pointerup even if released outside the cell.
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
        },
        onPointerEnter: () => {
          if (!paintState?.isDragging) return;
          if (paintRotatorRef.current !== rotatorId) return; // ignore cross-row drift
          paintDispatch({ type: "enter", date: cell.date });
        },
        // setPointerCapture (in onPointerDown) routes ALL subsequent pointer
        // events to the start cell, so sibling cells' onPointerEnter never
        // fires — multi-day sweeps would otherwise only select the start day.
        // Resolve the cell under the pointer ourselves and feed the same
        // reducer "enter" action. Idempotent with onPointerEnter (Set dedupe).
        onPointerMove: (event) => {
          if (!paintState?.isDragging) return;
          if (paintRotatorRef.current !== rotatorId) return; // ignore cross-row drift
          const el = document.elementFromPoint(event.clientX, event.clientY);
          const date = el?.closest?.("[data-date]")?.getAttribute("data-date");
          if (date) paintDispatch({ type: "enter", date });
        },
        onPointerUp: () => {
          if (!paintState?.isDragging) return;
          const committedRotator = paintRotatorRef.current;
          const committedMode = paintState.mode;
          const committedSelection = new Set(paintState.selected);
          paintDispatch({ type: "up" });
          paintRotatorRef.current = null;
          if (committedRotator && committedMode && committedSelection.size > 0) {
            onPaintCommit?.(committedRotator, committedMode, committedSelection);
          }
        }
      }
    : {};

  // Body content varies by cell status. The droppable ref + handlers
  // are applied to the single outer <td> regardless of status, so
  // every cell can participate in drag-drop + paint.
  let body;
  let title;
  if (cell.status === "absent") {
    body = "";
    title = `Not in block on ${cell.date}`;
  } else if (cell.status === "off") {
    body = "OFF";
    title = cell.reason === "marked-off"
      ? "Marked off"
      : cell.reason === "day-off"
        ? `Day off (${cell.label || wd})`
        : cell.reason === "range"
          ? `Unavailable ${cell.label || cell.date}`
          : cell.reason === "weekend-op"
            ? `Off (outpatient — clinic doesn't run ${wd})`
            : "Off";
  } else if (cell.status === "inpatient") {
    const role = cell.ip?.[0]?.role && cell.ip[0].role !== "Resident" ? ` (${cell.ip[0].role})` : "";
    body = "IP";
    title = `Inpatient${role} on ${cell.date}`;
  } else if (cell.status === "outpatient") {
    const summary = outpatientSessionTitle(cell);
    body = outpatientCellBody(cell);
    title = summary ? `${summary} on ${cell.date}` : `Outpatient on ${cell.date}`;
  } else if (cell.status === "both") {
    body = "IP+OP";
    title = `Both inpatient AND outpatient scheduled on ${cell.date} — see Conflicts page`;
  } else {
    body = "—";
    title = `Available but unassigned on ${cell.date}`;
  }

  // #2 persistent profile-override badge: this cell holds a manual paint/drop
  // that knowingly contradicts the rotation profile (warn-and-allow).
  const overrideTitle = overrideBadge
    ? " · overrides rotation profile (kept)"
    : "";
  // OP paint refused on this cell (weekend / no-clinic holiday).
  const blockedTitle = paintBlocked
    ? " · outpatient not available this day (weekend/holiday)"
    : "";
  const readOnlyTitle = readOnly
    ? (readOnlyReason === "staff" ? " · staff projection (view only)" : " · outside this block (view only)")
    : "";
  // #3/#5: continuity clinic is a standing weekly commitment — surface it in the
  // hover even when the cell shows IP/OP, so the team knows why they're missing.
  const continuityTitle = continuityPeriods.length
    ? ` · continuity clinic ${continuityPeriods.join(" & ")} (unavailable that half-day)`
    : "";
  const cellTitle = dragActive && !dropValidity.valid
    ? dropValidity.reason
    : `${title}${overrideTitle}${blockedTitle}${readOnlyTitle}${continuityTitle}`;

  return (
    <td
      ref={ref}
      className={cls}
      data-date={cell.date}
      title={cellTitle}
      {...paintHandlers}
    >
      {body}
      {overrideBadge && (
        <span className="planning-cell-override-badge" aria-label="Overrides rotation profile" title="Overrides the rotation profile (kept)">!</span>
      )}
      {continuityPeriods.length > 0 && (
        <span
          className="planning-cell-continuity-badge"
          aria-label={`Continuity clinic ${continuityPeriods.join(" & ")}`}
          title={`Continuity clinic ${continuityPeriods.join(" & ")} — unavailable that half-day`}
        >
          {continuityPeriods.length === 2 ? "C" : continuityPeriods[0]}
        </span>
      )}
    </td>
  );
}

// "2026-05-04" → "5/4". Compact for narrow grid columns; full ISO date
// stays on the cell title attribute for hover disambiguation.
function formatMonthDay(iso) {
  if (!iso || iso.length < 10) return iso || "";
  const month = parseInt(iso.slice(5, 7), 10);
  const day = parseInt(iso.slice(8, 10), 10);
  return `${month}/${day}`;
}

// Top-of-planning-grid form for Coordinator's "assign IP or OP by date range"
// flow. Picks one rotator + date range + phase (IP / OP / Clear) and routes
// through applyRangeAssignment, which writes only to inpatientAssignments
// and outpatientSessions — never touches segments or defaultPhase. The
// preview-then-toast pattern keeps the helper's mutator contract clean
// while still surfacing skipped-day counts and clamp notes in the toast.
function RangeAssignForm({ state, block, updateState }) {
  const [rotatorId, setRotatorId] = useState(state.rotators[0]?.id || "");
  const [startDate, setStartDate] = useState(block.startDate);
  const [endDate, setEndDate] = useState(block.endDate);
  const [phase, setPhase] = useState("inpatient");

  // Keep the rotator selection valid if the roster mutates from elsewhere.
  useEffect(() => {
    if (!state.rotators.some((r) => r.id === rotatorId)) {
      setRotatorId(state.rotators[0]?.id || "");
    }
  }, [state.rotators, rotatorId]);

  // When the active block changes (user switches blocks via the top-bar
  // BlockSwitcher), reset the date range to the new block's window so
  // the form doesn't silently show stale dates outside the new block.
  // Without this, previewRangeAssignment would clamp the user's old
  // dates to the new block and produce "no applicable days" with no
  // hint that the inputs themselves were the problem.
  // Key the reset on the block IDENTITY, not its dates. effectiveBlock keeps
  // the same id when peek extends its end, so toggling "Peek past block end"
  // no longer clobbers a From/To range the user is composing — only an actual
  // block switch (new id) resets the inputs.
  useEffect(() => {
    setStartDate(block.startDate);
    setEndDate(block.endDate);
  }, [block.id]);

  const preview = useMemo(
    () => previewRangeAssignment(state, block, { rotatorId, startDate, endDate }),
    [state, block, rotatorId, startDate, endDate]
  );

  const rotator = state.rotators.find((r) => r.id === rotatorId);
  const datesValid = startDate && endDate && startDate <= endDate;
  const applyDisabled = !rotator || !datesValid || preview.applyDates.length === 0;

  function apply() {
    if (applyDisabled) return;
    const result = executeSchedulerCommand(state, {
      type: "assign.range",
      input: { rotatorRef: rotatorId, blockRef: block.id, startDate, endDate, phase }
    });
    if (!result.ok) {
      updateState(state, result.error.message);
      return;
    }
    if (!result.changed) {
      updateState(state, "No changes — all dates were skipped or outside the block.");
      return;
    }
    const dayWord = (n) => `${n} day${n === 1 ? "" : "s"}`;
    const applied = preview.applyDates.length;
    const skipped = preview.skippedDates.length;
    const rangeStr = `${formatMonthDay(preview.clampedStart)}–${formatMonthDay(preview.clampedEnd)}`;
    const verb = phase === "clear"
      ? `Cleared ${rotator.displayName}`
      : `Set ${rotator.displayName} to ${phase === "inpatient" ? "IP" : "OP"}`;
    let msg = `${verb} for ${rangeStr}`;
    msg += skipped > 0
      ? ` — ${dayWord(applied)}, ${skipped} skipped (off or absent)`
      : ` (${dayWord(applied)})`;
    if (preview.wasClamped) {
      msg += `; clamped from ${formatMonthDay(startDate)}–${formatMonthDay(endDate)}`;
    }
    updateState(result.state, msg);
  }

  return (
    <div className="range-assign-form">
      <div className="range-assign-header">
        <strong>Range assign</strong>
        <span className="muted">
          Pick a rotator and a date range, then set them to IP, OP, or clear. Off and absent days are skipped automatically.
        </span>
      </div>
      <div className="range-assign-fields">
        <label>
          Rotator
          <select value={rotatorId} onChange={(event) => setRotatorId(event.target.value)}>
            {state.rotators.map((r) => (
              <option key={r.id} value={r.id}>{r.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <fieldset className="range-assign-phase">
          <legend>Phase</legend>
          <label className="range-assign-radio">
            <input type="radio" name="range-phase" value="inpatient" checked={phase === "inpatient"} onChange={() => setPhase("inpatient")} />
            <span>IP</span>
          </label>
          <label className="range-assign-radio">
            <input type="radio" name="range-phase" value="outpatient" checked={phase === "outpatient"} onChange={() => setPhase("outpatient")} />
            <span>OP</span>
          </label>
          <label className="range-assign-radio">
            <input type="radio" name="range-phase" value="clear" checked={phase === "clear"} onChange={() => setPhase("clear")} />
            <span>Clear</span>
          </label>
        </fieldset>
        <button
          type="button"
          className="primary-button range-assign-apply"
          onClick={apply}
          disabled={applyDisabled}
        >
          Apply
        </button>
      </div>
      {rotator && datesValid && preview.applyDates.length === 0 && (
        <p className="muted range-assign-empty">
          No matching days — {rotator.displayName} is absent or off for the entire selected range.
        </p>
      )}
      {preview.wasClamped && datesValid && (
        <p className="muted range-assign-clamp-note">
          {/* "block" word dropped: with "Peek past block end" on, the clamp
              ceiling is the extended (effective) window, so the range can run
              past the block. The shown dates are the real applied window. */}
          Range clamped to {formatMonthDay(preview.clampedStart)}–{formatMonthDay(preview.clampedEnd)}.
        </p>
      )}
    </div>
  );
}

function InpatientPage({ state, block, conflicts, updateState }) {
  const [date, setDate] = useState(() => clampDateToBlock(localToday(), block));
  const [rotatorId, setRotatorId] = useState(state.rotators[0]?.id || "");
  const [role, setRole] = useState("Resident");
  const [expandedDate, setExpandedDate] = useState(null);
  const dates = dateRange(block.startDate, block.endDate);
  const conflictsByDate = useMemo(() => indexConflictsByDate(conflicts), [conflicts]);
  const methodistCount = state.rotators.filter((r) => r.schoolType === "methodist").length;

  function assign() {
    updateStateFromCommand(
      state,
      updateState,
      { type: "inpatient.assign", input: { date, rotatorRef: rotatorId, role } },
      "Inpatient assignment saved in app data."
    );
  }

  function runMethodistAuto() {
    updateStateFromCommand(state, updateState, {
      type: "methodist.auto",
      input: { blockRef: block.id },
    });
  }

  // Auto-draft. Routes through the SAME generateDraft engine as the Planning
  // Grid "Generate draft" button (A1) so the two entry points can never drift
  // apart. generateDraft seeds every program + fair-fills inpatient coverage
  // and never overwrites an existing assignment. Below-min staffing days land
  // in the report and surface on the Conflicts page after commit.
  function runDraft() {
    const { state: next, report } = generateDraft(state, block);
    const added = report.summary.inpatientAdded + report.summary.outpatientAdded;
    const errs = report.summary.errorCount;
    if (added === 0) {
      updateState(state, "Generate draft: every cell that could be auto-filled is already covered — nothing to add.");
      return;
    }
    const gapNote = errs > 0
      ? ` ${errs} day${errs === 1 ? "" : "s"} can't be fully staffed with the current roster and will show on the Conflicts page.`
      : "";
    const ok = window.confirm(
      `Generate a draft for "${block.name}"?\n\n` +
      `This fills ${added} open cell${added === 1 ? "" : "s"} (inpatient coverage + program rules), fairly and within the rules.` +
      gapNote +
      `\n\nYour existing assignments are kept. You can edit everything afterward.`
    );
    if (!ok) return;
    updateState(
      next,
      `Draft generated: ${added} cell${added === 1 ? "" : "s"} filled${errs ? `, ${errs} staffing gap${errs === 1 ? "" : "s"} flagged in Conflicts` : ""}.`
    );
  }

  return (
    <div className="form-calendar">
      <section className="panel">
        <h2>Manual Assignment</h2>
        <div className="form-grid single">
          <TextField label="Date" type="date" value={date} onChange={setDate} />
          <RotatorSelect state={state} value={rotatorId} onChange={setRotatorId} activeOnDate={date} phase="inpatient" />
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option>Resident</option>
              <option>Team senior</option>
              <option>Fellow</option>
              <option>AM clinic pull-out</option>
              <option>PM clinic pull-out</option>
              <option>Academic half-day</option>
              <option>Off</option>
            </select>
          </label>
          <button className="primary-button" onClick={assign}>Assign inpatient</button>
        </div>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Roles drive how the calendar shows each person. Use Team senior, Fellow, or AM/PM pull-out
          when you need that label to appear in the day cell.
        </p>
        {methodistCount > 0 && (
          <div className="form-grid single" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
            <button className="secondary-button" onClick={runMethodistAuto}>
              Generate Methodist schedule ({methodistCount} provider{methodistCount === 1 ? "" : "s"})
            </button>
            <p className="muted">
              Auto-fills 14 days outpatient + 14 days inpatient for each Methodist provider based on
              their own 28-day rotation start. Manual assignments you already made stay untouched.
            </p>
          </div>
        )}
        <div className="form-grid single" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" }}>
          <button className="secondary-button" onClick={runDraft}>
            Generate draft schedule
          </button>
          <p className="muted">
            Auto-fills open inpatient days from each day's coverage demand — fairly and within the rules
            (availability, no double-booking, up to {state.rules?.maxConsecutiveInpatientDays ?? 6} days in a row).
            Existing assignments are kept; any day it can't staff appears on the Conflicts page. Set the
            per-day demand on the Block Setup page.
          </p>
        </div>
      </section>
      <section className="panel wide">
        <h2>Inpatient Calendar</h2>
        <CalendarLegendKey
          items={[
            { className: "calendar-pill calendar-pill-on", label: "ON service" },
            { className: "calendar-pill calendar-pill-off", label: "OFF / unavailable" },
            { className: "calendar-pill calendar-pill-am", label: "AM clinic pull-out" },
            { className: "calendar-pill calendar-pill-pm", label: "PM clinic pull-out" },
            { className: "calendar-pill calendar-pill-senior", label: "Team senior" },
            { className: "calendar-pill calendar-pill-fellow", label: "Fellow" }
          ]}
        />
        <WeekHeader />
        <div className="calendar-grid calendar-grid-week-aligned">
          {leadingBlankCells(dates[0])}
          {dates.map((day) => (
            <InpatientDayCell
              key={day}
              date={day}
              state={state}
              conflictsByDate={conflictsByDate}
              expanded={expandedDate === day}
              onToggle={() => setExpandedDate(expandedDate === day ? null : day)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// #2 (Coordinator 2026-06-02): confirm popup shown when a paint/drop contradicts a
// rotator's imported rotation profile. Two choices, in Coordinator's own words:
// "Change from original preference" (commit the override) and "Cancel action"
// (keep the profile, change nothing). Reuses the app's modal-overlay/-card
// pattern (matches ImportConfirm) and the .action-bar button footer.
function OverrideConfirmModal({ pending, onConfirm, onCancel }) {
  const headingRef = useRef(null);
  useEffect(() => {
    if (pending) headingRef.current?.focus();
  }, [pending]);
  if (!pending) return null;
  const warnings = pending.warnings || [];
  const n = warnings.length;
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Change from the rotation profile?"
      onClick={onCancel}
      onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
    >
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2 tabIndex={-1} ref={headingRef}>Change from original preference?</h2>
            <p className="muted">
              This differs from the imported rotation profile on {n} day{n === 1 ? "" : "s"}.
            </p>
          </div>
        </header>
        <div className="modal-body">
          <ul className="override-confirm-list">
            {warnings.map((w) => (
              <li key={`${w.rotatorId}::${w.date}`}>
                <strong>{formatMonthDay(w.date)}</strong> ({weekdayName(w.date)}): profile says{" "}
                <em>{w.profilePhase}</em>, you're setting <em>{w.attemptedPhase}</em>.
              </li>
            ))}
          </ul>
          <div className="action-bar" style={{ marginTop: "1rem", gap: "0.5rem" }}>
            <button className="primary-button" onClick={onConfirm}>
              Change from original preference
            </button>
            <button className="secondary-button" onClick={onCancel}>
              Cancel action
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContinuityClinicBadges({ state, date }) {
  const buckets = continuityClinicsForDate(state, date);
  if (buckets.AM.length === 0 && buckets.PM.length === 0) return null;

  const firstName = (rotator) => rotator.displayName.split(/\s+/)[0];

  return (
    <div className="clinic-strip" aria-label="Continuity clinic coverage gap">
      {buckets.AM.map((rotator) => (
        <span
          key={`am-${rotator.id}`}
          className="clinic-chip clinic-chip-am"
          title={`${rotator.displayName} has AM continuity clinic`}
        >
          {firstName(rotator)} · AM
        </span>
      ))}
      {buckets.PM.map((rotator) => (
        <span
          key={`pm-${rotator.id}`}
          className="clinic-chip clinic-chip-pm"
          title={`${rotator.displayName} has PM continuity clinic`}
        >
          {firstName(rotator)} · PM
        </span>
      ))}
    </div>
  );
}

function OutpatientPage({ state, block, conflicts, updateState }) {
  const attendings = state.attendings || [];
  const [date, setDate] = useState(() => clampDateToBlock(localToday(), block));
  const [period, setPeriod] = useState("AM");
  const [clinic, setClinic] = useState("Continuity Clinic");
  const [provider, setProvider] = useState(attendings[0]?.name || "");
  const [rotatorIds, setRotatorIds] = useState(state.rotators[0]?.id ? [state.rotators[0].id] : []);
  const [expandedDate, setExpandedDate] = useState(null);
  const allDates = dateRange(block.startDate, block.endDate);
  const weekdayDates = allDates.filter((d) => {
    const w = new Date(`${d}T00:00:00`).getDay();
    return w !== 0 && w !== 6;
  });
  const conflictsByDate = useMemo(() => indexConflictsByDate(conflicts), [conflicts]);
  const activeRotators = activeRotatorsOn(state, date).filter(
    (r) => getRotatorSegmentPhase(r, date) !== "inpatient"
  );
  const dropdownRotators = activeRotators.length > 0 ? activeRotators : state.rotators;
  const availableAttendings = attendingsAvailableOn(state, date, period);
  const attendingOptions = availableAttendings.length > 0 ? availableAttendings : attendings;
  const showingFilteredAttendings = availableAttendings.length > 0 && availableAttendings.length < attendings.length;

  // When date or period changes, the set of valid attendings and active
  // rotators changes too. If the current `provider` is no longer in the
  // dropdown's option list, the browser quietly displays the first
  // option but React's controlled value still holds the stale name —
  // clicking Save would record the session against an attending who has
  // no clinic that period. Same idea for `rotatorIds`: a rotator that
  // was active on date X may not be active on date Y; without pruning,
  // the save loop would schedule them anyway.
  useEffect(() => {
    if (provider && !attendingOptions.some((a) => a.name === provider)) {
      setProvider(attendingOptions[0]?.name || "");
    }
  }, [provider, attendingOptions]);
  useEffect(() => {
    const validIds = new Set(dropdownRotators.map((r) => r.id));
    setRotatorIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [dropdownRotators]);

  function assign() {
    const ids = rotatorIds.filter(Boolean);
    if (ids.length === 0) {
      // Fall back to keeping the previous single-rotator behavior when
      // nothing's selected — record an empty rotator session if user
      // really wants no one assigned (rare but allowed).
      updateState(
        scheduleOutpatientSession(state, { date, period, clinic, provider, rotatorId: "" }),
        "Outpatient session saved in app data."
      );
      return;
    }
    let next = state;
    for (const rid of ids) {
      const result = executeSchedulerCommand(next, {
        type: "outpatient.assign",
        input: { date, period, clinic, provider, rotatorRef: rid }
      });
      if (!result.ok) {
        updateState(next, result.error.message);
        return;
      }
      next = result.state;
    }
    const verb = ids.length === 1 ? "session" : `${ids.length} sessions`;
    updateState(next, `Outpatient ${verb} saved in app data.`);
  }

  function toggleRotator(rid) {
    setRotatorIds((prev) => prev.includes(rid) ? prev.filter((x) => x !== rid) : [...prev, rid]);
  }

  return (
    <div className="form-calendar">
      <section className="panel">
        <h2>Clinic Session</h2>
        <div className="form-grid single">
          <TextField label="Date" type="date" value={date} onChange={setDate} />
          <label>
            Period
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option>AM</option>
              <option>PM</option>
            </select>
          </label>
          <TextField label="Clinic" value={clinic} onChange={setClinic} />
          <label>
            Attending{showingFilteredAttendings ? ` (showing ${availableAttendings.length} with ${period} clinic on ${date})` : ""}
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {attendings.length === 0 && <option value="">— add attendings on Configuration tab —</option>}
              {attendingOptions.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </label>
          <label>
            Rotators ({rotatorIds.length} selected){activeRotators.length < state.rotators.length ? ` — showing ${activeRotators.length} active on ${date}` : ""}
            <div style={{ display: "grid", gap: "4px", maxHeight: "180px", overflow: "auto", border: "1px solid var(--line)", borderRadius: "6px", padding: "8px" }}>
              {dropdownRotators.length === 0 ? (
                <span className="muted">No providers in the roster yet.</span>
              ) : (
                dropdownRotators.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text)", margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={rotatorIds.includes(r.id)}
                      onChange={() => toggleRotator(r.id)}
                    />
                    <span>{r.displayName}</span>
                  </label>
                ))
              )}
            </div>
          </label>
          <button className="primary-button" onClick={assign}>Save session{rotatorIds.length > 1 ? `s (${rotatorIds.length})` : ""}</button>
        </div>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Pick one or more rotators to record working with this attending at the same time.
          The attending list is managed on the Configuration tab.
        </p>
      </section>
      <div className="panel-stack">
        <section className="panel">
          <h2>Outpatient Calendar</h2>
          <CalendarLegendKey
            items={[
              { className: "calendar-pill calendar-pill-am", label: "AM clinic" },
              { className: "calendar-pill calendar-pill-pm", label: "PM clinic" },
              { className: "calendar-pill calendar-pill-student", label: "Medical student" },
              { className: "calendar-pill calendar-pill-fellow", label: "Fellow clinic" },
              { className: "calendar-pill calendar-pill-cme", label: "CME" },
              { className: "calendar-pill calendar-pill-staytuned", label: "Stay tuned" },
              { className: "calendar-pill calendar-pill-noclinic", label: "No clinic" }
            ]}
          />
          <WeekHeader weekdayOnly />
          <div className="calendar-grid calendar-grid-outpatient">
            {leadingBlankCells(weekdayDates[0], true)}
            {weekdayDates.map((day) => (
              <OutpatientDayCell
                key={day}
                date={day}
                state={state}
                conflictsByDate={conflictsByDate}
                expanded={expandedDate === day}
                onToggle={() => setExpandedDate(expandedDate === day ? null : day)}
              />
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Outpatient Sessions</h2>
          <Table
            columns={["Date", "Period", "Clinic", "Provider", "Rotator"]}
            emptyMessage="No outpatient sessions recorded yet — add one above."
            rows={state.outpatientSessions.map((item) => [
              item.date,
              item.period,
              item.clinic,
              item.provider,
              getRotator(state, item.rotatorId)?.displayName ?? "[Removed]"
            ])}
          />
        </section>
      </div>
    </div>
  );
}

function DailyReportPage({ state, block }) {
  const [date, setDate] = useState(() => clampDateToBlock(localToday(), block));
  const [copied, setCopied] = useState(false);
  const report = generateDailyReport(state, date);
  const dates = dateRange(block.startDate, block.endDate);

  // Copy the summary to the local clipboard. navigator.clipboard is a
  // machine-local API (no network); available on localhost. Falls back
  // silently if unavailable so the button never throws.
  async function copySummary() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. denied permission) — no-op */
    }
  }

  return (
    <div className="page-flex">
      <section className="panel">
        <h2>Report Date</h2>
        <label>
          Date
          <select value={date} onChange={(event) => setDate(event.target.value)}>
            {dates.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </section>
      <section className="panel wide">
        <div className="panel-head-row">
          <h2>Copyable Daily Summary</h2>
          <button type="button" className="copy-btn" onClick={copySummary}>
            {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="report-box">{report}</pre>
      </section>
    </div>
  );
}

function ConflictsPage({ conflicts, setPage }) {
  // Group conflicts by date for scannability, preserving the order each
  // date first appears in detectConflicts() output so the layout is stable.
  const groups = [];
  const groupIndexByDate = new Map();
  for (const item of conflicts) {
    let idx = groupIndexByDate.get(item.date);
    if (idx === undefined) {
      idx = groups.length;
      groupIndexByDate.set(item.date, idx);
      groups.push({ date: item.date, items: [] });
    }
    groups[idx].items.push(item);
  }

  return (
    <section className="panel full">
      <h2>Conflict Review</h2>
      {conflicts.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 size={26} />
          No open conflicts detected.
        </div>
      ) : (
        <div className="conflicts-list">
          <div className="conflict-summary">
            {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
          </div>
          {groups.map((group) => (
            <div key={group.date} className="conflict-group">
              <div className="conflict-date conflict-group-label">{group.date}</div>
              {group.items.map((item) => {
                const target = focusTargetForConflict(item);
                return (
                  <div key={item.id} className={`conflict-row severity-${item.severity.toLowerCase()}`}>
                    <div className="conflict-row-header">
                      <strong className="conflict-title">{item.title}</strong>
                      {target && setPage && (
                        <button
                          type="button"
                          className="secondary-button conflict-jump-button"
                          onClick={() => setPage(target.page)}
                          title={`Jump to the ${target.page} page to fix this`}
                        >
                          Jump to {target.page} →
                        </button>
                      )}
                    </div>
                    <div className="conflict-detail">{item.detail}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LegendPage({ state, block }) {
  const legend = useMemo(() => generateLegend(state, block), [state, block]);

  return (
    <section className="panel full">
      <h2>Rotator Legend</h2>
      <p className="muted">
        Numbered roster for this block. Use these numbers in compact calendar
        cells (for example, "ON: 1, 3, Fellow"). Fellows and medical students
        appear with their role instead of a number.
      </p>
      {legend.entries.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 size={26} />
          No rotators are active in this block yet.
        </div>
      ) : (
        <Table
          columns={["Number", "Provider", "Dates", "Continuity Clinic"]}
          rows={legend.entries.map((entry) => [
            entry.number,
            entry.displayLabel,
            entry.dateRange,
            entry.continuityClinic || "None"
          ])}
        />
      )}
    </section>
  );
}

function RulesPage({ state, updateState }) {
  const rules = state.rules;

  function patch(key, value) {
    updateStateFromCommand(
      state,
      updateState,
      { type: "rules.patch", input: { patch: { [key]: value } } },
      "Rules saved in app data."
    );
  }

  return (
    <div className="page-flex">
      {/* The "Methodist Rule" panel held a single "Outpatient first for 28-day
          split" checkbox that controlled nothing (the 14/14 split is fixed by
          spec §9.1 in getRotatorPhase). It was removed 2026-06-01 (decision D2:
          start-side is staffing-driven, not a user toggle). */}
      <section className="panel">
        <h2>Coverage Rules</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={rules.honorNoClinicHolidays}
            onChange={(event) => patch("honorNoClinicHolidays", event.target.checked)}
          />
          <span>Honor no-clinic holidays</span>
        </label>
        <TextField
          label="Max consecutive inpatient days"
          type="number"
          value={rules.maxConsecutiveInpatientDays}
          onChange={(value) => patch("maxConsecutiveInpatientDays", Number(value))}
        />
      </section>
      <section className="panel panel-info wide">
        <h2>Rule Impact Preview</h2>
        <p className="muted">
          The app currently flags two kinds of problems: a provider scheduled in two places at once,
          and clinics scheduled on no-clinic holidays. More advanced rule checking is planned for a
          future update.
        </p>
      </section>
    </div>
  );
}

function ConfigurationPage({ state, updateState, setNotice }) {
  const [newAttending, setNewAttending] = useState("");
  const [newProgram, setNewProgram] = useState("");
  const attendings = state.attendings || [];
  const expected = state.expectedSourcePrograms || [];
  const submittedPrograms = new Set((state.sources || []).map((s) => s.program));
  const missingPrograms = expected.filter((p) => !submittedPrograms.has(p));

  function addAttending() {
    const name = newAttending.trim();
    if (!name) return;
    if (attendings.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      setNotice(`${name} is already in the attendings list.`);
      return;
    }
    const next = [...attendings, { name, recurringClinics: [], oneOffDates: [] }];
    updateState(setAttendings(state, next), `Added ${name} to the attendings list.`);
    setNewAttending("");
  }

  function removeAttending(name) {
    const ok = window.confirm(`Remove ${name} from the attendings list? Past outpatient sessions that used this name stay unchanged.`);
    if (!ok) return;
    updateState(setAttendings(state, attendings.filter((a) => a.name !== name)), `Removed ${name} from the attendings list.`);
  }

  function updateAttending(name, patch) {
    const next = attendings.map((a) => a.name === name ? { ...a, ...patch } : a);
    updateState(setAttendings(state, next), `${name}'s clinic schedule updated.`);
  }

  function addExpectedProgram() {
    const name = newProgram.trim();
    if (!name) return;
    if (expected.includes(name)) {
      setNotice(`${name} is already in the expected sources list.`);
      return;
    }
    updateState(setExpectedSourcePrograms(state, [...expected, name]), `Added ${name} to expected sources.`);
    setNewProgram("");
  }

  function removeExpectedProgram(name) {
    updateState(setExpectedSourcePrograms(state, expected.filter((p) => p !== name)), `Removed ${name} from expected sources.`);
  }

  return (
    <div className="page-flex">
      <section className="panel wide">
        <h2>Attendings</h2>
        <p className="muted">
          The attending physicians who staff your clinics. For each one, mark which weekdays and AM/PM they normally have clinic. The Attending dropdown on the Outpatient form filters to people available on the selected date and period. Add one-off clinic dates for random extra days outside the recurring pattern.
        </p>
        <div className="dense-list" style={{ marginBottom: "12px" }}>
          {attendings.length === 0 ? (
            <p className="muted">No attendings yet. Add some below.</p>
          ) : (
            attendings.map((attending) => (
              <AttendingProfileEditor
                key={attending.name}
                attending={attending}
                onChange={(patch) => updateAttending(attending.name, patch)}
                onRemove={() => removeAttending(attending.name)}
              />
            ))
          )}
        </div>
        <div className="form-grid single">
          <TextField label="Add attending" value={newAttending} onChange={setNewAttending} />
          <button type="button" className="primary-button" onClick={addAttending} disabled={!newAttending.trim()}>
            Add
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>
          Expected Sources
          {expected.length > 0 && (
            <span
              className={missingPrograms.length > 0 ? "chip chip-warn" : "chip chip-ok"}
              style={{ marginLeft: "8px" }}
            >
              {missingPrograms.length > 0
                ? `${missingPrograms.length} of ${expected.length} still missing`
                : "All sources in"}
            </span>
          )}
        </h2>
        <p className="muted">
          The training programs you expect to receive rosters from. Each one is
          marked below and on the Dashboard so you know when you have everything
          to build the schedule.
        </p>
        <div className="dense-list" style={{ marginBottom: "12px" }}>
          {expected.length === 0 ? (
            <p className="muted">No expected sources defined yet.</p>
          ) : (
            expected.map((name) => {
              const submitted = submittedPrograms.has(name);
              return (
                <div key={name} className="list-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>
                    {name}
                    {submitted ? (
                      <span className="chip chip-ok" style={{ marginLeft: "8px" }}>✓ submitted</span>
                    ) : (
                      <span className="chip chip-warn" style={{ marginLeft: "8px" }}>still missing</span>
                    )}
                  </span>
                  <button type="button" className="link-button" onClick={() => removeExpectedProgram(name)}>
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="form-grid single">
          <TextField label="Add expected source program" value={newProgram} onChange={setNewProgram} />
          <button type="button" className="primary-button" onClick={addExpectedProgram} disabled={!newProgram.trim()}>
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

// DEF-1: clinic slots may carry their AM/PM under the current `period` key or the
// legacy `session` key. clinic-selectors.js reads `slot.session ?? slot.period`, so the
// editor must use the same accessor — otherwise `session`-keyed clinics (as the seed and
// older imports store them) render UNCHECKED even though the scheduler honors them.
// Exported as pure helpers so the read/toggle/normalize logic is unit-tested in isolation.
export function clinicSlotPeriod(slot) {
  return slot?.session ?? slot?.period ?? null;
}

export function hasRecurringClinic(recurring, weekday, period) {
  return (Array.isArray(recurring) ? recurring : []).some(
    (s) => s.weekday === weekday && clinicSlotPeriod(s) === period
  );
}

export function toggleRecurringClinic(recurring, weekday, period) {
  const list = Array.isArray(recurring) ? recurring : [];
  return hasRecurringClinic(list, weekday, period)
    ? list.filter((s) => !(s.weekday === weekday && clinicSlotPeriod(s) === period))
    : [...list, { weekday, period }];
}

// Editing a one-off's period must collapse the legacy `session` key, or `session ?? period`
// keeps returning the stale value and the <select> snaps back, fighting the user.
export function normalizeOneOffPeriod(slot, period) {
  const next = { ...slot, period };
  delete next.session;
  return next;
}

function AttendingProfileEditor({ attending, onChange, onRemove }) {
  const recurring = Array.isArray(attending.recurringClinics) ? attending.recurringClinics : [];
  const oneOffs = Array.isArray(attending.oneOffDates) ? attending.oneOffDates : [];

  function toggleRecurring(weekday, period) {
    onChange({ recurringClinics: toggleRecurringClinic(recurring, weekday, period) });
  }

  function addOneOff() {
    onChange({ oneOffDates: [...oneOffs, { date: "", period: "AM" }] });
  }

  function updateOneOff(index, patch) {
    onChange({
      oneOffDates: oneOffs.map((s, i) => i === index ? { ...s, ...patch } : s)
    });
  }

  function changeOneOffPeriod(index, period) {
    onChange({
      oneOffDates: oneOffs.map((s, i) => i === index ? normalizeOneOffPeriod(s, period) : s)
    });
  }

  function removeOneOff(index) {
    onChange({ oneOffDates: oneOffs.filter((_, i) => i !== index) });
  }

  return (
    <div className="panel" style={{ padding: "0.75rem", marginBottom: "0.5rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{attending.name}</h3>
        <button type="button" className="link-button" onClick={onRemove}>Remove</button>
      </header>
      <div style={{ marginTop: "0.5rem" }}>
        <strong>Recurring clinic days</strong>
        <div style={{ display: "grid", gridTemplateColumns: "auto repeat(7, 1fr)", gap: "4px", marginTop: "0.25rem", fontSize: "0.85rem" }}>
          <span></span>
          {WEEKDAYS.map((day) => <span key={day} style={{ textAlign: "center" }}>{day.slice(0, 3)}</span>)}
          {["AM", "PM"].map((period) => (
            <React.Fragment key={period}>
              <span style={{ paddingRight: "8px" }}>{period}</span>
              {WEEKDAYS.map((day) => {
                const checked = hasRecurringClinic(recurring, day, period);
                return (
                  <label key={`${day}-${period}`} style={{ display: "flex", justifyContent: "center", margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRecurring(day, period)}
                    />
                  </label>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <strong>One-off clinic dates</strong>
        {oneOffs.length === 0 && (
          <p className="muted" style={{ margin: "0.25rem 0" }}>No one-off dates.</p>
        )}
        {oneOffs.map((slot, index) => (
          <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.25rem" }}>
            <label>
              Date
              <input
                type="date"
                value={slot.date || ""}
                onChange={(event) => updateOneOff(index, { date: event.target.value })}
              />
            </label>
            <label>
              Period
              <select value={clinicSlotPeriod(slot) || "AM"} onChange={(event) => changeOneOffPeriod(index, event.target.value)}>
                <option>AM</option>
                <option>PM</option>
              </select>
            </label>
            <button type="button" onClick={() => removeOneOff(index)}>Remove</button>
          </div>
        ))}
        <button type="button" style={{ marginTop: "0.5rem" }} onClick={addOneOff}>
          Add one-off clinic date
        </button>
      </div>
    </div>
  );
}

function ExportPage({ state, block, manifest, setNotice }) {
  const pack = useMemo(() => buildExportPackage(state), [state]);

  function downloadPackage() {
    for (const file of pack.manifest.files || []) {
      const value = pack[file.key];
      if (value === undefined) continue;
      if (file.format === "text" || file.format === "csv") {
        downloadText(file.name, String(value), file.format === "csv" ? "text/csv" : "text/plain");
      } else {
        downloadText(file.name, JSON.stringify(value, null, 2), "application/json");
      }
    }
    setNotice("Downloaded local export files.");
  }

  function safeBlockName() {
    return (block?.name || "schedule").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  }

  function savePdfBlob(blob, suffix, noticeLabel) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeBlockName()}-${suffix}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice(`${noticeLabel} saved to your Downloads folder.`);
  }

  function downloadPdf() {
    savePdfBlob(buildSchedulePdf(state, block), "schedule", "Combined schedule PDF");
  }

  function downloadInpatientPdf() {
    savePdfBlob(buildInpatientPdf(state, block), "inpatient", "Inpatient schedule PDF");
  }

  function downloadOutpatientPdf() {
    savePdfBlob(buildOutpatientPdf(state, block), "outpatient", "Outpatient schedule PDF");
  }

  return (
    <div className="page-flex">
      <section className="panel">
        <h2>Package Contents</h2>
        <div className="manifest-list">
          {manifest.files.map((file) => (
            <div key={file.name}>
              <span>{file.label ?? file.name}</span>
              <strong>{file.rows}</strong>
            </div>
          ))}
        </div>
        <button className="primary-button" onClick={downloadPackage}>
          <Archive size={18} />
          Download export package
        </button>
        <div className="button-row" style={{ marginTop: "8px" }}>
          <button
            className="secondary-button"
            onClick={downloadInpatientPdf}
            title="Save the inpatient calendar (plus legend and inpatient-relevant conflicts) as its own PDF for distribution."
          >
            <FileDown size={18} />
            Download inpatient PDF
          </button>
          <button
            className="secondary-button"
            onClick={downloadOutpatientPdf}
            title="Save the outpatient calendar (plus legend and outpatient-relevant conflicts) as its own PDF for distribution."
          >
            <FileDown size={18} />
            Download outpatient PDF
          </button>
          <button
            className="secondary-button"
            onClick={downloadPdf}
            title="Save the whole schedule (inpatient + outpatient + legend + conflicts) as a single combined PDF."
          >
            <FileDown size={18} />
            Download combined PDF
          </button>
        </div>
      </section>
      <section className="panel wide">
        <h2>Summary</h2>
        <div className="manifest-list">
          <div>
            <span>Block</span>
            <strong>{manifest.block}</strong>
          </div>
          <div>
            <span>Generated</span>
            <strong>{new Date(manifest.generatedAt).toLocaleString()}</strong>
          </div>
          <div>
            <span>Files in package</span>
            <strong>{manifest.files.length}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, tone }) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function Step({ done, label }) {
  return (
    <div className={done ? "step done" : "step"}>
      {done ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{label}</span>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function RotatorSelect({ state, value, onChange, activeOnDate, phase }) {
  // When activeOnDate is given, restrict to rotators who are actually on
  // service that day. Empty array means "no one is active" — fall back to
  // showing the full roster so the user can still pick someone (and then
  // see the resulting conflict warning) rather than being stuck with an
  // empty dropdown.
  let filtered = activeOnDate ? activeRotatorsOn(state, activeOnDate) : state.rotators;
  // When `phase` is given, also exclude rotators whose segment for that
  // date is pre-assigned to the OPPOSITE phase. Rotators with no
  // segment phase pass through unchanged.
  if (activeOnDate && phase) {
    const opposite = phase === "inpatient" ? "outpatient" : "inpatient";
    filtered = filtered.filter((r) => getRotatorSegmentPhase(r, activeOnDate) !== opposite);
  }
  const options = filtered.length > 0 ? filtered : state.rotators;
  const showingFiltered = activeOnDate && filtered.length > 0 && filtered.length < state.rotators.length;
  return (
    <label>
      Rotator{showingFiltered ? ` (showing ${filtered.length} active on ${activeOnDate}${phase ? ` for ${phase}` : ""})` : ""}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((rotator) => (
          <option key={rotator.id} value={rotator.id}>
            {rotator.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Table({ columns, rows, emptyMessage = "Nothing here yet." }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={row.join("-") || rowIndex}>
                {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CalendarGrid({ dates, render, renderBadges }) {
  return (
    <div className="calendar-grid">
      {dates.map((date) => {
        const day = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric"
        });
        const content = render(date);
        const isEmpty = content == null || content === false || content === "";
        const badges = renderBadges ? renderBadges(date) : null;
        return (
          <div key={date} className="calendar-cell">
            <strong>{day}</strong>
            <span>{isEmpty ? "Open" : content}</span>
            {badges}
          </div>
        );
      })}
    </div>
  );
}

// --- Calendar layout helpers ------------------------------------------------
const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function WeekHeader({ weekdayOnly = false }) {
  const labels = weekdayOnly ? ["Mon", "Tue", "Wed", "Thu", "Fri"] : WEEKDAY_LABEL;
  return (
    <div className={`calendar-week-header${weekdayOnly ? " weekday-only" : ""}`}>
      {labels.map((label) => (
        <div key={label} className="calendar-week-header-cell">{label}</div>
      ))}
    </div>
  );
}

function leadingBlankCells(firstDate, weekdayOnly = false) {
  if (!firstDate) return null;
  const dow = new Date(`${firstDate}T00:00:00`).getDay();
  const offset = weekdayOnly ? Math.max(0, dow - 1) : dow;
  if (offset <= 0) return null;
  const blanks = [];
  for (let i = 0; i < offset; i++) {
    blanks.push(<div key={`blank-${i}`} className="calendar-cell calendar-cell-blank" aria-hidden="true" />);
  }
  return blanks;
}

function CalendarLegendKey({ items }) {
  return (
    <div className="calendar-legend-key" aria-label="Calendar key">
      {items.map((item) => (
        <span key={item.label} className="chip calendar-legend-item">
          <span className={item.className} />
          <small>{item.label}</small>
        </span>
      ))}
    </div>
  );
}

// --- Inpatient day data + cell ----------------------------------------------
// classifyAssignmentRole, inpatientDayData, and the role-pattern constants
// extracted to shared/scheduler/derived-views.js in Phase 3.3.
// classifyAssignmentRole and inpatientDayData imported at the top of this file.

function firstName(rotator) {
  if (!rotator) return "Unknown";
  return rotator.displayName.split(/\s+/)[0];
}

function InpatientDayCell({ date, state, conflictsByDate, expanded, onToggle }) {
  const data = useMemo(
    () => inpatientDayData(state, date, conflictsByDate),
    [state, date, conflictsByDate]
  );

  const headerLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  });
  const conflictCount = data.dayConflicts.length;

  const onPreview = data.on.slice(0, 3).map(({ rotator }) => firstName(rotator)).join(", ");
  const onExtra = Math.max(0, data.on.length - 3);

  // Slot status drives the cell's base tint (contract design system):
  // a real conflict is the only red; a non-holiday/non-weekend day with
  // nobody on service is a calm neutral "unassigned"; everything else is
  // the page's accent-tinted "ip" base.
  // Only a real clash (double-book, unavailable, etc.) makes a cell red.
  // missing-coverage / understaffed ARE the "unassigned" state, so they fall
  // through to the calm neutral slot instead of lighting up the calendar.
  const realConflict = data.dayConflicts.some(
    (c) => c.type !== "missing-coverage" && c.type !== "understaffed"
  );
  const slotClass = realConflict
    ? "slot-conflict"
    : data.on.length === 0 && !data.holiday && !data.isWeekend
      ? "slot-unassigned"
      : "slot-ip";

  const allPullouts = [
    ...data.amPullout.map((x) => ({ ...x, period: "AM" })),
    ...data.pmPullout.map((x) => ({ ...x, period: "PM" })),
    ...data.continuityPullouts.AM.map((r) => ({ rotator: r, period: "AM", role: "Continuity clinic" })),
    ...data.continuityPullouts.PM.map((r) => ({ rotator: r, period: "PM", role: "Continuity clinic" }))
  ];

  return (
    <div
      className={[
        "calendar-cell",
        "inpatient-cell",
        slotClass,
        expanded ? "expanded" : "",
        data.holiday ? "holiday" : "",
        data.isWeekend ? "weekend" : ""
      ].filter(Boolean).join(" ")}
    >
      <header className="day-header">
        <div className="day-header-left">
          <strong>{headerLabel}</strong>
          {data.holiday && <span className="day-tag tag-holiday" title={data.holiday.label}>Holiday</span>}
          {!data.holiday && data.isWeekend && <span className="day-tag tag-weekend">Weekend</span>}
        </div>
        <div className="day-header-right">
          {conflictCount > 0 && (
            <span
              className="conflict-dot"
              title={data.dayConflicts.map((c) => `${c.severity}: ${c.title}`).join("\n")}
              aria-label={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} on this date`}
            >
              !
            </span>
          )}
          <button
            type="button"
            className="day-toggle"
            aria-label={expanded ? "Collapse day details" : "Show day details"}
            onClick={onToggle}
          >
            {expanded ? "Hide" : "More"}
          </button>
        </div>
      </header>

      <div className="day-summary">
        <div
          className="summary-row summary-on"
          title={
            data.on.length
              ? `ON: ${data.on.map((x) => x.rotator.displayName).join(", ")}`
              : "No one on service"
          }
        >
          <span className="row-label">ON</span>
          <span className="row-count">{data.on.length}</span>
          {data.on.length > 0 && (
            <span className="row-names">
              {onPreview}{onExtra > 0 && <span className="muted">{` +${onExtra}`}</span>}
            </span>
          )}
        </div>

        {data.senior.length > 0 && (
          <div className="summary-row summary-senior" title={`Team senior: ${data.senior.map((r) => r.displayName).join(", ")}`}>
            <span className="row-label">Senior</span>
            <span className="row-names">{data.senior.map(firstName).join(", ")}</span>
          </div>
        )}

        {data.fellow.length > 0 && (
          <div className="summary-row summary-fellow" title={`Fellow: ${data.fellow.map((r) => r.displayName).join(", ")}`}>
            <span className="row-label">Fellow</span>
            <span className="row-names">{data.fellow.map(firstName).join(", ")}</span>
          </div>
        )}

        {allPullouts.length > 0 && (
          <div className="summary-row summary-pullouts">
            <div className="pullout-chip-row">
              {allPullouts.map((p, i) => (
                <span
                  key={`${p.rotator.id}-${p.period}-${i}`}
                  className={`pullout-chip pullout-${p.period.toLowerCase()}`}
                  title={`${p.rotator.displayName}: ${p.role} (${p.period})`}
                >
                  {firstName(p.rotator)} · {p.period}
                </span>
              ))}
            </div>
          </div>
        )}

        {data.academic.length > 0 && (
          <div className="summary-row summary-academic" title="Academic half-day">
            <span className="row-label">Academic</span>
            <span className="row-names">{data.academic.map((x) => firstName(x.rotator)).join(", ")}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="day-expanded">
          <DetailBlock
            label={`ON list (${data.on.length})`}
            items={data.on.map(({ rotator, role }) => ({
              key: rotator.id,
              primary: rotator.displayName,
              secondary: role && role !== "Resident" ? role : null
            }))}
            emptyLabel="No one assigned to inpatient on this day."
          />
          <DetailBlock
            label={`OFF list (${data.off.length})`}
            items={data.off.map(({ rotator, reason }) => ({
              key: rotator.id,
              primary: rotator.displayName,
              secondary: reason
            }))}
            emptyLabel="Everyone in the block is on service today."
          />
          <DetailBlock
            label="AM clinic pull-outs"
            items={[
              ...data.amPullout.map(({ rotator, role }) => ({
                key: `am-${rotator.id}`, primary: rotator.displayName, secondary: role
              })),
              ...data.continuityPullouts.AM.map((rotator) => ({
                key: `am-cont-${rotator.id}`, primary: rotator.displayName, secondary: "Continuity clinic"
              }))
            ]}
            emptyLabel="None"
          />
          <DetailBlock
            label="PM clinic pull-outs"
            items={[
              ...data.pmPullout.map(({ rotator, role }) => ({
                key: `pm-${rotator.id}`, primary: rotator.displayName, secondary: role
              })),
              ...data.continuityPullouts.PM.map((rotator) => ({
                key: `pm-cont-${rotator.id}`, primary: rotator.displayName, secondary: "Continuity clinic"
              }))
            ]}
            emptyLabel="None"
          />
          <DetailBlock
            label="Team senior"
            items={data.senior.map((r) => ({ key: `senior-${r.id}`, primary: r.displayName, secondary: r.program }))}
            emptyLabel="Not assigned."
          />
          <DetailBlock
            label="Fellow coverage"
            items={data.fellow.map((r) => ({ key: `fellow-${r.id}`, primary: r.displayName, secondary: r.program }))}
            emptyLabel="Not assigned."
          />
          {data.academic.length > 0 && (
            <DetailBlock
              label="Academic half-day"
              items={data.academic.map(({ rotator, role }) => ({
                key: `ahd-${rotator.id}`, primary: rotator.displayName, secondary: role
              }))}
              emptyLabel="None"
            />
          )}
          {data.holiday && (
            <p className="day-note"><strong>Holiday:</strong> {data.holiday.label}{data.holiday.noClinic ? " (no clinic)" : ""}</p>
          )}
          {conflictCount > 0 && (
            <div className="day-conflicts">
              <strong>Conflict warnings</strong>
              <ul>
                {data.dayConflicts.map((c) => (
                  <li key={c.id} className={`conflict-line conflict-${c.severity.toLowerCase()}`}>
                    <span className="conflict-severity">{c.severity}</span> {c.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Outpatient day data + cell ---------------------------------------------
// outpatientDayData, matchesAny, classifySession, parseClinicMeta, and the
// *_PATTERNS constants extracted to shared/scheduler/derived-views.js in
// Phases 3.2 / 3.3. All imported at the top of this file.

function OutpatientDayCell({ date, state, conflictsByDate, expanded, onToggle }) {
  const data = useMemo(
    () => outpatientDayData(state, date, conflictsByDate),
    [state, date, conflictsByDate]
  );

  const headerLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  });
  const conflictCount = data.dayConflicts.length;
  const hasSessions = data.sessions.AM.length > 0 || data.sessions.PM.length > 0;

  // Slot status drives the cell's base tint (contract design system):
  // a real conflict is the only red; a weekday with no clinics scheduled
  // (and not an intentional no-clinic holiday) is a calm neutral
  // "unassigned"; everything else is the page's blue-tinted "op" base.
  const realConflict = data.dayConflicts.some(
    (c) => c.type !== "missing-coverage" && c.type !== "understaffed"
  );
  const slotClass = realConflict
    ? "slot-conflict"
    : !hasSessions && !data.isNoClinicHoliday
      ? "slot-unassigned"
      : "slot-op";

  return (
    <div
      className={[
        "calendar-cell",
        "outpatient-cell",
        slotClass,
        expanded ? "expanded" : "",
        data.isNoClinicHoliday ? "no-clinic" : "",
        data.holiday ? "holiday" : ""
      ].filter(Boolean).join(" ")}
    >
      <header className="day-header">
        <div className="day-header-left">
          <strong>{headerLabel}</strong>
          {data.isNoClinicHoliday
            ? <span className="day-tag tag-noclinic" title={data.holiday.label}>No clinic</span>
            : data.holiday
              ? <span className="day-tag tag-holiday" title={data.holiday.label}>Holiday</span>
              : null}
        </div>
        <div className="day-header-right">
          {conflictCount > 0 && (
            <span
              className="conflict-dot"
              title={data.dayConflicts.map((c) => `${c.severity}: ${c.title}`).join("\n")}
              aria-label={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} on this date`}
            >
              !
            </span>
          )}
          <button type="button" className="day-toggle" aria-label={expanded ? "Collapse day details" : "Show day details"} onClick={onToggle}>
            {expanded ? "Hide" : "More"}
          </button>
        </div>
      </header>

      {data.isNoClinicHoliday ? (
        <p className="day-note no-clinic-note"><strong>{data.holiday.label}</strong> — no clinic today.</p>
      ) : (
        <div className="day-summary">
          <ClinicPeriodBlock period="AM" items={data.sessions.AM} />
          <ClinicPeriodBlock period="PM" items={data.sessions.PM} />
        </div>
      )}

      {!data.isNoClinicHoliday && (
        <div className="day-meta-row">
          {data.students.length > 0 && (
            <span className="day-meta meta-student" title={data.students.map((r) => r.displayName).join(", ")}>
              MS {data.studentsAssigned.length}/{data.students.length}
            </span>
          )}
          {data.fellows.length > 0 && (
            <span className="day-meta meta-fellow" title={data.fellows.map((r) => r.displayName).join(", ")}>
              Fellow {data.fellowsAssigned.length}/{data.fellows.length}
            </span>
          )}
          {data.cmeNotes.length > 0 && (
            <span className="day-meta meta-cme">CME</span>
          )}
          {data.studentsOff && <span className="day-meta meta-off">Students off</span>}
          {data.residentsOff && <span className="day-meta meta-off">Residents off</span>}
        </div>
      )}

      {expanded && (
        <div className="day-expanded">
          <DetailBlock
            label="AM clinics"
            items={data.sessions.AM.map((s) => ({
              key: s.id,
              primary: s.clinicName || "Clinic",
              secondary: clinicSecondary(s)
            }))}
            emptyLabel="No AM clinics on this day."
          />
          <DetailBlock
            label="PM clinics"
            items={data.sessions.PM.map((s) => ({
              key: s.id,
              primary: s.clinicName || "Clinic",
              secondary: clinicSecondary(s)
            }))}
            emptyLabel="No PM clinics on this day."
          />
          <DetailBlock
            label="Medical students"
            items={data.students.map((r) => ({
              key: r.id, primary: r.displayName,
              secondary: data.studentsAssigned.includes(r) ? "Assigned" : "Not in a clinic today"
            }))}
            emptyLabel="No medical students in this block."
          />
          <DetailBlock
            label="Fellow clinic assignments"
            items={data.fellows.map((r) => ({
              key: r.id, primary: r.displayName,
              secondary: data.fellowsAssigned.includes(r) ? "In a clinic today" : "Not in a clinic today"
            }))}
            emptyLabel="No fellow in this block."
          />
          <DetailBlock
            label="Continuity clinic notes"
            items={[
              ...data.continuityAM.map((r) => ({ key: `ca-${r.id}`, primary: r.displayName, secondary: "AM" })),
              ...data.continuityPM.map((r) => ({ key: `cp-${r.id}`, primary: r.displayName, secondary: "PM" }))
            ]}
            emptyLabel="No continuity clinics today."
          />
          {data.cmeNotes.length > 0 && (
            <DetailBlock
              label="CME notes"
              items={data.cmeNotes.map((s) => ({
                key: s.id, primary: s.clinicName, secondary: s.rotator?.displayName || s.provider || "—"
              }))}
            />
          )}
          {(data.studentsOff || data.residentsOff || data.holiday) && (
            <p className="day-note">
              {data.holiday && <><strong>Holiday:</strong> {data.holiday.label}.{" "}</>}
              {data.studentsOff && <>Medical students off today. </>}
              {data.residentsOff && <>Residents off today. </>}
            </p>
          )}
          {conflictCount > 0 && (
            <div className="day-conflicts">
              <strong>Conflict warnings</strong>
              <ul>
                {data.dayConflicts.map((c) => (
                  <li key={c.id} className={`conflict-line conflict-${c.severity.toLowerCase()}`}>
                    <span className="conflict-severity">{c.severity}</span> {c.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function clinicSecondary(session) {
  const bits = [];
  if (session.rotator) bits.push(session.rotator.displayName);
  else if (session.provider) bits.push(session.provider);
  if (session.location) bits.push(`@ ${session.location}`);
  if (session.count != null) bits.push(`${session.count} patients`);
  if (session.status === "stay-tuned") bits.push("stay tuned");
  if (session.status === "cme") bits.push("CME");
  if (session.status === "no-clinic") bits.push("no clinic");
  return bits.length ? bits.join(" · ") : "Unassigned";
}

function ClinicPeriodBlock({ period, items }) {
  if (!items || items.length === 0) {
    return (
      <div className={`clinic-period clinic-period-${period.toLowerCase()} empty`}>
        <span className="period-tag">{period}</span>
        <span className="muted">No {period} clinic</span>
      </div>
    );
  }
  return (
    <div className={`clinic-period clinic-period-${period.toLowerCase()}`}>
      <span className="period-tag">{period}</span>
      <div className="clinic-rows">
        {items.map((s) => (
          <div
            key={s.id}
            className={`clinic-row status-${s.status}`}
            title={[
              s.clinicName,
              s.rotator?.displayName,
              s.provider,
              s.location && `@ ${s.location}`,
              s.count != null && `${s.count} patients`
            ].filter(Boolean).join(" · ")}
          >
            <span className="clinic-name">{s.clinicName || "Clinic"}</span>
            <span className="clinic-meta">
              {s.rotator ? firstName(s.rotator) : (s.provider || (s.status === "stay-tuned" ? "Stay tuned" : "Unassigned"))}
              {s.count != null && <span className="clinic-count" title={`${s.count} patients`}> · {s.count}</span>}
              {s.location && <span className="clinic-loc"> · {s.location}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailBlock({ label, items, emptyLabel }) {
  if ((!items || items.length === 0) && !emptyLabel) return null;
  return (
    <div className="detail-block">
      <strong>{label}</strong>
      {(!items || items.length === 0) ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <span>{item.primary}</span>
              {item.secondary && <span className="muted"> · {item.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function indexConflictsByDate(conflicts) {
  if (!Array.isArray(conflicts)) return {};
  const index = {};
  for (const c of conflicts) {
    if (!c || !c.date) continue;
    (index[c.date] = index[c.date] || []).push(c);
  }
  return index;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function labelize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) return "Not set";
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Not set";
  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

function formatPhaseLabel(phase) {
  if (phase === "inpatient") return "IP";
  if (phase === "outpatient") return "OP";
  if (phase === "both") return "IP+OP";
  if (phase === "off") return "Off";
  return labelize(String(phase || "unknown"));
}

function formatPreferenceActualRange(range) {
  const dates = range.startDate === range.endDate
    ? formatMonthDay(range.startDate)
    : formatDateRange(range.startDate, range.endDate);
  return `${dates}: preferred ${formatPhaseLabel(range.preference)} -> actual ${formatPhaseLabel(range.actual)}`;
}

function summarizeUnavailableRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "No time off scheduled";
  return ranges.map((range) => {
    if (!range?.start && !range?.end) return "Dates not set";
    if (range?.start === range?.end) return range.start;
    if (!range?.start) return `Through ${range.end}`;
    if (!range?.end) return `From ${range.start}`;
    return `${range.start} to ${range.end}`;
  }).join("; ");
}

function summarizeSegmentPhases(rotator) {
  const segments = Array.isArray(rotator?.segments) ? rotator.segments : [];
  const defaults = segments.filter((segment) => segment?.defaultPhase);
  if (defaults.length === 0) return "";
  return defaults.map((segment) => {
    const dateText = segment.start && segment.end
      ? `${segment.start} to ${segment.end}`
      : "Dates not set";
    return `${dateText}: ${formatPhaseLabel(segment.defaultPhase)}`;
  }).join("; ");
}

function formatRotatorDates(rotator) {
  const segments = Array.isArray(rotator?.segments) ? rotator.segments : [];
  if (segments.length === 0) return "Not set";
  if (segments.length === 1) return `${segments[0].start} to ${segments[0].end}`;
  return segments.map((s) => `${s.start} to ${s.end}`).join("; ");
}

// ───────────────────────────────────────────────────────────────────────────
// 2026-05-28 workflow-stage redesign — top-level destination pages.
//
// These replace the old CombinedPlanningPage tab container and the loose
// utility pages. Reports/Settings are sub-tab containers that mount the
// existing utility pages so no functionality is lost during the migration.
// Clinics / Inpatient Schedule / Outpatient Schedule start as skeletons and
// are filled in by Phases 4–6.
// ───────────────────────────────────────────────────────────────────────────

// Lightweight sub-tab container used by Reports and Settings to host the
// legacy utility pages under a single top-level destination.
function SectionTabs({ tabs, ariaLabel }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  return (
    <div className="section-tabs">
      <div className="section-tablist" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active?.id === tab.id}
            className={`section-tab${active?.id === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="section-tabpanel">{active?.render()}</div>
    </div>
  );
}

// Attendings — top-level edit view for the attending physicians who staff
// clinics. Reuses the same AttendingProfileEditor as Configuration so clinic
// definitions (recurring + one-off) can be maintained from a dedicated page.
function AttendingsPage({ state, updateState, setNotice }) {
  const [newAttending, setNewAttending] = useState("");
  const attendings = state.attendings || [];

  function addAttending() {
    const name = newAttending.trim();
    if (!name) return;
    if (attendings.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      setNotice?.(`${name} is already in the attendings list.`);
      return;
    }
    updateState(
      setAttendings(state, [...attendings, { name, recurringClinics: [], oneOffDates: [] }]),
      `Added ${name} to the attendings list.`
    );
    setNewAttending("");
  }
  function removeAttending(name) {
    const ok = window.confirm(`Remove ${name} from the attendings list? Past outpatient sessions that used this name stay unchanged.`);
    if (!ok) return;
    updateState(setAttendings(state, attendings.filter((a) => a.name !== name)), `Removed ${name} from the attendings list.`);
  }
  function updateAttending(name, patch) {
    updateState(
      setAttendings(state, attendings.map((a) => (a.name === name ? { ...a, ...patch } : a))),
      `${name}'s clinic schedule updated.`
    );
  }

  return (
    <div className="page-flex">
      <section className="panel wide">
        <h2>Attendings</h2>
        <p className="muted">
          The attending physicians who staff your clinics. For each one, mark which
          weekdays and AM/PM they normally have clinic, plus any one-off dates. These
          definitions generate the clinic sessions shown on the Clinics page.
        </p>
        <div className="dense-list" style={{ marginBottom: "12px" }}>
          {attendings.length === 0 ? (
            <p className="muted">No attendings yet. Add some below.</p>
          ) : (
            attendings.map((attending) => (
              <AttendingProfileEditor
                key={attending.name}
                attending={attending}
                onChange={(patch) => updateAttending(attending.name, patch)}
                onRemove={() => removeAttending(attending.name)}
              />
            ))
          )}
        </div>
        <div className="form-grid single">
          <TextField label="Add attending" value={newAttending} onChange={setNewAttending} />
          <button type="button" className="primary-button" onClick={addAttending} disabled={!newAttending.trim()}>
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

// Fellows — filtered, read-mostly view of Pediatric Neurology fellows.
// Full editing stays on Rotators.
function FellowsPage({ state, block, updateState, setPage }) {
  const fellows = (state.rotators || []).filter(isPediatricNeurologyFellow);
  return (
    <div className="page-flex">
      <section className="panel wide">
        <h2>Fellows</h2>
        <p className="muted">
          Fellow rotation profiles — preferred day off, continuity clinic, and the
          IP-first / OP-first preference (set per date range below). Fellows are pinned at
          the top of the Planning Grid with a ★ and are easy to schedule (always two on
          service, half inpatient / half outpatient). Edits here save to the same profile
          used everywhere — full roster editing also lives on the Rotators page.
        </p>
        {fellows.length === 0 ? (
          <p className="muted">
            No fellows in the roster yet. Import a fellow roster on the{" "}
            <button type="button" className="link-button" onClick={() => setPage?.("Sources")}>
              Sources
            </button>{" "}
            page — Pediatric Neurology fellows appear here automatically while Psychiatry
            rotators remain with the regular roster.
          </p>
        ) : (
          <div className="roster-list">
            {fellows.map((rotator) => (
              <div key={rotator.id} className="roster-row expanded">
                <AvailabilityEditor
                  rotator={rotator}
                  actions={null}
                  preferenceActualRanges={preferenceVsActualSummary(state, rotator, block).ranges}
                  onChange={(patch) =>
                    updateState(updateRotator(state, rotator.id, patch), `${rotator.displayName} updated.`)
                  }
                  onChangeQuiet={(patch) => updateState(updateRotator(state, rotator.id, patch))}
                  onRemove={() => {
                    if (window.confirm(
                      `Remove ${rotator.displayName}? Their inpatient and outpatient assignments will also be removed. Use Sources to re-import if you change your mind.`
                    )) {
                      updateState(removeRotator(state, rotator.id), `${rotator.displayName} removed from the roster.`);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Reports — consolidates Daily Report, Conflicts, Legend, and Export.
function ReportsPage(props) {
  return (
    <SectionTabs
      ariaLabel="Report views"
      tabs={[
        { id: "daily", label: "Daily Report", render: () => <DailyReportPage {...props} /> },
        { id: "conflicts", label: "Conflicts", render: () => <ConflictsPage {...props} /> },
        { id: "legend", label: "Legend", render: () => <LegendPage {...props} /> },
        { id: "export", label: "Export", render: () => <ExportPage {...props} /> }
      ]}
    />
  );
}

// Settings — consolidates Rules, Block Setup, Sources, and Poster metadata.
function SettingsPage(props) {
  return (
    <SectionTabs
      ariaLabel="Settings sections"
      tabs={[
        { id: "rules", label: "Rules", render: () => <RulesPage {...props} /> },
        { id: "blocks", label: "Block Setup", render: () => <BlockSetupPage {...props} /> },
        { id: "sources", label: "Sources", render: () => <SourcesPage {...props} /> },
        { id: "poster", label: "Poster", render: () => <PosterSettingsPage {...props} /> }
      ]}
    />
  );
}

// Editable poster metadata (2026-05-28 poster feature). Fellow + block dates
// come from real data; this page owns the boilerplate the data model does not:
// program name, Chief, Notes, Locations, and the footer tagline. Saved via the
// posterSettings.patch command (shared command surface).
function PosterSettingsPage({ state, updateState }) {
  const ps = state.posterSettings || {};

  function patch(key, value) {
    updateStateFromCommand(
      state,
      updateState,
      { type: "posterSettings.patch", input: { patch: { [key]: value } } },
      "Poster settings saved in app data."
    );
  }

  function patchLocation(index, field, value) {
    const locations = (ps.locations || []).map((loc, i) =>
      i === index ? { ...loc, [field]: value } : loc
    );
    patch("locations", locations);
  }
  function addLocation() {
    patch("locations", [...(ps.locations || []), { name: "", address: "" }]);
  }
  function removeLocation(index) {
    patch("locations", (ps.locations || []).filter((_, i) => i !== index));
  }

  return (
    <div className="page-flex">
      <section className="panel">
        <h2>Header</h2>
        <TextField
          label="Program name"
          value={ps.programName || ""}
          onChange={(v) => patch("programName", v)}
        />
        <TextField
          label="Chief"
          value={ps.chief || ""}
          onChange={(v) => patch("chief", v)}
        />
        <TextField
          label="Footer tagline"
          value={ps.tagline || ""}
          onChange={(v) => patch("tagline", v)}
        />
      </section>
      <section className="panel">
        <h2>Notes</h2>
        <p className="muted">One note per line. These appear in the poster's Notes panel.</p>
        <textarea
          className="poster-notes-input"
          rows={6}
          value={(ps.notes || []).join("\n")}
          onChange={(e) =>
            patch(
              "notes",
              e.target.value.split("\n").map((l) => l.trim()).filter(Boolean)
            )
          }
        />
      </section>
      <section className="panel wide">
        <h2>Locations</h2>
        {(ps.locations || []).length === 0 ? (
          <p className="muted">No locations yet.</p>
        ) : (
          (ps.locations || []).map((loc, i) => (
            <div key={i} className="list-row" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <TextField label="Name" value={loc.name || ""} onChange={(v) => patchLocation(i, "name", v)} />
              <TextField label="Address" value={loc.address || ""} onChange={(v) => patchLocation(i, "address", v)} />
              <button className="secondary-button" onClick={() => removeLocation(i)}>Remove</button>
            </div>
          ))
        )}
        <button className="secondary-button" onClick={addLocation} style={{ marginTop: 8 }}>
          Add location
        </button>
      </section>
    </div>
  );
}

// Clinics — outpatient clinic placement (two-week Mon–Fri AM/PM drag/drop).
function ClinicsPage({ state, block, updateState, setNotice }) {
  return <ClinicsView state={state} block={block} updateState={updateState} setNotice={setNotice} />;
}

// Inpatient Schedule — read-only projection of inpatient service days, with a
// daily staffing heatmap and continuity timeline.
function InpatientSchedulePage({ state, block, conflicts, setNotice }) {
  return <InpatientSchedule state={state} block={block} conflicts={conflicts} setNotice={setNotice} />;
}

// Outpatient Schedule — read-only final outpatient itinerary combining
// outpatient service days and clinic assignments.
function OutpatientSchedulePage({ state, block, setNotice }) {
  return <OutpatientSchedule state={state} block={block} setNotice={setNotice} />;
}
