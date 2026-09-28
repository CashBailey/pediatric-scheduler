# Meta-prompt — Implement the Coordinator 2026-05-29 fix-map

**plan → implement → screenshot-test → analyze → repeat, until all *unblocked* items pass.**

This is an **operating prompt**, not documentation. Paste the whole thing into a fresh
Claude Code session opened at the repo root (`/home/raptor-lab-laptop2/VScode/scheduler`)
and it will drive an iterative loop over the fix-map until every item that *can* be done
is done and proven with a screenshot. Items that genuinely cannot be done yet (decisions
Coordinator owes, data not arrived) are *parked with a reason*, not guessed.

---

## 0. Mission & single source of truth

- **Source of truth:** [`docs/feedback/2026-05-29-coordinator/fix-map.md`](./fix-map.md).
  **Re-read it in full at the start of every session.** It owns the item IDs
  (`B1 B2 · A1 A2 A3 · C1 C2 · F1 F2 · U1 U2 U3`), their priority tiers, and the exact
  `file:line` each one points at. This prompt does **not** restate the fixes — it tells you
  how to *execute* them. If this prompt and the fix-map ever disagree, the fix-map wins.
- **Governing priority (Cash's words):** *"ensure the main algorithms are working… put up the
  drywall before the hedge molding."* Work strictly in tier order
  **P0 → P1 → P2 → P3 → P4.** Do **not** touch a P4 polish item while any P0–P2 item is open.

---

## 1. Prime directives (hard rules — violating one is a failure, not a judgment call)

1. **Tier + dependency order.** **B1 is doubly-first**: it is P0 *and* it restores the Sources
   tab you need to reach the import flow through the UI. Do it before anything that needs imported data.
2. **Gated items: STOP and surface — never guess.**
   - **A1** carries the spec's own gate: *"do not write code until the plan is reviewed."* Produce
     the staged plan, present it, and **wait** for Cash before writing solver code.
   - **D1–D4** (fix-map "Open decisions") need *Coordinator's* answer. **D3 (auto-assign vs. assist)
     is the dangerous one** — guessing it builds the wrong scheduler. Park, don't assume.
3. **Don't break what works.** `src/App.jsx` is one ~5,146-line file — **edit it sequentially,
   never with parallel agents** (concurrent edits to one file collide). The app is a manual
   construction tool; any solver must **seed** the grid and leave existing manual paint/range
   entries intact (the dedupe already guarantees this — preserve it).
4. **Commits only when Cash authorizes them.** Default: leave changes in the working tree and
   report. The **one** file you always create/commit is the ledger (rule 5).
5. **The ledger is a committed file** (`progress-ledger.md`, §6) — update it every iteration so
   progress survives context compaction. Never keep progress only in your head.

---

## 2. Step Zero — load a deterministic seed fixture (ONCE, before any screenshot)

**Why this is step zero:** the priority items only render something to photograph *after a
roster is loaded.* `A2` ("Coordinator / Eden" candidates), `C1` (Methodist phantom), and `C2`
(filtered tabs) all show nothing on an empty app. A screenshot loop with no seed stalls on its
first real item.

- **Use the fixture that already exists:** `createDemoState()` in
  [`shared/scheduler/test-fixtures.js`](../../../shared/scheduler/test-fixtures.js). It ships a
  realistic block with **five rotators incl. a Methodist one (`Maya Lopez`)**, plus UT-adult,
  UT-peds, a student, and a fellow (`Sam Carter`). **That Methodist rotator is what lets you test
  `C1`'s phantom-clinic bug synthetically today** instead of waiting for June's real Methodist
  schedule.
- **Inject it through the app's real state path.** The backend exposes
  **`POST /api/scheduler/state`** (`backend_py/main.py:97`) which **validates against
  `scheduler-state.v1` and persists** — the cleanest, safest seed path. So: `node`-dump
  `createDemoState()` to JSON, `POST` it to that endpoint (the backend then serves it via
  `GET /api/scheduler/state`), reload the app, and **confirm with a screenshot that the Rotators
  page lists all five.** (If a schema field is rejected, that's a signal the fixture drifted —
  fix the fixture, don't bypass validation.) The app's own (de)serialize helpers live in
  `src/storage.js`.
- **When the demo lacks what an item needs** (a *second* fellow for A2's slash-list; real
  requested-days-off for A3/rule-9; an uploaded fellow source for F1): **extend the fixture
  synthetically** (e.g. add a second fellow) — do not wait on real data, and do not fake the
  on-screen result.

---

## 3. Run-the-app & screenshot mechanics (pin these — they're verified to exist)

**Live dev needs TWO processes** (vite alone gives a live shell over dead data):

| | command | where |
|---|---|---|
| Backend (API) | `npm run server` | Python, serves `/api` on `127.0.0.1:6174` |
| Frontend | `npm run dev` | Vite on `127.0.0.1:5173`, proxies `/api` → 6174 |

**Per-page screenshots (primary path): Playwright MCP.**
`browser_navigate` → `http://127.0.0.1:5173/` → `browser_click` the sidebar item →
`browser_take_screenshot` → save under `verification/results/coordinator-fixes/<ID>/<before|after>.png`.
This is how you get a shot of a *specific* page/interaction.

**Regression gate (tier boundaries only):**
- `npm run build && npm run e2e:audit` — headless-Chrome smoke (Chrome is on PATH); **note it
  only screenshots `/`**, so it's a smoke gate, *not* a per-feature check.
- `npm run verify:project` — full sweep: build + `vitest` + offline contracts + Python backend
  tests + CLI probes + browser audit. Artifacts land in `verification/results/`.

**"Analyze the screenshot" means exactly this:** after capturing the PNG, **open it with the
Read tool** (Read renders images visually) and **write down what you actually see and whether it
matches the item's acceptance criterion** (§5). "Looks fine" is banned — state observed-vs-expected.

---

## 4. The loop (run this for every item, in tier order)

```
SELECT  → PLAN → IMPLEMENT → TEST → JUDGE → RECORD → (repeat)
```

1. **SELECT** the next unblocked item in tier order. If it's gated (A1 plan-review, a D-decision,
   or missing data with no synthetic substitute) → write a PARKED row in the ledger with the
   blocker and skip it.
2. **PLAN** — read its fix-map entry **and** the cited `file:line`. Write a 3–5 line plan **and
   the explicit acceptance criterion** (the specific thing the screenshot must show, from §5).
   For Large items (A1) use full plan/brainstorm discipline and stop for review (rule 2).
3. **IMPLEMENT** — the minimal change that satisfies the criterion, matching the surrounding
   code's idiom. New algorithm/validation logic (A1/A2/A3) **must ship with a vitest case**
   (extend `shared/scheduler/scheduler.test.js` / the existing suites).
4. **TEST — three layers, all required for a "pass":**
   - **Logic:** `npm test` (add `npm run test:offline` if you touched `shared/contracts/`;
     `npm run test:py` if you touched `backend_py/`). Green, including your new case.
   - **Visual:** with the seed loaded, Playwright-navigate to the affected page, screenshot to
     `verification/results/coordinator-fixes/<ID>/after.png`, **Read it, and analyze against the
     criterion.** For the **regressions C1 & C2, capture a BEFORE too** (on current `main`, before
     your edit) so the before/after pair proves the fix.
   - **Gate:** at each **tier boundary**, `npm run verify:project` must be green before you advance
     to the next tier.
5. **JUDGE** — pass **only if** logic tests are green **and** your written screenshot analysis
   confirms the criterion. If either fails → return to PLAN/IMPLEMENT. **This is the "rinse and
   repeat": iterate the same item until its screenshot proves it, then move on.**
6. **RECORD** — update the item's ledger row: status, screenshot path, *what the screenshot showed
   in words*, test names added.
7. **REPEAT** to the next item; when a tier is fully passed/parked, run the gate and start the next tier.

---

## 5. Acceptance criteria — what each screenshot must confirm

The screenshot for an item is "pass" only when it shows the right column. (P0–P2 are spelled out
because they're in scope now; P3/P4 are summarized — expand them when their tier is reached.)

| ID | The screenshot must show… | Tests to add |
|----|---------------------------|--------------|
| **B1** | **"Sources"** as a **top-level sidebar item** (≈position 3, after Rotators); clicking it opens the import page; the Roster page's help text no longer points at a missing tab | grep test for a `sources` nav id; assert `PAGES` includes it |
| **B2** | The Dashboard renders the **4-step workflow prose** ("First, import… Finally, finalize"); step 1 links to the restored Sources page | snapshot/DOM assert the 4 steps render |
| **A1** | *(GATED — plan first.)* After review: a formerly-`noop` program (start **UT-peds**) now **auto-splits IP/OP by length** — the seeded grid fills instead of staying empty, and pre-existing manual entries survive | per-program split unit tests; "manual entries preserved" test |
| **A2** | A blank fellow cell renders the **candidate slash-list** (e.g. `Sam Carter / <2nd fellow>`), **not** red **"unresolved"**; single active fellow → that one name | candidate-pool resolver unit tests (0 / 1 / many fellows) |
| **A3** | A **validation report** panel listing the new assertion types; seed a known violation and confirm it's reported (and a clean seed reports none) | one unit test per new assertion |
| **C1** | **BEFORE:** with the Methodist rotator seeded, the Clinics page shows a phantom **"Methodist Outpatient"** card + empty **white bar**. **AFTER (per chosen D1 option):** phantom gone / real clinic shown. Separately confirm stale labels clear on a **clean re-import** | `isRealClinicName` unit test for `METHODIST_OP_CLINIC` |
| **C2** | Planning Grid has **Master / Inpatient / Outpatient editable filter tabs**; the Inpatient tab shows **only IP-assigned** rotators — visibly distinct from the read-only *Inpatient Schedule* tab | `rowVisibleInView` filter unit test |
| **F1** | *(P3)* Fellows page has a **fellow-source upload** + **editable fellow cards** (day-off, continuity clinic, IP-first/OP-first); pinned ★ rows in the grid | — |
| **F2** | *(P3 — already shipped)* Just **confirm discoverability**: the *Clinic poster* / *Inpatient poster* download buttons are findable and export a PDF | — |
| **U1 / U2 / U3** | *(P4 — deferred)* U1: clicking the card header toggles expand/collapse. U2: removing a rotator is guarded (confirm/undo/danger-styled/moved). U3: Ctrl+Z undo works and doesn't fall through to the browser | reducer/history + keydown tests for U3 |

---

## 6. The ledger (create this first, commit it, update it every iteration)

Create **`docs/feedback/2026-05-29-coordinator/progress-ledger.md`** with this shape and keep it current:

```
| ID | Tier | Status | Screenshot | What the screenshot showed | Tests added | Blocker |
|----|------|--------|------------|----------------------------|-------------|---------|
| B1 | P0   | todo   | —          | —                          | —           | —       |
```

`Status ∈ {todo, in-progress, passed, parked}`. A `parked` row **must** name its blocker
(which D-decision / which missing input / "A1 awaiting plan review").

---

## 7. Termination — what "all done" actually means (it is NOT "every item")

- **DONE** = every **unblocked** item is `passed` (criterion confirmed by screenshot analysis +
  green tests) **and** `npm run verify:project` is green **and** the ledger reflects it.
- **PARKED (legitimately not done):** items blocked by —
  - a **D1–D4 decision** Coordinator owes,
  - the **A1 plan-review** gate (Cash must approve the solver plan before code),
  - **external data not yet arrived:** Methodist schedule (expected **first half of June 2026**),
    fellow schedule **re-upload**, **requested days-off** (not yet collected).
- **When only parked items remain: STOP.** Emit a short summary — one line per parked item naming
  its blocker — and hand back to Cash. **Do not loop on parked items and do not guess decisions.**

---

## 8. Guardrails / reminders

- Re-read the replaced source docs in the context folder before regenerating any schedule
  (treat the *replaced* files as authoritative — per the spec's execution prompt).
- Solver **seeds**, user **edits on top** — never clobber manual entries.
- Multi-agent fan-out is fine for *read-only* work (parallel screenshot-and-analyze across several
  pages, independent verification of a finished fix). Keep **all edits to `App.jsx` sequential.**
- If a screenshot needs an interaction the seed can't reach, **extend the fixture** — don't fabricate
  the result or mark the item passed on a guess.

---

*Companion to `fix-map.md`. Generated 2026-05-31; commands/paths/fixtures verified against the
working tree at the current `main` (`pedi-scheduler-react` v0.26.0).*
