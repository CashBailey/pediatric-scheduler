# A1 — Auto-scheduling algorithm: staged plan (for Cash's review)

**Status: awaiting review. No solver code will be written until this plan is approved
and decisions D2/D3 are made** (the SPEC's own "do not write code until the plan is
reviewed" gate, and the meta-prompt's hard rule 2).

This turns the fix-map's A1 7-step skeleton into a concrete, reviewable build plan: the
entrypoint, the data flow, the per-program order, the test strategy, and the two decisions
that block code.

---

## What exists today (the starting point)

The app is a **manual construction tool**, not an auto-scheduler. The only automation:
- `applyMethodistAutoAssign` — Methodist 28-day → 14 IP / 14 OP split (`scheduler.js:1932`).
- `applyPreassignments` — fills cells the user *manually* marked with a segment phase (`scheduler.js:1987`).

Everything else is an explicit no-op. The dispatch seam already exists:

```
// shared/scheduler/program-rules.js
applyProgramRules(state, block, rotator)  // dispatches on rotator.schoolType
  methodist     → applyMethodistAutoAssign   ✅
  ut-adult      → noopAutoAssign             ⛔
  ut-peds       → noopAutoAssign             ⛔
  ut-student    → noopAutoAssign             ⛔
  ut-psychiatry → noopAutoAssign             ⛔
  other         → noopAutoAssign             ⛔
```

**The plan is to replace these no-ops one program at a time, each behind tests.**

---

## The entrypoint (proposed)

A single pure function, seeded into the existing seam — no new architecture:

```js
// shared/scheduler/scheduler.js (or a new generate-draft.js it re-exports)
// Pure: (state, block) -> { state, report }. Never mutates input.
generateDraft(state, block, { mode } = {}) -> { state, report }
```

- **Iterates rotators in the block**, calls `applyProgramRules` per rotator (the seam already
  does this for Methodist), accumulating IP/OP assignments + outpatient sessions.
- **Idempotent & non-destructive** (mirrors `applyPreassignments`): re-running yields the same
  result, and it **never overwrites a manual entry** — the existing slot-dedupe guarantees the
  solver only *seeds* empty cells; the user edits on top. This is the invariant Cash cares about
  ("solver seeds, user edits").
- Returns a **validation `report`** (this is A3) alongside the seeded state.
- Surfaced as a **"Generate draft"** action on the Planning Grid (wiring TBD by **D3**).

---

## Per-program build order (each step = its own PR + tests)

Ordered by leverage (highest-volume rotators first), matching the fix-map:

| Step | Program rule (SPEC #) | What it computes | Decision needed |
|------|----------------------|------------------|-----------------|
| 1 | **Length-based split** (rule 3) for `ut-peds` + `ut-adult` | 3+ wk ≈ half IP / half OP · 2 wk = 1 IP + 1 OP · 1 wk = single side | — |
| 2 | **5-week anti-burnout pattern + sandwich guard** (rule 4) | OP/IP/IP/IP/OP; never IP-sandwiched-by-OP-singletons; keep 3 IP consecutive | — |
| 3 | **Methodist start-side selection** (rule 5b) | choose IP-first vs OP-first by staffing/continuity | **D2** |
| 4 | **Staffing minimums + "IP before OP"** (rules 10/11) | weekday fellow+2 (prefer +3); weekend variants; fill IP need before OP | — (minimums are spec'd) |
| 5 | **Day-off engine** (rule 9) | 1 day off/wk, prefer weekend, fellow weekend priority, Fri/Mon fallback | — |
| 6 | **Year-balance** (rule 6) for UT peds/adult | balance IP/OP across non-consecutive blocks → needs cross-block per-rotator state | — |
| 7 | **Fellow program rule** (rule 2) | fellow follows template; blank + multiple active → emit **candidate names** (this is **A2**) | **D4** (pick gesture) |
| 8 | **Psychiatry** (rule 7) | 4–5 wk split, continuity over balance | — |
| — | **Validation report** (rule 12) | asserts all of the above → **A3** (data-validation subset is already buildable now, see ledger) | — |

Steps 1–2 (UT peds/adult length split + pattern) deliver the most visible value first.

---

## Test strategy

- **Pure-function unit tests** in `shared/scheduler/scheduler.test.js` (the suite already has
  395 tests + a `createDemoState()` fixture with one rotator per program — ready to assert against).
- Per step: given a known block + rotator, assert the exact IP/OP day pattern; assert
  **manual entries are preserved** (seed a manual cell, run `generateDraft`, confirm it's untouched);
  assert **idempotency** (run twice → identical state).
- Each step also gets a browser screenshot (seed → Generate draft → grid fills as expected) per
  the meta-prompt loop.
- Gate every step on `npm run verify:project`.

---

## The two decisions that block code (need Cash → Coordinator)

- **D3 — auto vs. assist (blocks the whole entrypoint's wiring).** Does "Generate draft"
  **fully auto-assign** everyone (seed the grid, user edits on top), or only **flag/suggest** and
  leave placement manual? The SPEC reads as auto-seed-then-edit; **the `generateDraft` signature
  above assumes auto-seed.** If it's assist-only, step 4/5's "fill" logic becomes "suggest" logic.
  **This is the dangerous one to guess** — it changes what the algorithm *is*.
- **D2 — Methodist start side (blocks step 3 only).** Algorithm picks OP-first vs IP-first by
  staffing need, or keep the current fixed OP-first default (`methodistOutpatientFirst`)?
- **D4 — fellow candidate pick gesture (blocks step 7 / A2 only).** When a blank fellow cell shows
  "Coordinator / Eden", how does she pick — click-in-cell, or resolve on the Fellows page?

**Recommendation:** confirm **D3** first (it gates everything). Steps 1–2 can be *designed and
unit-tested* against the pure split rules even before D3, since they only compute a per-rotator
IP/OP day pattern; only the *wiring* (auto-seed vs suggest) waits on D3.

---

*Companion to `fix-map.md` (A1) and `meta-prompt.md`. Surfaced 2026-05-31 for async review so
the slowest gate (human decisions) clears while the unblocked P2/A3 work proceeds.*
