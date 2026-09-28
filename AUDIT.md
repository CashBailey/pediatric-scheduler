# Project Audit — Pediatric Neurology Scheduler (historical v0.22.0 audit)

> **Superseded status note (2026-07-06):** This audit is preserved as the
> 2026-05-24 React/Docker/backend-migration audit record. It is not the current
> product status. The current primary desktop product is the native SwiftUI macOS app v0.26.0
> with a bundled Python/FastAPI scheduler engine; React/Vite remains the legacy
> browser/Docker path. Current verification should be taken
> from `README.md`, `docs/PROJECT_VERIFICATION.md`, `docs/VERIFICATION_MAP.md`,
> `tests/verification-contract.test.mjs`, backend pytest output, Swift build
> output, native UI audit artifacts, and native package verification.

**Date:** 2026-05-24 · **Branch:** `main` @ `758cca9` · **Method:** graph-informed 6-lane parallel audit
**Inputs:** `graphify-out/` knowledge graph (678 nodes / 1190 edges / 42 communities), `HighLevelDesignSpecification.md` binding invariants, full source read, and a live test run (341 tests).
**Lane reports (evidence appendix):** `graphify-out/audit-2026-05-24/lane-{1..6}-*.md`

---

## Verdict

The foundation is **sound**: the project honors all six privacy/scope invariants (local-only, loopback-bound, no AI/ML/solver, no PHI), the security core (atomic write, static-mount traversal defense, bind guard) holds up under direct probing, the auto-draft engine is genuinely deterministic and manual-preserving, and **all 341 tests pass**.

But the audit surfaced **one customer-facing ship-blocker, one backward-compatibility crash, and a systemic Node→Python documentation drift** that has already produced a misleading test and an authoritative spec that contradicts the shipped code. Two of the most serious code findings share a *single root cause*, so the fix surface is smaller than the finding count suggests.

### Severity rollup

| Severity | Count | Items |
|---|---|---|
| **Critical** | 1 | REL-000 (stale customer bundle) |
| **High** | 4 | ENG-001 (old-state crash), BE-001 (body-cap bypass), DOC-headline (authoritative spec wrong), TEST-001 (vacuous test) |
| **Medium** | ~6 | ENG-002 (silent rule-drop), doc-drift bulk (HLD §0.4 route table, backend_py/README, main.py docstring), version-tag drift |
| **Low / Info** | ~9 | BE-002/003/004, `additionalProperties:true` latent, test nice-to-haves, gitignore tidiness |

---

## Resolution Log (2026-05-24, branch `fix/audit-findings-2026-05-24`)

All findings addressed by a 3-workstream fix team + a release rebuild. **Tests: 351 green** (260 vitest + 30 node:test + 61 pytest, up from 341 — the +10 are new backward-compat + backend tests). Changes left uncommitted on the fix branch for review.

| Finding | Status | What changed |
|---|---|---|
| **REL-000** | ✅ Fixed + verified | Added `scripts/build-release.sh` (reproducible build + `--check` freshness gate that fails when the tarball predates HEAD/dist — prevents recurrence). Rebuilt the image from current source: new tarball SHA `766769d0…` (was `e0c56ef…`), `IMAGE_SHA256.txt` + zip regenerated. Smoke-tested: tarball loads, container runs, `/api/health` → `{"ok":true,...,"version":"0.22.0"}`. Bundle `README.md` "Data And Privacy" corrected (dropped the false "only serves static files" claim). *Note: rebuilt from this branch, so it includes the audit fixes; rerun `scripts/build-release.sh` after merge to main for the canonical Coordinator artifact.* |
| **ENG-001** | ✅ Fixed | Guarded `scheduler.js` holiday read (`block?.holidays || []`); scanned for other unguarded reads of late-added fields (only this one in a render path). |
| **ENG-002** | ✅ Fixed | `migrateLoadedState` now descends into `state.serviceBlocks` (backfills `holidays: []`) and merges `{ ...DEFAULT_RULES, ...existingRules }` — additive, user values win (HLD-INV-010/011), idempotent. New `DEFAULT_RULES` constant is the single source of truth. |
| **TEST gap** | ✅ Closed | 7 new backward-compat tests in `scheduler.test.js` (old block w/o `holidays`, missing/partial `rules`, user-value preservation, extra-field survival, idempotency, `detectConflicts` no-throw). Determinism assertion already existed (`scheduler.test.js:2347`). |
| **BE-001** | ✅ Fixed | `POST /api/scheduler/state` now stream-accumulates the body and returns 413 *before* exceeding `MAX_BODY_BYTES` (no unbounded buffering); chunked-body 413 test added + mutation-tested. |
| **BE-004** | ✅ Fixed | 500 path returns generic `{"error":"could not persist state"}` and logs detail server-side; no-path-leak test added. |
| **BE-002 / BE-003** | ✅ Fixed | Parent-dir fsync after `os.replace` (durability); best-effort orphan-temp sweep matching the exact `TEMP_PREFIX` pattern (spares the real state file + others); sweep test added. |
| **DOC drift** | ✅ Fixed | `main.py` docstring (WS-B); HLD §0.4 API table (3 implemented / 4 client-side), lines 14/83/89, §12.2, §17, Appendix B; Super Requirements PNS-INV-005 (strikethrough+correction), PNS-ARCH-001/003, PNS-STALE-001/002/009, reconciliation banner; `backend_py/README.md` rewritten. Only residual "Node/Fastify" strings are explicit "was removed" context. |
| **`additionalProperties: true`** | ⏸️ Intentionally not changed | No current threat — this is a workforce-only app that stores **no PHI**, so there is nothing to protect against today. Tightening the frozen v1 *write* schema to `false` would also fight the additive-state evolution model (a newer client adding a field would be rejected on POST). Accepted as defense-in-depth only. |

---

## P0 — Ship-blockers (fix before the next Coordinator handoff)

### [REL-000] Shipped Docker bundle predates 12 UI commits and the migration merge — *Critical* ✓ verified
- **Evidence:** `release/CoordinatorPediSchedulerReact/pedi-scheduler-react-docker-linux-amd64.tar.gz` mtime **2026-05-24T15:28** — earlier than even the PR #1 (python-backend-migration) merge `394911d` @ **15:39**. All **14 commits** from that merge to `HEAD` (`758cca9` @ **18:31**), which include the entire PR #2 UI overhaul (toggle switches, roomier calendar cells, layout fixes, empty states), landed afterward; `dist/` was rebuilt **18:30**. The bundle's own `README.md` is dated **05-20** (pre-migration).
- **Impact:** Coordinator would receive the **pre-UI-overhaul app** (old checkboxes, cramped calendar, dead layout gaps, no empty states) under the `0.22.0` label — plus possibly a pre-migration backend. The release is mislabeled.
- **Fix:** Rebuild the Docker image from current `main`, re-export the tarball, regenerate `IMAGE_SHA256.txt`, refresh the bundle `README.md`, and repackage `CoordinatorPediSchedulerReact-0.22.0.zip`. Add a release-step check that fails if the tarball is older than `HEAD`.

### [ENG-001] Loading an older saved state crashes the app on render — *High* ✓ verified
- **Evidence:** `shared/scheduler/scheduler.js:714` — `for (const holiday of block.holidays) {` with **no guard**. The identical field is read safely 450 lines later at `:1167` as `(block?.holidays || [])`, proving line 714 is an oversight. `migrateLoadedState` (`:1385`) migrates rotators + top-level fields but **never backfills block-level fields**, so a block saved before `holidays` existed has `block.holidays === undefined`. `src/App.jsx:142` loads via `migrateLoadedState`, and `:161` runs `detectConflicts(state)` **unconditionally** in a `useMemo` → `TypeError: block.holidays is not iterable` during render (white screen).
- **Invariant:** Directly violates **HLD-INV-011** (additive / backward-tolerant; "existing saved states must continue to load safely") — the very guarantee `migrateLoadedState` exists to provide.
- **Fix:** Guard line 714 (`for (const holiday of block.holidays || [])`) **and**, more durably, normalize block defaults inside `migrateLoadedState` (see cross-cutting theme below — this also fixes ENG-002).

---

## P1 — High priority

### [BE-001] `POST /api/scheduler/state` body-size cap is bypassable → OOM — *High* ✓ verified
- **Evidence:** `backend_py/main.py:94-99` checks only the client-supplied `Content-Length` header, then `:106` `await request.json()` buffers the whole body. The code comment itself concedes: *"A chunked body without the header slips past this."* Lane 3 reproduced it empirically — 40×1 MB chunks with no `Content-Length` pulled all 40 MB into RAM before any 413.
- **Mitigating context:** local-only, single trusted client that *does* send `Content-Length`. So this is defense-in-depth against a runaway/buggy/future client, not a remote attack.
- **Fix:** Enforce the 30 MB cap on bytes actually read from `request.stream()`, aborting with 413 once exceeded (concrete diff in lane-3 report).

### [DOC-headline] The authoritative requirements baseline contradicts the shipped code — *High* ✓ corroborated
- **Evidence:** `docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md` — **PNS-INV-005** is tagged `INVARIANT` and asserts *"Python is not part of the shipping React product"* (it is the entire backend); **PNS-ARCH-001** describes a "local-only **Node/Fastify** backend (active, not dormant)" (removed); **PNS-ARCH-003** is tagged `SHIPPED/TEST-ENFORCED` and lists 4 routes (`initial-state`, `detect-conflicts`, `generate-legend`, `import/excel`) that **do not exist** in the Python backend.
- **Impact:** This is the document the HLD names as the controlling baseline. A maintainer following it would treat Python work as a regression and write contract tests against routes that always 404.
- **Fix:** Reconcile the baseline to Python reality (or add a dated supersession banner like the HLD's). See doc-drift bulk below for the full 23-item list.

### [TEST-001] A passing test asserts behavior that can never happen in production — *High* ✓ corroborated
- **Evidence:** `shared/scheduler/excel-import.test.js:504-520` mocks a `200` from `POST /api/import/excel` and asserts the "backend parsed the file" path. But `backend_py/main.py` has **no such route** — every real call 404s and falls back to browser parsing (`excel-import.js:785`). The test is green but proves nothing about the shipped backend, while masking that the CPU-offload feature is unimplemented.
- **Fix:** Either implement `/api/import/excel` in the Python backend (restore the documented feature), or change the test to assert the **404→browser-fallback** path that actually ships, and update HLD §0.4 + the baseline accordingly. (Decide which — the route is documented in three places but built in zero.)

---

## P2 — Medium / Low

- **[ENG-002]** *Medium* — `migrateLoadedState`'s shallow merge silently drops nested `rules.maxConsecutiveInpatientDays` when loading older state, quietly disabling the consecutive-inpatient-day cap (HLD-INV-011, with an HLD-INV-008 "no silent guessing" flavor). **Same root cause as ENG-001.**
- **Doc-drift bulk** *Medium* — 23 total drift items across 6 files (lane-2 report): HLD line 14 (`v0.21.0 … Node/Fastify`), line 83, line 89, the §0.4 7-route table; `backend_py/README.md` (Python "dormant/parallel", "Node remains production", "Docker pending"); `backend_py/main.py` docstring (lines 1-13, "runs in PARALLEL with the Node backend… only /api/health"). The HLD top banner partially mitigates but stale body lines remain.
- **[BE-002/003/004]** *Low* — missing parent-dir `fsync` after `os.replace`; orphan temp file left on hard-kill with no startup sweep; absolute filesystem path leaked in the 500 error body.
- **[INV latent]** *Low/Info* — v1 contract schemas use `additionalProperties: true`; shipped state stores no PHI, but the schema wouldn't *forbid* a future caller adding a PHI key. Defense-in-depth only.
- **Test gaps** *Low* — no test loads a real **old-shape** state through `migrateLoadedState` (the gap that let ENG-001/002 ship); no test around the body-size limit (BE-001); auto-draft determinism is exercised but not asserted via an explicit run-twice-equal test.
- **Release misc / gitignore** *Low* — bundle `README.md` (05-20) repeats the "browser-storage-only / Docker serves static only" claim contradicted by the backend JSON mirror (`PNS-STALE-001`); confirm 0.21.0→0.22.0 tag consistency; transient dirs (`gui-review/`, `.playwright-mcp/`, `graphify-out/`) are correctly ignored.

---

## Cross-cutting themes (the graph-audit payoff)

**1. One root cause behind two findings + one test gap.** `migrateLoadedState` (`scheduler.js:1385`) deep-migrates *rotators* and *top-level* fields but never descends into `state.blocks[]` or nested `rules`. That single hole produces **ENG-001** (crash on missing `block.holidays`) **and ENG-002** (silent drop of `rules.maxConsecutiveInpatientDays`), and the missing "load an old state shape" test (TEST gap) is *why both shipped undetected*. Fix once — normalize block + nested defaults in `migrateLoadedState`, add a backward-compat test fixture — and three findings close together. ⚠️ Amplifier: the comment at `scheduler.js:1418-1420` documents a prior incident where a migration throw was swallowed by a try/catch that **"silently wiped saved state"** — so backward-compat bugs here risk data loss, not just crashes.

**2. The `/api/import/excel` ghost route surfaces in four independent lanes.** It's documented as `SHIPPED` (Lane 2), called by the client (`excel-import.js:785`), asserted by a green test (Lane 4 TEST-001), and absent from the backend (confirmed pre-dispatch). All four are the same story: **the Python backend was intentionally minimized to a "dumb backend," but the docs, one client call, and one test still assume the richer Node-era surface.** Resolving the route (implement vs. formally drop) clears all four at once.

**3. The migration is real and complete in *code*, but unfinished in *narrative*.** Lane 1 (invariants clean), Lane 3 (Node cleanly removed from source), and Lane 5 (Docker builds Python, host-binding pins loopback) all confirm the strangler-fig cutover succeeded. The remaining debt is entirely **documentation + release packaging** catching up — not architecture.

---

## What's solid (verified, no action needed)

- **All six privacy/scope invariants PASS** — local-only, loopback-only, no off-machine comms, **no AI/ML/solver, no PHI** (Lane 1). The offline test suite independently enforces "no off-machine communication primitives."
- **Backend security core is sound** — atomic same-dir-temp + `fsync` + `os.replace` never truncates the original (0600 perms); StaticFiles `..`-traversal blocked across all encodings; bind guard is an exact-literal allowlist that rejects loopback-spoofing strings and runs before `uvicorn.run`; no ReDoS in contract regexes (Lane 3).
- **Auto-draft engine is deterministic and manual-preserving** — `proposeSchedule`/`buildPlanningGrid` show no `Math.random`/wall-clock nondeterminism, existing assignments win over generated ones, and over-constrained slots emit unmet reasons rather than fabricating (Lane 6, HLD-INV-006/008/010 PASS).
- **341 tests green** — 253 vitest + 30 node:test (contracts freeze + offline + handoff) + 58 pytest. Contract freeze drift is test-enforced.
- **Docker host-binding satisfies HLD-INV-004** and the Node backend is fully removed from source (Lane 5).

---

## Fix roadmap (suggested order)

1. **Rebuild + repackage the Coordinator bundle** (REL-000) — blocks handoff; mechanical.
2. **Fix `migrateLoadedState` block/nested normalization + guard `scheduler.js:714`** (ENG-001 + ENG-002) — one change, add an old-state backward-compat test fixture (closes the TEST gap).
3. **Decide the `/api/import/excel` question** — implement it or formally drop it, then fix the test (TEST-001) and the three docs that list it.
4. **Stream-enforce the POST body cap** (BE-001).
5. **Reconcile the Super Requirements baseline + HLD §0.4 + backend docstring/README** to Python reality (DOC-headline + bulk) — a single doc-sweep PR.
6. **Low-severity hardening** (BE-002/003/004, schema `additionalProperties`, determinism assertion test) — opportunistic.

---

*Lane evidence: `graphify-out/audit-2026-05-24/lane-1-invariants.md`, `lane-2-doc-drift.md`, `lane-3-backend-security.md`, `lane-4-test-coverage.md`, `lane-5-release-hygiene.md`, `lane-6-engine-correctness.md`. Test log: `graphify-out/audit-2026-05-24/test-run.log`.*
