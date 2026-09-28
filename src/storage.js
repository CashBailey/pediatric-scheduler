import {
  createInitialState,
  migrateLoadedState,
  parseState,
  serializeState
} from "../shared/scheduler/scheduler.js";

const STORAGE_KEY = "pedi-scheduler-react-state";

export function loadSchedulerState(storage = globalThis.localStorage) {
  if (!storage) return createInitialState();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState();
  try {
    // parseState already runs the rotator schema migration; the extra
    // call here is a belt-and-suspenders guard so any future code path
    // that bypasses parseState still gets the upgrade.
    return migrateLoadedState(parseState(raw));
  } catch {
    return createInitialState();
  }
}

export function saveSchedulerState(state, storage = globalThis.localStorage) {
  const normalized = migrateLoadedState(state);
  // Phase 4.1: fire-and-forget background sync to the local-only
  // backend. localStorage remains the primary source of truth from
  // the React render path's perspective; backend is a secondary copy
  // until a future phase swaps the load path. Debounced to coalesce
  // rapid edits into one POST.
  scheduleBackendSync(normalized);

  if (!storage) return { ok: true };
  try {
    storage.setItem(STORAGE_KEY, serializeState(normalized));
    return { ok: true };
  } catch (err) {
    // Most commonly QuotaExceededError when the serialized state grows
    // past the per-origin localStorage limit (~5 MB in most browsers).
    // Returning a structured result lets the calling effect surface a
    // toast instead of crashing the React tree. Callers that ignore the
    // return value continue to work — same as before.
    return { ok: false, reason: err?.name || "save-failed", message: err?.message || String(err) };
  }
}

export function resetSchedulerState(storage = globalThis.localStorage) {
  if (!storage) return createInitialState();
  storage.removeItem(STORAGE_KEY);
  return createInitialState();
}

// --- Backend sync (Phase 4.1) ------------------------------------------
// Posts the serialized state to the local-only backend on a short
// debounce so a burst of edits collapses into one POST. Failures are
// swallowed — the localStorage path above remains the authoritative
// state copy until a future phase swaps it.

let _backendSyncTimer = null;
let _backendPending = null;
const BACKEND_SYNC_DEBOUNCE_MS = 800;

function scheduleBackendSync(state) {
  if (typeof fetch !== "function") return; // node:test / server-side
  _backendPending = state;
  if (_backendSyncTimer) clearTimeout(_backendSyncTimer);
  _backendSyncTimer = setTimeout(() => {
    const payload = _backendPending;
    _backendPending = null;
    _backendSyncTimer = null;
    syncStateToBackend(payload);
  }, BACKEND_SYNC_DEBOUNCE_MS);
}

async function syncStateToBackend(state) {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch("/api/scheduler/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serializeState(state)
    });
    if (!response.ok && typeof console !== "undefined") {
      console.warn(`[storage] backend sync returned ${response.status} — localStorage still authoritative`);
    }
  } catch (err) {
    // Network error / backend down / CORS issue. localStorage path
    // keeps working — this is a best-effort secondary persistence.
    if (typeof console !== "undefined") {
      console.warn("[storage] backend sync failed (continuing with localStorage):", err?.message ?? err);
    }
  }
}

// Exported for tests that want to flush the debounced sync. Returns
// the pending state if any, otherwise null.
export function _flushBackendSyncForTests() {
  if (_backendSyncTimer) {
    clearTimeout(_backendSyncTimer);
    _backendSyncTimer = null;
  }
  const pending = _backendPending;
  _backendPending = null;
  return pending;
}

// --- Backend-first hydration (Phase 8.1) -------------------------------
// Reads the persisted state from the local backend. Used by the
// frontend on mount to recover from a localStorage clear / browser
// profile reset. Failures (network error, 4xx, 5xx) return null so
// the caller can keep its current localStorage-derived state.

export async function hydrateFromBackend() {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch("/api/scheduler/state");
    if (!response.ok) return null;
    return migrateLoadedState(await response.json());
  } catch {
    return null;
  }
}

/**
 * Returns true if the given backend state should override whatever the
 * frontend currently has in React state. The heuristic: backend is
 * authoritative when it carries actual user data — any rotators,
 * assignments, sessions, or more than the default single service block.
 *
 * This avoids the false-positive where backend returns its first-launch
 * initial state (a fresh empty schedule) and the frontend has real
 * localStorage data — we don't want to silently wipe the user's work
 * just because the backend hasn't been touched yet.
 */
export function isBackendStateAuthoritative(backendState) {
  if (!backendState || typeof backendState !== "object") return false;
  const defaultState = createInitialState();
  return (
    (backendState.rotators?.length || 0) > 0 ||
    (backendState.inpatientAssignments?.length || 0) > 0 ||
    (backendState.outpatientSessions?.length || 0) > 0 ||
    (backendState.sources?.length || 0) > 0 ||
    (backendState.halfDayFacts?.length || 0) > 0 ||
    (backendState.clinicAssignments?.length || 0) > 0 ||
    (backendState.serviceBlocks?.length || 0) > 1 ||
    hasCustomArray(backendState.expectedSourcePrograms, defaultState.expectedSourcePrograms) ||
    hasCustomPosterSettings(backendState.posterSettings, defaultState.posterSettings)
  );
}

function hasCustomArray(value, defaultValue) {
  if (!Array.isArray(value)) return false;
  return JSON.stringify(value) !== JSON.stringify(defaultValue || []);
}

function hasCustomPosterSettings(value, defaultValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const defaults = defaultValue || {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(value)]);
  return [...keys].some((key) => JSON.stringify(value[key] ?? null) !== JSON.stringify(defaults[key] ?? null));
}
