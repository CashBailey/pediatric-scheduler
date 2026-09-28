# Migration Design — Frontend + Local-Only Backend

> **Historical — superseded by commit `b01cce6` (2026-05-24).** This documents
> the original **Node/Fastify** backend migration, which shipped. The backend
> was subsequently rewritten in **Python/FastAPI** (`backend_py/`) and the Node
> backend removed. For how the backend works today, see `README.md` and
> `backend_py/README.md`. Kept for history.

**Created:** 2026-05-22
**Goal reference:** frontend + local-only backend refactor, now shipped (see `HighLevelDesignSpecification.md`).
**Scope of this doc:** Make Phase 1 unambiguous. Phases 2–7 sketch shape only; the detailed design for each happens at the start of that phase.

---

## 1. Backend technology choice

**Node.js + Fastify**, single npm package in the existing repo at `backend/`.
Reason: lets us reuse `scheduler.js`, `programRules.js`, `excelImport.js`, `pdfExport.js` verbatim in Phase 3 — that is the single biggest preservation-of-behavior lever available. Fastify over Express for built-in JSON-schema validation (helps Phase 2 contracts) and modern ESM-clean defaults.

## 2. Frontend/backend boundary

- **Frontend:** React UI, user input, rendering, browser-only concerns (file download triggers, drag-drop, keyboard).
- **Backend:** stateful operations on scheduler state (planned for Phase 3+), filesystem-backed persistence (Phase 4), heavy parsing/export (Phase 5), future solver work.
- **Phase 1:** boundary exists but is unused — backend only exposes `/api/health`. Frontend continues to operate entirely client-side until Phase 3.

## 3. API / IPC contract

**HTTP REST over loopback.** Routes namespaced under `/api/*`. Request/response bodies are JSON. Fastify JSON-schema validation will enforce shapes once contracts land in Phase 2. No WebSockets in Phase 1; revisit only if a feature needs server-push.

## 4. State persistence model

**Phase 1 unchanged** — frontend `localStorage` remains the source of truth.
**Phase 4 (deferred detail):** SQLite file inside the existing `pedi_scheduler_react_data` Docker volume, mounted at `/home/app/.local/share/pedi_scheduler/scheduler.db`. Exact schema chosen at Phase 4 start once we see what the moved-domain layer (Phase 3) actually needs.

## 5. Migration path from browser-local state

**Phase 4 (deferred):** on first backend-backed launch, frontend POSTs current `localStorage` payload to `/api/state/import-from-browser`. Backend persists; frontend marks the localStorage entry as migrated (keeps a backup copy for one release cycle). User-visible export remains available throughout.

## 6. Import / export handling

**Phase 1 unchanged** — Excel parsing in browser via `xlsx`, PDF via `jsPDF`.
**Phase 5 (deferred):** move Excel parsing to backend (offload large file work, easier multi-format support); PDF export likely stays in browser (jsPDF works fine client-side, no benefit to moving).

## 7. Scheduling-logic ownership

**Phase 3:** the pure functions in `scheduler.js` + `programRules.js` move to a shared module at `shared/scheduler/` that both the frontend (via Vite import) and backend (via Node import) can use. Backend exposes thin `/api/scheduler/*` wrappers that call them. Identical inputs → identical outputs verified via golden tests.

## 8. Local-only enforcement

Four overlapping guarantees, all landing in Phase 1:

1. **Active bind guard** in `backend/src/server.js`: throws if `host` is not in `{127.0.0.1, localhost, ::1}`.
2. **Offline-contract test** (`tests/offline-contract.test.mjs`) extended to walk `backend/` in addition to `src/` — destination-based regexes already in place catch any off-machine URL.
3. **Bind test** asserts both branches: default starts on `127.0.0.1`; explicit `0.0.0.0` throws.
4. **Docker compose** continues to expose `127.0.0.1:PORT:PORT` only (Phase 6 keeps this).

## 9. Docker and release impact

**Phase 1:** none. Backend runs only on the dev machine. Docker bundle is untouched.
**Phase 6 (deferred):** the current container uses base image `pedi-scheduler-desktop:0.2.0a1` and serves static files via Python's `http.server`. Two options for adding Node:
   (a) `apt-get install nodejs` in the Dockerfile, keep current base.
   (b) Switch base to `node:22-slim`.
The choice depends on whether the parent base image is providing anything else we depend on. Decision made at Phase 6 start; flagged here so it isn't a surprise.

## 10. Test strategy

- **Frontend:** existing `npm test` (vitest, 114 tests) continues to pass at every phase.
- **Backend:** new node:test specs in `backend/tests/`. Run via existing `npm run test:offline` (which already uses `node --test tests/*.test.mjs`) — extend that glob or add a `test:backend` script.
- **Offline-contract:** extended to scan `backend/` (Phase 1.0).
- **Golden tests:** introduced in Phase 3 to lock domain-function I/O equivalence pre- and post-move.

## 11. Rollback strategy

Each phase commits as a small, behavior-preserving unit:
- **Phase 1:** dormant backend (no frontend code calls it). Rollback = revert the commit. Frontend keeps working.
- **Phase 3+:** maintain the localStorage path as a fallback toggle until the backend-backed path is golden-test-proved equivalent across all critical workflows. Removal happens only in Phase 7.
- **Phase 4 persistence:** keep `localStorage` backup for one release cycle after switching the default to backend-managed.
- **Bundle artifacts:** the 0.15.3 zip is the last known-good handoff. We don't rebuild until at least Phase 6, and only after verification.

---

## Phase 1 concrete checklist (what executes next)

| Step | File(s) | Behavior preserved? |
|---|---|---|
| 1.0 Extend offline-contract scan to `backend/` | `tests/offline-contract.test.mjs` | Yes — existing assertions unchanged |
| 1.1 Add Fastify dep | `package.json` | Yes — frontend code untouched |
| 1.2 Create backend skeleton | `backend/src/server.js`, `backend/src/health.js` | Yes — backend dormant until used |
| 1.3 Add scripts + Vite proxy | `package.json`, `vite.config.js` | Yes — only active during dev |
| 1.4 Backend tests | `backend/tests/server.test.mjs` | N/A — new tests |
| 1.5 Run full verification | — | Yes — all green expected |
| 1.6 README backend section | `README.md` | Yes — text only |
| 1.7 Single commit | — | Yes |

**Port:** Backend reads `process.env.PORT || 6174`. Vite dev server proxies `/api/*` to `http://127.0.0.1:6174`.

**No version bump, no bundle rebuild, no Dockerfile change in Phase 1.** Customer (Coordinator) sees zero change.

---

## Completion notes (2026-05-22)

All phases shipped on the same day as the design. Final state:

| Phase | Commit | Verdict |
|---|---|---|
| 1 — backend skeleton | `937c02b` | done; Fastify + assertLoopback guard, dormant |
| 2 — contracts (v1) | `4c97ec6` | done; 8 schemas, 12 compat tests |
| 3 — move scheduler.js + programRules.js to shared/ | `2480f2e` | done; via re-export shims at old paths |
| 3.1 — POST detect-conflicts + generate-legend | `12ab0b3` | done; 9 new tests including end-to-end double-book |
| 3.2 — extract 4 derived-view helpers | `248d386` | done; +24 direct-coverage tests |
| 3.3 — extract day-data + classifyAssignmentRole | `356ad31` | done; +13 tests |
| 4 — persistence (JSON file, atomic write) | `649ef99` | done; 13 new tests covering all failure modes |
| 5 — excel-import to shared + POST /api/import/excel | `8d0792d` | done; 3 new route tests |
| 6 — Docker bundles backend (dormant) | `e283394` + `60aae63` | done; multistage Node 22 + npm symlink fix |
| 4.1 — wire frontend save → backend (background) | `ba18fec` + `3e7c027` | done; Node serves both, Python removed, assertSafeBind opt-in |
| 7 — remove shims, move tests to shared/scheduler/ | `93ace63` | done; src/ now purely frontend |

**Stop criteria (from Phase 0):** all 10 satisfied.

1. ✅ Frontend and backend run together locally
2. ✅ Backend is machine-local only (assertSafeBind + Docker port-map)
3. ✅ No off-machine communication (enforced by offline-contract scan)
4. ✅ Existing scheduler workflows still work (114 pre-existing vitest specs unchanged at every commit)
5. ✅ Full frontend tests pass (151 vitest)
6. ✅ Full backend tests pass (51 node:test offline)
7. ✅ Build passes (vite + docker)
8. ✅ Local-only contract tests pass
9. ✅ Documentation reflects the new architecture (this section)
10. ✅ Release/handoff updated (0.17.x bundles + WHATS_NEW)

**What shifted from the original sketch:**

- Phase 3 sprouted sub-phases (3.1, 3.2, 3.3) — domain routes + extraction work were each their own commit. The "preserve behavior" gate worked: 114 pre-existing vitest tests stayed green through every move.
- Phase 4 added the result-envelope `{ok, reason, message}` pattern that Phase 1's storage.js audit-fix had established. Now the project's standard "this could fail" return shape.
- Phase 6 needed multistage Node from `node:22-slim` (base image had Node 18 without npm) + explicit `RUN ln -sf` for npm/npx (Docker's `COPY` dereferences symlinks).
- Phase 4.1 hit the Docker loopback problem (container's 127.0.0.1 isn't reachable via port-map). Solution: `assertSafeBind(host, { trusted })` helper, explicit env-var opt-in (`PEDI_SCHEDULER_TRUST_BIND=1`) baked into the Dockerfile. `assertLoopback` remains strict for dev / CI.

**What did NOT ship (intentionally deferred):**

- ~~Backend-first state reads.~~ → **Shipped in 0.17.2 (Phase 8.1)**: storage.js exports hydrateFromBackend + isBackendStateAuthoritative; App.jsx adds a one-shot useEffect on mount.
- ~~Frontend-calls-backend for Excel imports.~~ → **Shipped in 0.17.2 (Phase 8.2)**: shared/scheduler/excel-import.js exports parseRosterFromArrayBuffer; App.jsx's xlsx upload path uses it.
- SQLite. JSON file persistence is the right shape for whole-blob reads/writes at this app's scale; SQLite migration only matters when query patterns demand it.
- Multi-tab race-condition handling. Last-write-wins by design — single-user app.
- Separate backend/package.json. The shared package.json works but bundles ~30 MB of React deps into the production node_modules. Cut only when image size becomes a delivery problem.
