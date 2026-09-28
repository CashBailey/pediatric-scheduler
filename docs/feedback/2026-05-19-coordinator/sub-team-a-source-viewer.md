# Sources tab: open and preview uploaded files (Coordinator request #2)

## 1. Team structure
- **lead (me)** — phase routing, design decisions, integration, commit.
- **implementer (me)** — wrote the schema extension, the file-reader wiring, the SourceViewer modal, and the CSS.
- **critic (mental pass)** — adversarial review against offline contract, plain-English rule, no-removed-fields rule, sub-team-b field-name compatibility, click-handler edge cases.

The task was small and well-scoped (one page, one component, one schema field, no algorithmic work), so the full team apparatus was downgraded per SKILL.md guidance ("one specialist plus a Critic… downgrade the team"). Spawning parallel research/verifier agents would have added orchestration cost without finding more than a careful mental critic pass did.

## 2. Result

**What shipped (commit `e6241cf`):**

1. **Schema extension** (`src/scheduler.js`) — `addSource` now defaults two new fields on every new source record:
   - `content: string` — raw text of the uploaded file
   - `parsedRows: Array<object>` — structured rows (used by spreadsheet ingest)
   Existing seed source (`source-ay-roster`) keeps working because viewer handles the empty case explicitly.

2. **File reading** (`src/App.jsx`, SourcesPage) — when the user picks a local file, a `FileReader` reads it as text (local-only; no network) and stores the contents on the source record. File input is reset after each pick so the same file can be re-uploaded.

3. **Viewer UI** (`src/App.jsx`, new `SourceViewer` component) — a centered modal triggered by clicking a row OR an explicit **Open** link in a new last column. Layered render priority:
   - If `parsedRows` is a non-empty array → render as an HTML table with column headers derived from row keys.
   - Else if `content` has text → render in a monospace pre block with wrapping.
   - Else → friendly plain-English message: *"This file was added before previews were available, or its contents could not be read here. Upload it again to see the rows or text inside."*

4. **Styling** (`src/styles.css`) — modal overlay/card, clickable row hover, link-style Open button, muted hint text, source-preview-text monospace block. Honors the existing dark/light theme via CSS variables.

**Why a modal over inline expansion or a side drawer:**
- Inline expansion would push the table around as users browse; bad UX for a clinician scanning sources.
- A side drawer competes with the main workspace area.
- A centered modal is the most familiar pattern for "open this document," gives maximum width for tabular data (1000px cap), and is dismissible by clicking the backdrop, the Close button, or focusing elsewhere.

**Plain-English audit** — all visible strings: "Click a row to open the file and review what was uploaded.", "Reviewed Sources", "Open", "Close", program/file/status/imported labels, and the empty-state message. No "JSON", "payload", "schema", "manifest", etc.

**Offline contract** — `FileReader.readAsText` is local-only; no `fetch`, `XMLHttpRequest`, `WebSocket`, `http(s)://`, or `sendBeacon` introduced. Offline contract tests pass.

**Verification:**
- `npm test` → 4/4 vitest pass
- `npm run test:offline` → 4/4 node:test pass (8 total)
- `npm run build` → clean, 7.14 kB CSS, 223.71 kB JS

## 3. Critical review

**Major objections raised (and answered):**
- *"What if sub-team-b chose a different field name than `parsedRows`?"* — Risk accepted by designing the viewer to handle both shapes (`parsedRows` first, `content` fallback). I verified mid-task that sub-team-b shipped `applyImportedRoster` which already writes `parsedRows` — names align by coincidence and by being the obvious choice. Flagged below as a brokering candidate so the Meta-Lead can confirm.
- *"Existing seed source has neither field — does the viewer crash?"* — No: viewer uses `Array.isArray(source.parsedRows) ? source.parsedRows : []` and `typeof source.content === 'string' ? source.content : ''`, falling through to the empty-state message.
- *"Click handler on the row AND on the Open button — won't they fight?"* — The Open button calls `event.stopPropagation()` so it doesn't double-fire.
- *"Excel binary files will be garbled if read as text."* — True, but sub-team-b's `applyImportedRoster` writes `parsedRows` and the viewer prefers `parsedRows` over `content`, so spreadsheets get the structured view automatically. Plain text/CSV files render through `content`. Mixed case (Excel uploaded via my flow, before sub-team-b's import runs) is the one rough edge.

**What changed because of them:**
- Added safe-default handling in `addSource` itself (rather than only in the viewer) so localStorage rehydration of older records still serializes a consistent shape going forward.
- Added the explicit "Open" link column in addition to whole-row clicking, so the affordance is discoverable for keyboard/screen-reader users.

**Remaining uncertainty / risk:**
- If a user uploads a `.xlsx` directly via the Sources tab file picker (instead of going through sub-team-b's import path), the modal will show garbled binary text. Mitigation depends on what UX sub-team-b ships on the Sources page — if they replace the picker, this concern disappears. Documented as a brokering candidate.
- Large files (>5 MB plain text) will be read fully into memory and into localStorage. No truncation guard added. For Coordinator's roster files this is fine; longer-term, a size limit on what gets persisted (vs. just shown) would be prudent.

## 4. Codex usage

Not used. The implementation was small and judgment-heavy (UI/UX choices, plain-English wording, schema compatibility with a parallel team). No mechanical refactor or large code generation warranted delegation.
