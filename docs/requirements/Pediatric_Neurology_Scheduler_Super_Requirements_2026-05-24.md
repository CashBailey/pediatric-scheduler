# Pediatric Neurology Scheduler - Super Requirements Baseline

Date: 2026-05-24  
Current shipping product: Native SwiftUI macOS app v0.26.0 with bundled Python/FastAPI scheduler engine; React/Vite remains the legacy browser/Docker path.
**Reconciliation note (2026-05-24, commit `b01cce6`):** The Node/Fastify backend was removed and the Python/FastAPI backend (`backend_py/`) is the shipping backend as of v0.22.0. PNS-INV-005, PNS-ARCH-001, and PNS-ARCH-003 have been corrected below to reflect this. Rows tagged STALE-DOC that described Node as production have been updated.  
**Native reconciliation note (2026-07-06):** The primary desktop surface is now the native SwiftUI macOS app. It boots a bundled Python/FastAPI engine, owns the native scheduling workflow, supports Coordinator DOCX import, backend commands, reports/exports, and packaged `.app` delivery. React/Vite remains in-repo for browser/Docker compatibility and historical behavior evidence, not as the primary desktop surface.
Primary purpose: one merged requirements baseline that keeps the best of the Claude and Codex investigations while removing duplication, stale assumptions, and false implementation history.

## 0. Executive summary

This document merges the two uploaded requirements investigations into a single working baseline for future development, release, and handoff decisions.

The merged baseline uses Claude's strengths for historical/provenance traceability, Python-to-React lineage, dropped capabilities, reversals, and open questions. It uses Codex's strengths for authority ordering, implementation risk, release/handoff requirements, test-contract framing, stale-document hazards, and operational acceptance details.

The governing rule is simple:

- Keep current requirements separate from historical provenance.
- Keep shipped behavior separate from requested-but-unbuilt behavior.
- Keep implementation evidence separate from source or user-direction evidence.
- Preserve unknowns instead of silently treating them as accepted or rejected.
- Treat local-only, no off-machine communication, no AI/ML, physician-in-control, no PHI, and rules-based behavior as binding invariants.

## 1. Critical corrections and decisions

These corrections should be pinned near the top of any permanent repo requirements document.

| ID | Correction or decision | Current meaning |
|---|---|---|
| PNS-CRIT-001 | The current primary product is the native SwiftUI macOS app with a bundled Python/FastAPI scheduler engine. | React/Vite remains a legacy browser/Docker path. Python/Qt is provenance only. |
| PNS-CRIT-002 | Neither implementation used CP-SAT or OR-Tools optimization as a real scheduler. | OR-Tools was a Python dependency or research branch artifact, not a shipped solver. React is deterministic and rules-based. |
| PNS-CRIT-003 | Local-only does not mean frontend-only. | A loopback-bound local backend is allowed. Off-machine communication is forbidden. |
| PNS-CRIT-004 | No AI/ML, no LLM parser, no preference learning, no stochastic/metaheuristic solver. | Any future automation must be deterministic, rule-explainable, and human-reviewed. |
| PNS-CRIT-005 | The app is a workforce scheduler, not a patient scheduler. | Patient names, MRNs, appointments, and PHI do not belong in the app. |
| PNS-CRIT-006 | The primary desktop handoff model is a packaged local `.app`; the browser/Docker bundle remains supported legacy packaging. | Customer handoff should not require Node, npm, Python, Git, or source checkout. |
| PNS-CRIT-007 | Current persistence is local-first. | Native uses backend JSON as the authoritative local state. The legacy browser UI still uses localStorage with a backend JSON mirror. |
| PNS-CRIT-008 | PDF, CSV, and editable Word export are shipped. | CSV files are included in the local export package; native Reports also writes schedule, daily-report, and roster/legend `.docx` handoff files. |
| PNS-CRIT-009 | Coordinator DOCX import is shipped in the native/backend path. | Generic non-Coordinator Word import remains a separate scope question, but Coordinator's monthly DOCX bundle is no longer a dropped capability. |
| PNS-CRIT-010 | Stale docs in the repo are not requirements. | Stale README, server comments, HLD AI/remote sections, and old release notes must be reconciled before being cited. |

## 2. How to use this document

Use this as the requirements baseline before changing scheduler behavior. For each proposed change, answer these questions:

1. Does it violate a binding invariant?
2. Is it current shipped behavior, a historical Python-only feature, an open ask, or superseded scope?
3. Is there test coverage that must be updated or preserved?
4. Is there a stale-doc hazard that could mislead a future developer?
5. Does it require a user or Coordinator decision before implementation?

Recommended permanent repo location:

```text
docs/requirements/Pediatric_Neurology_Scheduler_Super_Requirements_2026-05-24.md
```

## 3. Source authority model

When sources conflict, use this order.

| Rank | Source type | Treatment |
|---|---|---|
| 1 | Binding user/Coordinator direction and HLD Section 0 design override | Current authority. Local-only, no off-machine communication, no AI/ML, rules-based behavior, physician-in-control, and no PHI override older remote/AI language. |
| 2 | Current native SwiftUI app, Python backend, shared engine/contracts, tests, release notes, and handoff artifacts | Source of truth for what is actually shipped and test-enforced now. React remains authoritative for the legacy browser path. |
| 3 | Claude canonical matrix and Codex operational matrix | Reconciled requirements evidence. Use for planning, risk tracking, and gap analysis. |
| 4 | Original Python/Qt desktop app | Historical provenance only. It identifies ported, dropped, reversed, or superseded behavior. |
| 5 | Original HLD later sections and deep-research recommendations | Valid only when not superseded by the local-only, no-AI, rules-only decisions. |
| 6 | Stale comments, stale release README text, old roadmaps, and old phase plans | Do not treat as requirements without reconciliation. |

## 4. Evidence axes and status tokens

Every future row should separate these evidence axes:

| Evidence axis | Meaning |
|---|---|
| Source-derived | A user note, HLD, goal doc, feedback record, or transcript says it should be true. |
| Implemented | Current source, release notes, or verified behavior say it is present. |
| Test-enforced | A regression test, offline contract, backend test, schema, or handoff contract guards it. |
| Open or deferred | It is unresolved, intentionally postponed, unknown, or out of current scope. |

Use these status tokens consistently:

| Status | Meaning |
|---|---|
| INVARIANT | Binding rule or constraint. Violating it is a regression. |
| SHIPPED | Present in the current native product or the supported legacy browser path, as indicated by evidence. |
| TEST-ENFORCED | Covered by tests, schemas, or handoff contracts. |
| PARTIAL | Some pieces are shipped, but the full requirement is not. |
| DEFERRED | Still wanted or intentionally postponed. |
| NEVER-BUILT | Requested or designed, but built in neither implementation. |
| DROPPED | Existed in Python/Qt but was not carried into React. |
| SUPERSEDED | Replaced or killed by a later binding decision. |
| REVERSED | Built, then removed or behaviorally inverted. |
| UNKNOWN | Evidence is insufficient. Do not claim shipped or rejected. |
| OPEN | Needs a product, user, or implementation decision. |
| STALE-DOC | A repo/document statement is contradicted by current implementation. |

Confidence notation:

| Code | Meaning |
|---|---|
| C | Confirmed by source, code, release, or test evidence in the investigations. |
| I | Inferred from the investigations but should be verified before release. |
| U | Unknown or unresolved. |

## 5. Binding invariants and non-goals

These are the highest-risk requirements. Future work should not violate them without an explicit user decision that reopens the governing constraints.

| ID | Requirement | Status | Decision / implementation meaning |
|---|---|---|---|
| PNS-INV-001 | The app is local-only. State and files remain on the end user's machine. | INVARIANT | No cloud sync, remote database, remote logging, analytics, telemetry, or remote AI. |
| PNS-INV-002 | Runtime must not initiate off-machine communication. | INVARIANT / TEST-ENFORCED | Remote HTTP, WebSocket, telemetry, analytics, cloud sync, remote logging, and remote AI are prohibited. Loopback is allowed. |
| PNS-INV-003 | Local-only does not mean no backend. | INVARIANT | A local loopback backend is allowed as a helper API and persistence mirror. |
| PNS-INV-004 | Exposed service ports must remain loopback-only from the host. | INVARIANT / TEST-ENFORCED | Docker wildcard binding is allowed only under explicit trusted-container rules. |
| PNS-INV-005 | Current shipping domain logic is deterministic and local. | INVARIANT / TEST-ENFORCED | The native app runs Python backend commands for scheduling workflows and keeps parity with shared JS contracts/tests where both paths exist. The legacy React path still imports shared JS scheduler logic directly. |
| PNS-INV-006 | No AI/ML or solver-based optimization is in current scope. | INVARIANT | No CP-SAT, OR-Tools, stochastic search, preference learning, simulated annealing, tabu search, or LLM-assisted scheduling. |
| PNS-INV-007 | Automation must be deterministic and rule-explainable. | INVARIANT | Same input should produce the same proposal. Unmet slots should produce reasons, not fabricated assignments. |
| PNS-INV-008 | The app assists and proposes. The physician/user remains in control. | INVARIANT | Nothing is silently finalized or approved by the app. |
| PNS-INV-009 | No silent guessing. | INVARIANT | Missing critical dates, assignments, or source ambiguity must be flagged for review rather than inferred. |
| PNS-INV-010 | No patient-level data or PHI belongs in the app. | INVARIANT | Workforce scheduling only. Do not introduce patient names, MRNs, patient appointments, or clinical documentation. |
| PNS-INV-011 | User-facing UI should not expose raw JSON or developer jargon to physicians. | INVARIANT / SHIPPED | JSON may remain internal as a wire, import, backup, or debug format. |
| PNS-INV-012 | New state fields should be additive and backward tolerant. | INVARIANT / TEST-ENFORCED | Versioned contracts should tolerate additional properties so older states continue to load safely. |
| PNS-INV-013 | Manual entries win over auto-rules. | INVARIANT / SHIPPED | Auto-rules write only rows they created, preserve manual data, and remain idempotent. |
| PNS-INV-014 | Existing manual override surfaces are the refinement layer. | INVARIANT | Reuse drag/drop, paint, range assign, and conflict jump rather than creating parallel editing flows. |
| PNS-INV-015 | Date ranges use inclusive-end semantics. | INVARIANT / SHIPPED | Start <= date <= end throughout scheduling, eligibility, imports, and reports. |
| PNS-INV-016 | Outpatient scheduling is weekdays-only. Inpatient coverage is 24/7. | INVARIANT / SHIPPED | Do not reintroduce weekend OP auto-fill behavior. |
| PNS-INV-017 | Range assign IP and OP are mutually exclusive at the range surface. | INVARIANT | True same-day both is represented through per-page/manual forms and conflict display. |
| PNS-INV-018 | Multi-role-per-day inpatient assignments are intentional when roles differ. | INVARIANT / SHIPPED | Same-role overwrites or data loss are regressions. |
| PNS-INV-019 | At least one service block must always exist. | INVARIANT / SHIPPED | Deleting the final block is refused. |
| PNS-INV-020 | Security/privacy survivors remain binding. | INVARIANT / PARTIAL | No PHI, local audit/provenance, OS file permissions as trust boundary, and source retention remain live local requirements. |
| PNS-INV-021 | Customer handoff should not require source checkout or developer tools. | SHIPPED | Native package should run as a local `.app`; legacy browser/Docker handoff should require only Docker Desktop and the release folder. Do not require Node, npm, Python, Git, or source checkout for customer launch. |
| PNS-INV-022 | Current persistence is local-first. | SHIPPED / TEST-ENFORCED | Native uses a local backend JSON state file. Legacy browser mode uses localStorage with backend JSON mirror/recovery. |
| PNS-INV-023 | Enterprise scheduling, billing/payroll, duty-hour/accreditation reporting, patient scheduling, external email/calendar automation, analytics dashboards, and external sync are out of current scope. | INVARIANT / SUPERSEDED | Do not reopen without explicit direction. |

## 6. Current functional requirements

### 6.1 Service blocks

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-BLOCK-001 | Create, edit, select, and delete service blocks. | SHIPPED | Includes name, start/end, block type, fellow coverage ranges, holidays, no-clinic days, academic half-days, and output toggles. |
| PNS-BLOCK-002 | Support multiple blocks and block picker access across work surfaces. | SHIPPED | New-block chaining from the prior block end is part of the current behavior. |
| PNS-BLOCK-003 | Support configurable inpatient coverage demand by weekday, Saturday, Sunday, and holiday. | SHIPPED / TEST-ENFORCED | This supports missing and understaffed coverage detection and auto-draft demand. |
| PNS-BLOCK-004 | Prevent deletion of the last remaining service block. | SHIPPED | Required to keep app state valid. |
| PNS-BLOCK-005 | Completed-block archiving is not built. | NEVER-BUILT / OPEN | Useful for history, not for AI learning under the no-AI invariant. |

### 6.2 Sources, import, and source review

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-IMP-001 | Manage source files: upload/open/preview, replace in place, and delete source without deleting providers. | SHIPPED | Source delete must not cascade to rotators. |
| PNS-IMP-002 | Maintain expected sources and dashboard readiness. | SHIPPED / TEST-ENFORCED | Native Dashboard shows waiting/all-in status by comparing expected source programs to reviewed source records and active roster data. |
| PNS-IMP-003 | Import Excel roster files with preview and merge choice. | SHIPPED / TEST-ENFORCED | Merge modes include merge by name, replace roster, or add as new. |
| PNS-IMP-004 | Support matrix/grid Excel rosters with week-start headers and B/!B marks. | SHIPPED / TEST-ENFORCED | Native/backend `POST /api/import/roster` tests cover XLSX/XLSM matrix imports, coalesced runs, disjoint segments, and user-selectable `!B` behavior: include by default or exclude those weeks during review. |
| PNS-IMP-005 | Provide manual column mapping UI. | SHIPPED | Auto-detected fields, live preview, and warnings for missing or duplicate critical fields. |
| PNS-IMP-006 | Date parsing must be robust and must not silently drift. | SHIPPED / TEST-ENFORCED | Includes ISO, US slash, Excel serial, word-month, and 2-digit-year pivot behavior from the investigations. |
| PNS-IMP-007 | Try backend Excel parsing first and fall back to browser parsing if backend parsing is unavailable. | SHIPPED / TEST-ENFORCED | Must remain local-only. |
| PNS-IMP-008 | Coordinator Word/DOCX import is supported in the native/backend path. | SHIPPED / TEST-ENFORCED | Native Settings/Sources can preview and confirm the known Coordinator DOCX bundle or selected local Master/Inpatient/Outpatient DOCX files through local backend routes. Generic Word import outside that Coordinator workflow remains a separate decision. |
| PNS-IMP-009 | Generic non-Excel source upload needs guardrails. | PARTIAL / TEST-ENFORCED | Roster and Coordinator DOCX import routes cap request bodies, require absolute local paths, reject URL-like paths/unsupported extensions, and reject local source files larger than 25 MiB before parser entry. Roster import warnings persist on source records and appear in native review/export summaries; richer generic binary preview behavior remains a UX refinement. |
| PNS-IMP-010 | Source-file retention policy is unresolved. | OPEN / PARTIAL | Source records can be deleted without cascading to rotators, and import size limits are enforced. Final retention/deletion lifecycle policy remains open. |
| PNS-IMP-011 | Source provenance granularity is unresolved. | OPEN | Need decision between simple labels and richer spans/artifact IDs/confidence records. |

### 6.3 Roster and eligibility

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-ROSTER-001 | Maintain a Who's On Pedi roster for active rotators. | SHIPPED | Includes name, program/source, level/role, date segments, continuity, day off, unavailable ranges, notes/status/conflicts, and assignment metadata. |
| PNS-ROSTER-002 | One rotator may have multiple disjoint date segments. | SHIPPED / TEST-ENFORCED | Eligibility is based on actual overlap with the service block, not assumed full-block presence. |
| PNS-ROSTER-003 | Allow editable rotator cards and inline fields. | SHIPPED / TEST-ENFORCED | Includes day-off checkboxes, time-off ranges, per-segment pre-assignments, single delete, and native selected-roster bulk delete through the shared cleanup command. |
| PNS-ROSTER-004 | Duplicate cleanup must merge same-named rotators. | SHIPPED / TEST-ENFORCED | Shared/backend tests cover segment union plus inpatient, outpatient, and clinic assignment repointing; native desktop audit covers the Rotators command path and IP/OP session repointing. |
| PNS-ROSTER-005 | Hide/collapse rotators not active in the current block. | SHIPPED / TEST-ENFORCED / REVERSED HISTORY | Native Rotators and Fellows default to active-block providers, expose a show-all escape hatch, and show outside-block hidden counts. This was removed earlier and later re-added. Preserve it. |
| PNS-ROSTER-006 | Rotator contact information is not confirmed in React. | UNKNOWN | Keep unknown until verified or descoped. |

### 6.4 Planning grid and manual editing

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-GRID-001 | Planning Grid is the main visual scheduling work surface. | SHIPPED | Rotator by day matrix, weekday columns, status colors, totals, and active-block filtering. |
| PNS-GRID-002 | Planning Grid, Inpatient, and Outpatient operate as one tabbed work surface. | SHIPPED | State is preserved across tabs. |
| PNS-GRID-003 | Grid cells must distinguish unassigned, mixed, inpatient, outpatient, off, absent, and not-in-block states. | SHIPPED | The five-section completion model is a regression-sensitive area. |
| PNS-GRID-004 | Drag/drop must validate before assignment. | SHIPPED / TEST-ENFORCED | Invalid drops are refused with visible feedback. |
| PNS-GRID-005 | Paint mode must bulk-assign across one row while preserving mode/row boundaries. | SHIPPED / TEST-ENFORCED | Weekend OP runs must be broken correctly. |
| PNS-GRID-006 | Range assignment must clamp to block and skip invalid days. | SHIPPED / TEST-ENFORCED | Skip unavailable/off/out-of-segment days, report applied vs skipped, and support IP/OP/Clear. |
| PNS-GRID-007 | Range-assign OP behavior is additive, not destructive. | SHIPPED / REVERSED | Do not regress to destructive OP range behavior. |
| PNS-GRID-008 | Show valid drop targets while dragging. | SHIPPED / TEST-ENFORCED | Native Planning Grid previews valid and invalid inpatient drop targets, refuses invalid targets before command execution, and keeps backend `inpatient.drop` authoritative. |
| PNS-GRID-009 | Touch and accessibility behavior for dense badges and tooltip-only information is under-specified. | PARTIAL / TEST-ENFORCED | Imported half-day fact badges are now keyboard/click controls with source-detail popovers and VoiceOver labels/values; broader dense-badge criteria remain open if new badge types need the same treatment. |

### 6.5 Inpatient, outpatient, and daily report

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-CAL-001 | Inpatient calendar supports ON/OFF, AM/PM pull-outs, continuity notes, team senior, fellow coverage, academic half-day, weekend/holiday coverage, notes, and warnings. | SHIPPED | Keep multi-role behavior intact. |
| PNS-CAL-002 | Outpatient calendar supports AM/PM clinics, attendings, rotators, fellows/students, locations, continuity, CME, off, no-clinic, and stay-tuned statuses. | SHIPPED | OP is weekdays-only. |
| PNS-CAL-003 | Attending profiles include recurring clinic patterns and one-off dates. | SHIPPED | OP attending dropdowns filter by date and period. |
| PNS-CAL-004 | Multiple rotators may be assigned per attending/session. | SHIPPED / TEST-ENFORCED | Saving must not silently drop all but the last. |
| PNS-CAL-005 | Continuity-clinic display on inpatient calendar is shipped. | SHIPPED | Density and labeling refinement remain open. |
| PNS-CAL-006 | Daily Team Report provides a single-day operational summary and copyable text. | SHIPPED | Must remain physician-readable. |
| PNS-CAL-007 | Clinic occurrences can restrict eligible rotator roles through optional `allowedRoles` metadata. | SHIPPED / TEST-ENFORCED | Allowed values are Resident, Fellow, and Student; empty or missing means unrestricted. Native Settings edits the policy, Clinics filters eligible rotators, shared/backend validation rejects `role-not-allowed`, and conflicts report stale mismatches as `clinic-role-mismatch`. |

### 6.6 Rules and auto-draft

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-AUTO-001 | Auto-draft targets about 60 percent app-generated draft and 40 percent human review/editing. | INVARIANT / SHIPPED | Not a 90/10 autonomous optimizer. |
| PNS-AUTO-002 | Auto-draft fills required open inpatient slots first. | SHIPPED / TEST-ENFORCED | Most-constrained-first, fair, deterministic, and preserving existing/manual assignments. |
| PNS-AUTO-003 | Auto-draft honors availability constraints. | SHIPPED / TEST-ENFORCED | Includes day off, unavailable ranges, continuity blocks, max consecutive days, no double-booking, and role eligibility. |
| PNS-AUTO-004 | Auto-generated assignments are tagged. | SHIPPED / TEST-ENFORCED | Over-constrained slots produce unmet reasons. |
| PNS-AUTO-005 | Outpatient auto-drafting is deferred. | DEFERRED | Keep separate from inpatient auto-draft. |
| PNS-AUTO-006 | Methodist Adult Neurology uses true 28-day rotation start, 14 OP days and 14 IP days, with no reset at pediatric block boundaries. | SHIPPED / TEST-ENFORCED | Native Rotators can edit Methodist rotation start/side metadata; backend commands preserve it; this is a high-risk rule. Keep pinned tests. |
| PNS-AUTO-007 | Methodist OP weekend-fill was reversed. | REVERSED / SHIPPED | OP is weekdays-only even when the Methodist rotation spans weekends. |
| PNS-AUTO-008 | Preference-match stars are not built. | DEFERRED / NEVER-BUILT | Requires preference data fields and UI first. |
| PNS-AUTO-009 | OP workload/preference balancing is not built. | DEFERRED / NEVER-BUILT | Out of current 60/40 rules-based scope unless reopened. |

### 6.7 Domain scheduling rules

| ID | Rule | Status | Notes |
|---|---|---|---|
| PNS-RULE-001 | Methodist Adult-Neuro 28-day rule counts from true rotation start. | TEST-ENFORCED | 14 OP plus 14 IP, no pediatric block reset. |
| PNS-RULE-002 | UT Adult, Pediatrics, Psychiatry, and medical students use actual dates. | SHIPPED | Predetermined student assignments are preserved unless explicitly overridden. |
| PNS-RULE-003 | Inpatient assignment identity is date + rotator + role. | TEST-ENFORCED | Multiple rotators/roles per day do not overwrite. |
| PNS-RULE-004 | Outpatient session identity is date + period + rotator. | TEST-ENFORCED | Multiple rotators can share a session. |
| PNS-RULE-005 | Per-segment pre-assignments auto-fill IP/OP placeholders idempotently. | TEST-ENFORCED | Must skip unavailable/off days and preserve manual entries. |

### 6.8 Conflict detection

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-CONF-001 | Conflict detection identifies hard conflicts, warnings, and informational notes. | SHIPPED | Severity should remain user-readable. |
| PNS-CONF-002 | Detect out-of-active-segment assignments and invalid dates. | SHIPPED / TEST-ENFORCED | No assignment outside eligible date ranges. |
| PNS-CONF-003 | Detect day-off and unavailable assignments. | SHIPPED / TEST-ENFORCED | Critical when IP/OP appears on day off or unavailable date. |
| PNS-CONF-004 | Detect IP/OP double-booking. | SHIPPED / TEST-ENFORCED | Approved/manual exceptions need explicit handling if added later. |
| PNS-CONF-005 | Detect no-clinic outpatient sessions. | SHIPPED / TEST-ENFORCED | No-clinic days surface warnings in backend command-route tests. |
| PNS-CONF-006 | Detect missing and understaffed inpatient coverage. | SHIPPED / TEST-ENFORCED | Uses coverage demand model. |
| PNS-CONF-007 | Detect missing legend entries and legend/schedule mismatch. | SHIPPED / TEST-ENFORCED | Shared JS and Python backend conflicts flag scheduled rotators missing from the generated block legend. |
| PNS-CONF-008 | Detect continuity conflicts for IP and OP. | SHIPPED / TEST-ENFORCED | Backend and shared logic handle multi-slot continuity labels such as `Tuesday PM, Thursday AM` across conflict detection, validated inpatient draft placement, outpatient range fill, and Methodist auto-fill; imported first-class half-day pull-out facts prevent false whole-day inpatient continuity warnings for the matching period only. Continuity exceptions still need policy decisions. |
| PNS-CONF-009 | Conflicts route users to the page where the issue can be fixed. | SHIPPED / TEST-ENFORCED | Jump-to-page exists. |
| PNS-CONF-010 | Conflict focus scroll-and-highlight is shipped in native. | SHIPPED / TEST-ENFORCED | Native Reports rows route to the relevant Inpatient, Outpatient, Planning Grid, or Clinics surface, set the focused date/rotator/session metadata, scroll the target date into view, and apply focused row/chip/card styling. Further pixel polish is visual QA, not missing state behavior. |
| PNS-CONF-011 | Original post-hoc conflict checks are individually confirmed. | SHIPPED / TEST-ENFORCED | Backend command-route tests pin day-off/unavailable, no-clinic holiday, weekend outpatient, inpatient/outpatient continuity, missing legend, double-booking, coverage, clinic-placement conflict rows, and `clinic-role-mismatch`; command validation tests separately prove prevented-at-input constraints. |

### 6.9 Legend, export, and reporting

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-EXP-001 | Generate a numbered legend per block. | SHIPPED | Residents numbered. Fellows and medical students labeled by role rather than normal resident numbering. |
| PNS-EXP-002 | Export package should include roster, inpatient calendar, outpatient calendar, daily report, legend, conflict summary, and source import summary. | SHIPPED / TEST-ENFORCED | `export.package` writes explicit roster, inpatient-calendar, outpatient-calendar, daily-reports, legend, conflicts, source-import-summary, manifest, full-state package files, and CSV companions for roster/calendar/legend/conflicts/source summary. |
| PNS-EXP-003 | PDF export is shipped. | SHIPPED | Combined PDF and separate inpatient/outpatient PDFs are present per investigations. |
| PNS-EXP-004 | Word export and CSV export are shipped in local exports. | SHIPPED / TEST-ENFORCED | CSV package artifacts are built for handoff/reporting; native Reports also writes editable schedule, daily-report, and roster/legend `.docx` files. |
| PNS-EXP-005 | Excel export existed in Python/Qt but is not shipped in the current native product or the legacy browser path. | DROPPED / POSSIBLE LATENT | Do not call it never-requested. |
| PNS-EXP-006 | Exports are local downloads only. | INVARIANT / SHIPPED | No cloud destination. |
| PNS-EXP-007 | Export versioning, timestamp/exporter metadata, finalization, and change reasons are confirmed. | SHIPPED / TEST-ENFORCED | Export packages carry manifest version and generated timestamp; native Reports persists final review timestamp/exporter/check metadata; post-final edits append durable change reasons and native Reports surfaces the ledger. |
| PNS-EXP-008 | Shared vs separate legend numbering remains open. | OPEN | HLD Q1 unresolved. |
| PNS-EXP-009 | Fellow numeric vs label behavior remains open in policy terms, despite current labeling behavior. | OPEN / PARTIAL | Needs explicit decision if users care about numbering. |

## 7. Architecture, backend, persistence, and contracts

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-ARCH-001 | Current shipping architecture is native SwiftUI macOS app plus local-only Python/FastAPI scheduler engine (`backend_py/`). | SHIPPED | React/Vite remains the legacy browser path. ~~Node/Fastify~~ Node/Fastify backend was removed in v0.22.0. Python/FastAPI backend is active, not dormant. |
| PNS-ARCH-002 | Native UI owns desktop concerns. React/Vite owns legacy browser concerns. Backend commands and shared scheduler contracts own local scheduling behavior. | SHIPPED | Avoid duplicating domain logic across native, browser, and backend command surfaces. |
| PNS-ARCH-003 | Backend route contract (Python/FastAPI, v0.26.0) includes: `GET /api/health`, `GET /api/scheduler/state`, `POST /api/scheduler/state`, `POST /api/scheduler/command`, `POST /api/import/coordinator-docx`, and `POST /api/import/coordinator-docx/default`. | SHIPPED / TEST-ENFORCED | **Corrected (2026-05-24 and 2026-07-06):** Legacy browser-only routes such as `GET /api/scheduler/initial-state`, `POST /api/scheduler/detect-conflicts`, `POST /api/scheduler/generate-legend`, and `POST /api/import/excel` are not backend routes. Do not write backend contract tests against those four routes. |
| PNS-ARCH-004 | Backend persistence writes one scheduler-state JSON file locally. | SHIPPED / TEST-ENFORCED | Uses temp-file plus rename and handles missing/corrupt files safely. |
| PNS-ARCH-005 | Backend-first recovery restores from local JSON only when the backup appears to contain real user data. | SHIPPED / TEST-ENFORCED | Do not overwrite meaningful localStorage with empty backend state. |
| PNS-ARCH-006 | Versioned v1 JSON contracts validate core scheduler entities. | TEST-ENFORCED | Scheduler state, rotator, attending, service block, assignments, conflicts, and legend entries. |
| PNS-ARCH-007 | First-launch and migrated state must validate against scheduler-state v1. | TEST-ENFORCED | Prevent backend sync from silently failing. |
| PNS-ARCH-008 | SQLite is no longer the current requirement at this scale. | SUPERSEDED / DEFERRED | JSON-file persistence is accepted for now. |
| PNS-ARCH-009 | Multi-tab race handling is intentionally deferred. | DEFERRED | Current behavior is last-write-wins for a single-user local workflow. |
| PNS-ARCH-010 | Separate backend package setup is deferred. | DEFERRED | Revisit only if image size, tooling, or deployment complexity justifies it. |

## 8. Release, handoff, and verification requirements

Codex's operational ledger is preserved here as first-class requirements.

| ID | Requirement | Status | Notes |
|---|---|---|---|
| PNS-REL-001 | Primary customer release should run on Mac as a packaged local `.app`; legacy browser release should still run with Docker Desktop and the release folder only. | SHIPPED | No Node/npm/Python/Git/source requirement for customer use. |
| PNS-REL-002 | First launch must account for macOS quarantine. | SHIPPED | Right-click Open guidance should remain in native and legacy release docs. |
| PNS-REL-003 | Legacy browser default local URL is `http://localhost:6173`; `PORT` override is supported. | SHIPPED | Native app launches its bundled loopback backend without requiring the user to open a URL. |
| PNS-REL-004 | Legacy Docker image target follows the package version and remains `linux/amd64`. | SHIPPED | Update this row and release docs when the legacy Docker bundle is rebuilt. |
| PNS-REL-005 | Legacy persistent Docker volume is `pedi_scheduler_react_data`; native persistence is the local backend JSON state file. | SHIPPED | Docker volume mounts at `/home/app/.local/share/pedi_scheduler`; native path is owned by the bundled backend. |
| PNS-REL-006 | Native release must include packaged `.app` zip contents, customer README, SHA-256 file, and package manifest; legacy release folder must include README, WHATS_NEW, run script, stop script, compose file, image hash, and release tarball/zip contents. | SHIPPED / TEST-ENFORCED | Keep native package and handoff tests aligned with actual bundles. |
| PNS-REL-007 | Mac launch scripts or app bundles must be executable, local-only, and idempotent. | SHIPPED / TEST-ENFORCED | Legacy scripts stop/remove existing containers safely; native app verifies bundled runtime provenance. |
| PNS-REL-008 | Native regeneration flow is Xcode build, bundle engine resources, sign, verify, and zip; legacy regeneration flow is build, Docker build, Docker save/gzip, sha256, and zip release folder. | DOC-IMPLEMENTED | Keep release instructions accurate. |
| PNS-REL-009 | Handoff tests must enforce native bundle/runtime expectations and legacy Dockerfile/static/backend/compose expectations. | TEST-ENFORCED | Also check that comments match actual assertions. |

Recommended verification surface for meaningful changes:

| ID | Requirement | Status |
|---|---|---|
| PNS-TEST-001 | Run `npm test`, `npm run test:offline`, and `npm run build` for broad React changes. | BINDING PROCESS |
| PNS-TEST-002 | Offline tests must reject off-machine URLs, analytics, telemetry, remote sockets/logging, and non-localhost binding. | TEST-ENFORCED |
| PNS-TEST-003 | Backend bind tests must allow loopback, reject normal wildcard/nonlocal hosts, and allow Docker wildcard only with explicit trust flag. | TEST-ENFORCED |
| PNS-TEST-004 | First-launch and migrated state must validate against scheduler-state v1 contracts. | TEST-ENFORCED |
| PNS-TEST-005 | Domain workflow changes need equivalence coverage. | BINDING PROCESS |
| PNS-TEST-006 | Re-run the suite before relying on the exact passing-test count. | OPEN / PROCESS |

Suggested equivalence coverage for domain workflow changes:

- State migration
- Service blocks
- Rotators and date segments
- Methodist logic
- Preassignments
- Planning grid
- Drag/drop, paint, and range assign
- Conflicts
- Reports
- Legend
- Excel import
- Export and PDF export
- Offline/local-only contracts
- Backend persistence and recovery

## 9. Python-to-React lineage

The Python/Qt app is superseded but remains important because it prevents ported, dropped, or never-built capabilities from being confused.

| Capability | Python/Qt status | React status | Current disposition |
|---|---|---|---|
| Domain model, service blocks, rotators, Methodist rule, conflicts, daily report, legend concepts | Built or partly built | Rebuilt in React/shared JS | PORTED / RESHAPED |
| `.xlsx` roster import | Built | Built in React through SheetJS/client plus backend path | PORTED / RESHAPED |
| `.docx` schedule or roster import | Built deterministically with `python-docx` and regex | Not in React | DROPPED / WORKFLOW-SUPERSEDED / POSSIBLE LATENT |
| Excel export | Built in Python | Not carried forward as React Excel export | DROPPED |
| Plaintext export | Built in Python | React has text/package behavior, but PDF is main user export | PARTIAL / RESHAPED |
| Word export | Planned/requested | Shipped in native/backend as editable schedule, daily-report, and roster/legend `.docx` files | PORTED / RESHAPED |
| CSV export | Planned/requested | Shipped as local export-package artifacts | PORTED / RESHAPED |
| SQLite repository layer | Built in Python | Replaced by localStorage plus backend JSON mirror | SUPERSEDED |
| CLI control harness | Built in Python | Not part of React handoff | DROPPED |
| Fellow timeline widget, daily availability strip, display-mode combo | Python-only UI features | Not React requirements today unless re-requested | DROPPED |
| CP-SAT/OR-Tools solver | Dependency/research artifact, not used for scheduling | Not used; deterministic rules engine | NEVER-BUILT / SUPERSEDED |
| AI assistant or AI parser branch | Placeholder/research/deferred | Explicitly out by no-AI invariant | SUPERSEDED |

## 10. Reversal and regression history to preserve

| Event | Current interpretation |
|---|---|
| Planning grid section model changed from earlier models to a five-section completion model. | Preserve Needs Assignment, Mixed, Fully IP, Fully OP, and Not in Block semantics. |
| OP range assign changed from destructive to additive AM+PM. | Do not regress to destructive OP range behavior. |
| Methodist OP weekend-fill was reversed. | OP is weekdays-only even when Methodist rotation spans weekends. |
| Active-in-block filter was removed and later re-added/renamed. | Active provider filtering remains part of the current work surface. |
| Backend went from dormant/static to active loopback persistence, then from Node/Fastify to Python/FastAPI (v0.22.0, Node removed). | Do not trust old comments saying the backend is dormant or that Node is production. |
| Drag/drop and paint shipped broken in one release and were fixed afterward. | Keep tests around validation, row/mode boundaries, and weekend run behavior. |
| Seed/demo initial state was replaced by a clean empty initial state. | Do not reintroduce seeded customer data as default state. |
| Missing-column warnings evolved into the Column Mapping UI. | Do not treat older missing-column warnings as current behavior. |
| LocalStorage-only release language became stale after backend JSON mirroring shipped. | Release docs must describe the actual local recovery mirror. |

## 11. Outstanding backlog and open decisions

These are not automatically out of scope. They are unresolved, deferred, unknown, or still needing a user/product decision.

| ID | Item | Status | Decision needed |
|---|---|---|---|
| PNS-OPEN-001 | Word export | SHIPPED / TEST-ENFORCED | Native/backend now emits editable schedule, daily-report, and roster/legend `.docx` files; future asks should specify additional formatting constraints if needed. |
| PNS-OPEN-002 | CSV export | SHIPPED / TEST-ENFORCED | CSV files are included in the local export package for handoff/reporting; future asks should specify additional CSV shapes if needed. |
| PNS-OPEN-003 | Excel export in React | DROPPED | Decide whether to restore from Python capability or keep PDF-only. |
| PNS-OPEN-004 | Generic DOCX/Word import beyond the Coordinator schedule bundle | PARTIAL / POSSIBLE LATENT | Coordinator Master/Inpatient/Outpatient DOCX import is shipped natively; broader Word import formats require explicit source-file workflow decisions. |
| PNS-OPEN-005 | Preference-match stars | DEFERRED / NEVER-BUILT | Requires preference data fields and entry UI first. |
| PNS-OPEN-006 | Conflict focus visual polish beyond shipped native scroll/highlight | OPTIONAL POLISH | Native scroll/highlight behavior is shipped and test-enforced at the wiring level; only additional aesthetic polish remains discretionary. |
| PNS-OPEN-007 | Continuity-clinic pill density/labeling refinement | OPEN | Decide desired density and combined labeling behavior. |
| PNS-OPEN-008 | Block archive for completed schedules | NEVER-BUILT / LATENT | Decide if needed for history. Not for AI learning. |
| PNS-OPEN-009 | Source-file retention policy | OPEN / PARTIAL | Source delete and 25 MiB import-size guardrails are shipped; decide final retention, archival, deletion, and privacy lifecycle behavior. |
| PNS-OPEN-010 | Source provenance detail | OPEN | Decide simple source labels vs raw spans/artifact IDs/confidence. |
| PNS-OPEN-011 | Accessibility/touch behavior for dense calendar badges | PARTIAL / TEST-ENFORCED | Half-day fact badges have non-tooltip source-detail popovers and screen-reader labels/values; define broader criteria if continuity, conflict, or count badges need equivalent treatment. |
| PNS-OPEN-012 | Generic source upload guardrails | PARTIAL / TEST-ENFORCED | Backend caps import request bodies, rejects relative/URL-like paths, rejects oversized local roster/Coordinator source files before parsing, and rejects unsupported roster/Coordinator extensions. Richer binary/preview warnings remain optional polish. |
| PNS-OPEN-013 | Outpatient auto-draft | DEFERRED | Decide if this enters scope separately from inpatient auto-draft. |
| PNS-OPEN-014 | Clinic-specific policy configuration | PARTIAL / TEST-ENFORCED | Clinic occurrences can optionally restrict allowed roles through `allowedRoles` policy metadata from native Settings; empty or missing means unrestricted. Shared/native/backend placement rejects mismatches and reports stale mismatched assignments. Final clinic-by-clinic defaults and softer preferences remain product decisions. |
| PNS-OPEN-015 | OP preference/workload balancing | DEFERRED / NEVER-BUILT | Decide if balancing is needed under rules-only constraints. |
| PNS-OPEN-016 | Approved-exception audit status and reasoned override ledger | UNKNOWN / PARTIAL | Post-final edit reason ledger is shipped; decide if a separate formal approved-exception audit UI/table is required. |
| PNS-OPEN-017 | Rotator contact information | UNKNOWN | Decide if allowed and where it belongs. |
| PNS-OPEN-018 | Performance targets | UNKNOWN | Define and measure targets if needed. |
| PNS-OPEN-019 | Export versioning, finalization, and change-reason metadata | SHIPPED / TEST-ENFORCED | Export package version/timestamp, native final review metadata, command-level post-final change reasons, and native Reports ledger display are shipped. |
| PNS-OPEN-020 | `!B` matrix-roster semantics | SHIPPED / TEST-ENFORCED | Native roster review lets the user include `!B` weeks or exclude them before applying the import; backend route tests cover both behaviors. |
| PNS-OPEN-021 | Undo history | SHIPPED / TEST-ENFORCED | Native Edit menu and toolbar undo/redo snapshot raw backend scheduler-state bytes, cap history depth, restore through the validated state route, and are exercised by the Planning Grid edit/undo/redo native UI audit. |
| PNS-OPEN-022 | Team sharing | DEFERRED / CONFLICT RISK | May conflict with local-only/no-off-machine invariant. Needs explicit scope change. |
| PNS-OPEN-023 | Year-ahead planning view | DEFERRED / NICE-TO-HAVE | Block chaining partially addresses this. |
| PNS-OPEN-024 | SheetJS audit advisory and build chunk warning | DEFERRED TECH DEBT | Track separately from functional requirements. |
| PNS-OPEN-025 | Raw May 19 iMessage screenshots and May 21/22 notes | TRACEABILITY GAP | Repo has derived summaries only. Preserve gap in traceability notes. |
| PNS-OPEN-026 | Shared vs separate legend numbering | OPEN | HLD original question remains unresolved. |
| PNS-OPEN-027 | Fellow numeric vs label policy | OPEN / PARTIAL | Current behavior labels by role, but policy should be explicit. |
| PNS-OPEN-028 | Continuity clinic always-override vs approved exception | OPEN | Requires user policy decision. |
| PNS-OPEN-029 | Exact test count | OPEN / PROCESS | Re-run before citing exact passing count. Older counts are stale. |

## 12. Superseded, rejected, or not current scope

These should not be treated as backlog unless the user explicitly reopens them.

| ID | Item | Disposition |
|---|---|---|
| PNS-SUP-001 | Remote backend/database/cloud architecture | SUPERSEDED by local-only design override. |
| PNS-SUP-002 | Remote REST API as deployment architecture | SUPERSEDED. Only loopback local helper API survives. |
| PNS-SUP-003 | AI assistance layer and AI behavior/guardrails | SUPERSEDED by no-AI and no off-machine decisions. |
| PNS-SUP-004 | LLM-assisted import of messy text/email/Word | SUPERSEDED / NEVER-BUILT under no-AI invariant. |
| PNS-SUP-005 | CP-SAT, MILP, min-cost-flow, OR-Tools optimization branch | SUPERSEDED / NEVER-BUILT under rules-only invariant. |
| PNS-SUP-006 | Stochastic/metaheuristic optimization | SUPERSEDED by deterministic rules-only invariant. |
| PNS-SUP-007 | 90/10 autonomous scheduling or inverse optimization from history | SUPERSEDED by 60/40 human-review model and no learning system. |
| PNS-SUP-008 | OptimizationRun, versioned solver lineage, ImportArtifact/ParsedFact solver-style entities | NEVER-BUILT and tied to rejected solver/LLM architecture. |
| PNS-SUP-009 | RBAC/authentication/access-control tiers | SUPERSEDED by single-user local model. Informational roles may survive, but permission enforcement is moot. |
| PNS-SUP-010 | Encrypted transport language | SUPERSEDED because off-machine transport is forbidden. |
| PNS-SUP-011 | Remote observability, telemetry, analytics, and remote logging | SUPERSEDED by local-only/no off-machine invariant. |
| PNS-SUP-012 | Automated email/calendar/subscription integrations | SUPERSEDED by no off-machine communication. |
| PNS-SUP-013 | Python/Qt desktop architecture as current product | SUPERSEDED by React rewrite. |
| PNS-SUP-014 | Enterprise scheduling, billing/payroll, duty-hour/accreditation reporting, patient scheduling, complex attending optimization, analytics dashboards, external sync | OUT OF CURRENT SCOPE | Reopen only with explicit direction. |

## 13. Stale documentation and false-requirement hazards

These should be fixed or flagged in the repo so future work does not rely on outdated claims.

| ID | Stale or contradictory statement | Current truth | Priority |
|---|---|---|---|
| PNS-STALE-001 | Older customer release language said data was browser-storage-only and Docker only served static React files. | Corrected in current release docs: native saves to local backend JSON, while the legacy browser path saves in browser storage and mirrors to a local Docker-volume JSON file. Python/FastAPI is the current native/backend path. | Resolved |
| PNS-STALE-002 | `backend_py/README.md` (pre-2026-05-24) described Python as a dormant parallel port with Node still as production. | Node removed in v0.22.0. Python/FastAPI is the shipping backend. `backend_py/README.md` corrected. | High |
| PNS-STALE-003 | Rules page copy says conflicts are mainly double-booking/no-clinic holidays. | Implementation also detects unavailable/day-off, missing/understaffed coverage, missing legend, and continuity conflicts. | Medium |
| PNS-STALE-004 | Later HLD sections still describe AI assistance, remote API, multi-tier deployment, auth/access-control, and observability. | HLD Section 0 and no-AI/no-off-machine decisions supersede those sections. | High |
| PNS-STALE-005 | Backend refactor goal final artifact references v0.17.1. | Current package/release is v0.21.0. | Medium |
| PNS-STALE-006 | May 19 feedback meta says the customer Docker bundle was stale. | Current release compose targets v0.21.0. | Medium |
| PNS-STALE-007 | Handoff-test comment implies tarball hash verification. | Resolved: `tests/handoff-contract.test.mjs` checks the tracked hash shape, verifies it against the Docker tarball whenever that gitignored artifact is present, and pins `scripts/build-release.sh --check` to compare `IMAGE_SHA256.txt` with the tarball before handoff. | Resolved |
| PNS-STALE-008 | Old missing-column warning behavior is still mentally treated as current. | Column Mapping UI is the current requirement. | Medium |
| PNS-STALE-009 | Old backend/static assumptions remain in comments or release text. | Backend is active Python/FastAPI loopback persistence and API (Node removed in v0.22.0). | High |

## 14. Recommended permanent repository shape

A durable requirements document should be a traceability table plus narrative sections, not a narrative-only memo.

Recommended columns:

| Column | Purpose |
|---|---|
| Requirement ID | Stable ID, preferably preserving original Claude/Codex lineage in notes where available. |
| Requirement | One canonical statement. |
| Source evidence | HLD, Coordinator/user note, WHATS_NEW, git, Python app, transcript, goal doc, etc. |
| Current implementation evidence | Source path, release note, verified behavior, or code reference. |
| Test evidence | Test file, schema, offline contract, or handoff contract if enforced. |
| Status | INVARIANT, SHIPPED, TEST-ENFORCED, PARTIAL, DEFERRED, DROPPED, SUPERSEDED, UNKNOWN, OPEN, or STALE-DOC. |
| Current decision | What a future developer should do with it. |
| Notes | Reversals, caveats, port/drop details, unresolved semantics, stale-doc risks. |

Recommended top-level order:

1. Binding invariants and non-goals
2. Current product workflows
3. Data model and persistence
4. Import/source management
5. Scheduling rules and auto-draft
6. Conflict detection and manual override
7. Export and handoff
8. Release/test contracts
9. Python-to-React lineage
10. Outstanding/deferred/unknown items
11. Superseded/rejected items
12. Stale documentation hazards

## 15. Near-term cleanup plan

### 15.1 Fix stale documentation first

1. ~~Update release README to describe backend JSON mirroring and Python/FastAPI backend serving static plus API.~~ Current native and legacy release READMEs describe local backend JSON persistence/mirroring.
2. ~~Update `backend/src/server.js` header~~ Node backend removed in v0.22.0; `backend_py/README.md` corrected instead.
3. Update Rules page copy to reflect the actual conflict detector.
4. Add a short HLD errata note explaining that later AI/remote/RBAC/observability sections are superseded by the Section 0 local-only/no-AI override.
5. Update old v0.17.1 release artifact references to v0.21.0 or remove version-specific final-artifact language.
6. Verify the handoff test comment against actual assertions and either strengthen the test or soften the comment.

### 15.2 Decide open user-facing backlog

Top decisions to settle before major new feature work:

1. Word/Excel export priority and exact expected output format; any additional CSV shapes beyond the shipped local package files.
2. Whether generic DOCX import beyond the shipped Coordinator schedule workflow matters for real source files.
3. Any additional conflict-focus visual polish beyond shipped native scroll/highlight.
4. Source retention policy; maximum source file-size handling is shipped at the backend route boundary.
5. Accessibility/touch requirements for dense calendar badges.
6. Continuity clinic exception policy.
7. `!B` matrix import semantics.

### 15.3 Protect regression-sensitive areas

Keep or add tests around:

- Offline/no off-machine communication contract
- Loopback binding and Docker trust flag
- LocalStorage plus backend JSON recovery
- Service-block deletion guard
- Actual rotator date-segment eligibility
- Methodist 28-day true-start logic
- Manual-entry preservation in auto-draft
- OP weekdays-only behavior
- Drag/drop validation
- Paint row/mode boundaries
- Additive OP range assignment
- Multi-rotator OP session saves
- Multi-role inpatient assignment identity
- Conflict jump routing
- Legend mismatch and missing coverage checks

## 16. Acceptance checklist for future changes

Before merging or handing off a scheduler change, verify:

- The change does not introduce off-machine communication.
- The change does not introduce AI/ML, remote inference, stochastic optimization, or CP-SAT/OR-Tools scheduling.
- The change does not introduce patient-level PHI.
- Manual entries remain preserved over generated assignments.
- State changes are additive or migrated safely.
- Export/import behavior is physician-readable and does not expose raw JSON in normal UI.
- Existing localStorage plus backend JSON recovery still works.
- Release docs match actual persistence and backend behavior.
- Stale repo comments are not used as source of truth.
- Relevant tests have been run: `npm test`, `npm run test:offline`, and `npm run build` when appropriate.
- Any unresolved item is marked OPEN, UNKNOWN, DEFERRED, DROPPED, or SUPERSEDED rather than silently assumed.

## 17. Provenance of this merged baseline

This document was synthesized from the two uploaded Markdown investigations dated 2026-05-24:

- `claude_Scheduler_Requirements_Merged_2026-05-24.md`
- `codex_Scheduler_Merged_Requirements_2026-05-24.md`

The merge intentionally keeps the Claude document's strong historical lineages, two-implementation framing, functional evidence axes, open questions, and CP-SAT correction. It also keeps the Codex document's authority model, status vocabulary, current-operational ledger, release/handoff acceptance criteria, stale-document hazard list, open-risk expansion, and recommended permanent traceability shape.

This merge did not independently re-run the scheduler repository tests or inspect every referenced source path. Treat inherited file/line references and test counts as investigation evidence until verified in the repository. Before release or code changes, rerun the test suite and inspect the live repo.
