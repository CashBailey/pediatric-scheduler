# Coordinator feedback round — 2026-05-19

Source: 5 iMessage screenshots from Coordinator (the customer, a physician)
received 2026-05-19 around 21:30. She had walked through the React build
end-to-end and sent back six requests.

## What she asked for, and where it landed

| # | Request | Commit | Notes |
|---|---------|--------|-------|
| 1 | Don't show "JSON" anywhere in the UI | `c751bf0` | + Dashboard regression fix in `20bfa5f` |
| 2 | Let me open and preview an uploaded source | `e6241cf` | Sub-team A — see `sub-team-a-source-viewer.md` |
| 3 | Auto-create rotator profiles from uploaded Excel | `37186ec` | Sub-team B — see `sub-team-b-excel-ingest.md` |
| 4 | Per-rotator day-off (weekday) field | `621ea2e` | Sub-team C — see `sub-team-c-availability-fields.md` |
| 5 | Per-rotator unavailable date range (stackable) | `621ea2e` | Same merge — bundled with #4 |
| 6 | Show AM/PM continuity-clinic on Inpatient Calendar | `6f5174f` | Sub-team D — see `sub-team-d-clinic-display.md` |

## Files in this folder

- `meta-summary.md` — Meta-Lead orchestration summary (4-team multi-team run)
- `sub-team-a-source-viewer.md` — ST-A deliverable (request #2)
- `sub-team-b-excel-ingest.md` — ST-B deliverable (request #3)
- `sub-team-c-availability-fields.md` — ST-C deliverable (requests #4 + #5)
- `sub-team-d-clinic-display.md` — ST-D deliverable (request #6)

These are durable records — the design intent and trade-offs each team
made, useful when revisiting these features later.
