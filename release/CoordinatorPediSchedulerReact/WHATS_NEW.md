# What's New In This Build

This build addresses everything you sent over on May 19, plus the workflow
improvements added since — including your May 27 notes (all eight items below).

## 0.25.0 — Clearer label on auto-filled outpatient days

You asked, on the call: *"Why does it say Methodist outpatient?"* When the app fills in an
outpatient day for you — from the date-range tool or a pre-assignment — and you haven't
named the clinic yet, it used to label that day **"Methodist Outpatient"** even for someone
who isn't a Methodist resident, which was confusing. Those generic placeholder days now read
**"Outpatient (clinic TBD)"** instead, so the label tells you the clinic just hasn't been
set yet. Actual Methodist 14/14 outpatient days still correctly say "Methodist Outpatient."

Nothing else changes: these are only labels, so your schedule, coverage counts, and exports
behave exactly as before. (Note: outpatient days you'd *already* saved before this update
keep their old label until you reassign them — only newly filled days pick up the clearer
wording.)

If the spot you saw it was somewhere else, send a screenshot and we'll catch that one too.

## 0.24.0 — Launch fix + three from our May 27 call

First, the important one: **0.23.0 wouldn't start on your Mac** because the
launcher was still pointed at the previous version's app image, so it tried to
fetch one that doesn't exist and the page never loaded. That's fixed, and we
added a safety check so the launcher and the app image can never fall out of
sync again. This build (0.24.0) starts the same way: double-click
**run-on-mac.command**.

Three things from our call are in this build:

- **Removed the confusing "Select" option from Paint mode.** Paint mode is now a
  single on/off switch. Off = normal clicking, exactly like before. On = the
  **Inpatient / Outpatient / Off / Reset** tools. No more mystery "Select" that
  didn't seem to do anything.
- **Fixed the import preview where the columns looked shifted.** When you opened
  a roster you'd uploaded, the dates and continuity-clinic ("Tuesday PM")
  columns looked offset — the date range showed under the wrong heading and the
  Clinic column looked empty. That was only the *preview* drawing itself wrong;
  your saved roster was always correct. The preview now lines up: one **Dates**
  column and one **Clinic** column, each showing the right thing.
- **"Peek past block end" — see two weeks beyond the block.** You wanted to
  confirm your rotators continue with you into the next block instead of being
  pulled to another service for the last days. There's now a **Peek past block
  end** switch on the Planning Grid: turn it on and the grid shows exactly two
  weeks past the block's end, with
  those extra days tinted and marked off by a divider so you know they're beyond
  this block. The roster stays focused on *your* block's people — turning peek
  on won't suddenly pull in people who only belong to the next block. For now
  those peeked days are **view-only** (so you can't accidentally edit next
  month from this view); editing across blocks could come later if you want it.

### One thing still open on the import

The column-offset fix above is about how the preview *draws*. There's a separate
question we haven't been able to answer yet: in your
`Adult_Neurology_Pedi_Neuro_Roster_GROUPED_BY_ROTATOR.xlsx`, **is the continuity
clinic actually different per person, or does the file itself list the same
value (e.g. "Tuesday PM") for everyone?** The app reads whatever the file says,
per row — but we can't tell from a screenshot whether the sameness you saw is
the file or something collapsing it. **Send that .xlsx and we'll close this for
certain.** Everything else above is done and verified.

## 0.23.0 — Your May 27 wishlist (all eight)

Everything you sent over on May 27 is in this build. A few of these are tweaks
to things you already had; a couple are brand-new.

- **Set continuity clinic with AM/PM buttons (multiple allowed).** On a
  provider's card, continuity clinic is now a Monday–Friday × AM/PM button
  grid — tap the half-days they have clinic. You can set more than one (e.g.
  Tuesday PM *and* Thursday AM). Anything you'd typed before (like "Tuesday PM")
  shows up already selected.
- **The planning grid now reacts when you override a profile preference.** If a
  provider is pre-set to outpatient (or inpatient) on their profile and you
  paint them the other way, the day gets a small **"!"** badge and a heads-up
  message — it still does what you asked, it just tells you you're overriding
  the preference so nothing happens silently.
- **No one can be both inpatient and outpatient on the same day.** Painting or
  dropping one now clears the other for that day automatically, so a person is
  only ever on one side per day. (Splitting across *different* days — the
  Methodist 14/14 "Mixed" case — works exactly as before.)
- **Drag-and-drop a provider into a category.** You could grab a name before but
  there was nowhere to drop it. Now you can drop a provider onto the **Inpatient**,
  **Outpatient**, or **Mixed** section headers: Inpatient/Outpatient assigns them
  that way for the whole block, and Mixed clears the block role so their days can
  vary. (Dragging a name onto a single day still works too.)
- **Paint over something to reset it.** The paint toolbar's **Reset** clears
  whatever's already in the days you sweep — including a day you marked OFF —
  back to unassigned.
- **Weekends and holidays show as their own cells now.** Saturdays, Sundays, and
  no-clinic holidays appear as individual day columns. On the **outpatient** side
  those days are blocked (clinic doesn't run then). On the **inpatient** side you
  can assign any day, because the hospital needs coverage every day.
- **Mark someone OFF with a distinct dark color.** The paint toolbar has a new
  **Off** option. Painting it marks the day OFF in a dark cell with its own
  legend swatch — clearly different from the gray "off-service" slash used when
  someone simply isn't on service.
- **Group the "Who's On Pedi" roster by source.** Provider cards are now grouped
  by program/source, with a **"Group by source"** toggle so you can still see
  everyone in one flat list whenever you want (grouped is the default).

The two standalone **Inpatient** and **Outpatient** menu entries are gone, since
the planning page already has those as tabs — and the per-side **PDF download**
buttons now live right on those tabs, so nothing was lost.

As always: **nothing leaves your computer.**

## 0.22.1 — Reliability fixes (nothing changes in how you use it)

- **Older saved schedules always open now.** In rare cases a schedule saved by an
  earlier version could fail to open; those load cleanly again, and your per-block
  rules (such as the limit on consecutive inpatient days) are preserved instead of
  being quietly dropped.
- **Sturdier saving.** Behind-the-scenes hardening of the helper that saves your
  schedule to a file — more resilient to interruptions and unusually large saves.
  No change to how you use the app.

As always: **nothing leaves your computer.**

## 0.22.0 — Behind-the-scenes rebuild (nothing changes for you)

The small "helper" that runs alongside the app on your computer — the part that
saves your schedule to a file and serves the app — was rebuilt from the ground
up in a different programming language. **Nothing about how you use the app
changes:** same pages, same buttons, same schedules, same saved data. You start
it the same way (double-click **run-on-mac.command**) and stop it the same way.

Why bother, then? It makes the app simpler to maintain and build on going
forward. We test-drove this build end to end before sending it — it loads,
saves, reloads, and serves the app exactly as before.

As always: **nothing leaves your computer.** No internet calls, no accounts, no
data sent anywhere. The app still runs entirely on your Mac, reachable only from
your Mac.

## 0.21.0 — Generate a draft schedule with one click

The app can now build a first draft of the inpatient schedule for you, so you
spend your time adjusting instead of filling everything in by hand.

**1. Tell it how many people each day needs.** On the **Block Setup** page there's
a new **Coverage Demand** box: set how many residents inpatient coverage needs on a
weekday, Saturday, Sunday, and holiday. It saves as you type. (There's also a
"Pre-fill from this block's current schedule" button to start from what's already
there.) Leave it alone and it behaves exactly like before (a weekday needs 1).

**2. Click "Generate draft schedule."** On the **Inpatient** page, the new button
fills every open day up to the number you set — fairly (spreading the load evenly)
and within the rules: it won't double-book anyone, won't put someone past 6 days in
a row, and skips anyone who's off or has clinic that day. It asks you to confirm
first, and it never touches assignments you've already made.

**3. Review and fix the rest.** The draft is yours to edit — drag a name, paint
across days, or use the date-range tool, exactly as before. Any day it couldn't
staff (not enough people available) shows up on the **Conflicts** page so nothing
is missed silently.

Every choice it makes follows a clear rule you can see — there's no AI and nothing
leaves your computer. It's meant to do most of the work so you only adjust the rest.

**Also fixed:** the Block Setup page now correctly saves edits to a block's name
and dates (previously those could revert).

## 0.20.1 — Reliability fixes (please use this build, not 0.20.0)

A full run-through of 0.20.0 in a real browser turned up four issues that
are all fixed here. If you were sent 0.20.0, replace it with this build.

- **Your schedule now saves reliably.** In 0.20.0 the app's saved copy on
  the computer wasn't actually being written — your work only lived in the
  browser's temporary storage. Now it's saved properly, so it survives
  closing the browser or clearing its data.
- **Recovery works.** If the browser's storage ever gets cleared, the app
  now correctly restores your schedule from the saved copy.
- **Drag-a-name-onto-a-cell works.** In 0.20.0 the drop didn't register.
  Dragging a rotator's name onto a day now assigns them as intended.
- **Paint across multiple days works.** In 0.20.0 a paint sweep only marked
  the first day. Now sweeping across several days marks all of them.

## 0.20.0 — Drag rotators onto cells + drag-paint multi-day assignment

The two big interactive features from your May 22 phone call. All six
phone-call items are now live in the app.

### Drag a rotator name onto a cell to assign them inpatient

On the Master Planning tab, you can now grab a rotator's name (the row
label on the left edge of the grid) and drag it onto any cell. On
release, that rotator is added to inpatient coverage for that day.

Chess-style validation — if the drop would be invalid (rotator isn't
on service that day, has a day-off conflict, is in an unavailable
range), the drop literally won't land. The cell visually dims, the
cursor shows "not allowed," and the rotator chip snaps back to where
it started. No silent bad assignments.

Tooltip on the cell while hovering during a drag tells you why a drop
would be refused if it would be.

### Paint mode for drag-selecting multiple days

A new "Paint mode" toolbar at the top of the Master tab. Three radio
options: Off (default) / Inpatient / Outpatient. When Off, the grid
behaves as before. When Inpatient or Outpatient, you can click a cell
and drag across other cells in the same row — every day under your
mouse joins the selection. On release, those days are assigned to
that rotator for the chosen side (inpatient or outpatient).

The selection visualizes with an amber outline while you sweep. The
sweep stays in one row at a time (we don't accidentally paint someone
else's row). If you drag over a weekend, weekends are skipped — the
runs commit as separate weekday ranges.

If you flip the radio mid-drag, the in-flight sweep keeps the mode it
started with — no half-paint corruption.

### Internal: a tested foundation

Both features sit on top of pure-logic helpers in `shared/scheduler/`:
- `validateDrop(state, rotatorId, date)` — the chess-style validity check
- `applyDrop(state, rotatorId, date)` — the assignment writer
- `paintReducer` + `selectionToContiguousRuns` — the paint state machine

Each is unit-tested (8 + 13 specs respectively). The UI glue layers
on top, but the load-bearing logic is independent and reusable.

## 0.19.0 — Four planning-grid upgrades from the May 22 phone call

Everything in this build came out of the phone-call wishlist that was
researched and planned earlier in the day. Four of the six items shipped
here; the remaining two (drag-and-drop rotator chips, drag-paint bulk
assign) need their own focused session and will come in 0.20.

### 1. Planning-grid cells are now properly colored

Same color rules you've always had, but turned UP so cells actually
match their legend swatches at the top of the page. The salience
hierarchy is now right:
- **Unassigned** days (the coverage gap you scan for) are the most
  visually loud cell — amber, bold.
- **Mixed (IP + OP same day)** cells get a small red stripe on the
  left edge so even if you can't tell green from blue at a glance,
  the split jumps out.
- **Inpatient** (green) and **Outpatient** (blue) cells are now clearly
  distinct backgrounds instead of nearly-transparent tints.
- **Off** and **Absent** stay quiet — they're the "nothing to look at"
  signals.

### 2. Planning grid hides rotators not in this block

A new checkbox on the planning grid: "Only show providers active in
this block" (on by default). With it on, rotators whose dates land
entirely outside the current block don't appear — so when you're
scheduling May, you're not scrolling past July arrivals. Click the
checkbox to see your full roster. Mirrors the same toggle you've had
on the Who's On Pedi page.

### 3. Click a conflict to jump to where to fix it

The Conflicts page now shows each conflict as its own row with a
severity-colored left edge and a "Jump to X →" button. Clicking the
button takes you to the page where you can resolve the conflict
(Inpatient for an inpatient overlap, Outpatient for an outpatient
overlap, Legend for missing-legend issues). Find the conflict, click,
land on the right page. You still scroll to the date yourself for
now — the auto-scroll-and-highlight is a follow-up.

### 4. Planning Grid, Inpatient, and Outpatient are now one page with tabs

The three sidebar entries (Planning Grid, Inpatient, Outpatient) now
all open the same page with three tabs at the top (Master Planning /
Inpatient / Outpatient). The Master tab is the planning grid you
already know. The Inpatient and Outpatient tabs are the same calendars
you had on their separate pages — just one click away now instead of
a sidebar trip. The old in-grid Master/Inpatient/Outpatient filter is
gone — the top-level tabs serve that purpose now.

When you switch tabs, scroll position and any open form state on the
other tabs are preserved — they're rendered but hidden, not unmounted.

## 0.18.0 — Your text + phone-call asks (the four formal ones)

Four targeted upgrades from the May 22 conversation, all aimed at the
schedule you need to start sending by June 15.

### Separate PDFs for inpatient and outpatient

The Export page now offers three PDF buttons instead of one: a separate
inpatient PDF, a separate outpatient PDF, and the original combined
PDF. Each separate PDF includes the provider legend and any conflicts
that apply to that side, so the inpatient recipient and the outpatient
recipient each get a complete, distributable document.

### Source start / end dates carry over to rotator profiles

The Excel importer now recognizes ~30 different header names for the
start and end date columns (everything from "Start Date" to "On Service"
to "Arrival" to "First Day"). If your file uses a header we still don't
guess, the Column Mapping panel on the import dialog lets you pick the
right column manually — the panel always shows in the import flow.

### Delete rotator profiles, one at a time or in bulk

Each rotator card on the "Who's On Pedi" page now has a checkbox in the
top-right. Tick as many as you want, then click "Delete N selected" at
the top to remove them all in one go. Their assignments and outpatient
sessions are cleared with them. Single-rotator delete (per-card) is
still there too.

### Continuity clinic shows as an auto-blocked half-day

If a rotator's continuity clinic is set to "Tuesday PM" (or similar),
their availability section now shows a clear "Auto-blocked half-day:
Tuesday PM" callout. Scheduling an outpatient session for the same
rotator on a Tuesday PM (for any clinic that isn't the continuity
clinic itself) now fires a Warning conflict so you can spot the
overlap. The inpatient-side overlap was already flagged; this catches
the outpatient side too.

## 0.17.2 — Recovery + faster Excel imports

Two small but useful upgrades over 0.17.1. Day-to-day everything still
looks and feels the same.

### Recovery from a localStorage clear

If your browser ever loses the schedule (a Chrome profile reset, an
extension misbehaving, accidental "clear site data"), the app now
automatically restores it from the backup file the backend has been
saving since 0.17.0. The recovery happens silently on the next time
you open the app — you should see your work intact instead of a blank
new schedule.

How it decides whether to restore: only when the backup file actually
has user data (rotators, assignments, or sessions, or more than the
default block). If the backup is empty and the browser has your real
data, we don't touch what's in the browser.

### Excel imports now go through the backend (when possible)

When you upload an `.xlsx` roster, the file is sent to the local
backend for parsing, and only falls back to in-browser parsing if
the backend can't be reached. For typical roster sizes this is
imperceptible, but on large rosters the UI thread stays responsive
during parsing instead of briefly freezing.

If the backend is unavailable for any reason, the upload still works
— it just parses in the browser the way it always did.

## 0.17.1 — Internal cleanup pass (no visible changes)

Same workflows, same URL, same behavior as 0.17.0. This build cleans up
the internal "redirect files" that the source code used during the
multi-step move to the new frontend + backend architecture. None of
those files affected what the app does for you — they were scaffolding
for the migration. With them removed, the codebase is in its final
shape, which makes future improvements faster to make and harder to
get wrong.

If you were running 0.17.0 successfully, 0.17.1 will look and feel
identical.

## 0.17.0 — App saves are now mirrored to a local file

The backend that arrived in 0.16.0 is no longer dormant — it now keeps a
copy of your schedule on the persistent volume inside the container,
synced automatically as you work. Your day-to-day experience should be
unchanged: same URL, same workflows, your edits still save instantly the
moment you make them. The browser's `localStorage` is still the primary
source of truth from the screen's perspective; the new file copy is a
secondary, automatic backup on the same machine.

Why this matters going forward:
- If your browser ever clears `localStorage` (a profile reset, switching
  Chrome profiles, an extension misbehaving), the schedule data still
  exists in the volume and can be restored.
- It's the foundation for "undo history", server-side faster Excel
  imports, and team-sharing features — none of which ship today, but
  they all need a place to live, and that place is now in place.

What's running internally that wasn't before:
- The static React files are now served by the same Node process that
  hosts `/api/*`. The Python static server from 0.16.0 has been removed
  from the container. Same URL, same port (6173).
- Each time you save (or change anything that triggers a save), the
  state is POSTed to the local backend after a short debounce, and the
  backend writes it to
  `/home/app/.local/share/pedi_scheduler/scheduler-state.json` inside
  the container volume. Failures are silent — the localStorage path
  keeps working unconditionally.

The privacy boundary is still the user's machine. The backend rejects
non-loopback binds; nothing leaves the container's local loopback.

## 0.16.0 — Backend infrastructure ships (dormant)

This build is the first to include a local-only backend process alongside the React app.
Nothing in the user interface has changed — you should not notice any difference in how
the app behaves, looks, or feels. The backend is running inside the same Docker container
as the frontend, bound only to a loopback address that's invisible to the rest of your
machine. It exists today to do groundwork for future features (server-side scheduling
math, file persistence, faster Excel imports). The frontend doesn't talk to it yet.

What you should expect to see:
- Same URL (`http://localhost:6173`) for the app.
- Same workflows.
- A slightly larger Docker image — the new backend brings a few megabytes of Node
  runtime along.

What's running internally that wasn't before:
- A small Fastify server on `127.0.0.1:6174` inside the container. Not exposed to your
  Mac's network — only the container can reach it.
- That server can read and write a JSON file in the persistent volume at
  `/home/app/.local/share/pedi_scheduler/scheduler-state.json`, but the frontend doesn't
  ask it to do anything yet.

The privacy boundary is unchanged: no off-machine communication anywhere. The new
backend is required by tests (114 frontend + 44 backend = 158, all green) to bind only
to loopback hosts and reject any attempt to listen on a public interface.

## 0.15.3 — Range Assign stops eating your edits

One quality-of-life fix that affects how Range Assign on the Planning Grid feels day-to-day.

### Range Assign Outpatient is now additive

Before: if you used the Range Assign panel to mark a rotator as outpatient for a date range, and any of those days already had a specific Continuity Clinic or AM/PM session you'd entered by hand, those records would silently disappear. The form replaced everything in the range with one AM "Methodist Outpatient" placeholder per day.

Now: Range Assign Outpatient writes a placeholder only into empty AM/PM slots. Records you already have (Continuity Clinic, named attending, etc.) are left exactly as they were. It also writes both AM and PM placeholders per weekday now, instead of just AM, so the planning grid shows the full picture. Weekends and continuity-clinic periods are still skipped.

Range Assign Inpatient and Range Assign Clear are unchanged — they still strip everything in the range, because in those cases that's the point.

### Block Setup no longer silently throws away unsaved edits

If you were typing into a block's name or dates and then clicked "Switch to this block" on a different row before saving, your in-progress edits disappeared without warning. Now you get a confirmation prompt ("You have unsaved changes to X. Switch anyway and discard them?") and can keep your edits or proceed.

### Minor

- The handoff-contract test now also asserts that `WHATS_NEW.md` is present in the customer folder, and tolerates the (gitignored) Docker tarball being absent on a fresh clone before a build.
- One JSDoc comment in `scheduler.js` was inaccurate about `daysBetween`'s implementation; corrected for future readers.

## 0.15.2 — more workflow polish

A second small pass after 0.15.1. Most of these are quality-of-life fixes; one might affect what you see in the planning grid for Methodist rotators.

### Methodist auto-assign no longer fills Saturdays / Sundays for outpatient

Methodist rotators in their 14-day outpatient phase used to get "Methodist Outpatient" AM and PM placeholder records on Saturdays and Sundays. Outpatient clinics don't run on weekends, so those records were clinically nonsensical — they cluttered the planning grid and were leaking into the exported schedule PDF. They're now skipped. Hospital inpatient coverage on weekends is unchanged (still 24/7).

### Outpatient page is smarter about period / date changes

If you pick an attending for an AM slot, then change the period to PM (and that attending only works mornings), the form used to silently keep the AM attending's name in state — clicking Save would record the session against an attending who has no PM clinic at all. Now the form notices and resets to a valid option. Same story for the rotator checkboxes: changing the date now prunes any selected rotators who aren't active that day.

### Range Assign on the planning grid follows your block

When you switch blocks via the top-bar block picker, the planning grid's Range Assign date inputs now reset to the new block's start and end. Before, they kept their old values from the previous block — and since those dates fell outside the new block, the Apply button would just say "no applicable days" with no hint that the form itself was stale.

### Excel importer hardening

- "5/4/26" still imports as May 4 2026, but "5/4/99" now imports as 1999 instead of 2099. A sliding window pivoted on the current year handles future and past two-digit years correctly.
- Sheets with both a "Provider Name" and a "Rotator Name" column used to silently use only the first. Now you get a warning so you can fix the mapping via the Column Mapping panel.
- Impossible dates like 2/31 in a matrix-format date header are now rejected instead of being silently rolled forward to 3/3 by JavaScript.
- Dates written as "May 4 2026" (the word-month form) now match the literal calendar date in every timezone. Houston is fine either way, but if anyone opens your file in a different timezone, the date no longer drifts.

### scheduleInpatientAssignment role behavior is now documented

For posterity: the InpatientPage form lets a rotator have multiple roles on the same day (e.g. morning Resident, afternoon Team senior). That's intentional — re-saving with a different role adds a second record, it doesn't replace the first. The auto-rules (Methodist auto, Range Assign) only ever write one role per rotator per day.

## 0.15.1 — quiet fixes for silent data loss (please read)

**The most important fix in this build:** in 0.15.0 and earlier, saving an outpatient session for more than one rotator at once only kept the last one. If you opened the Outpatient page, checked three residents for the same AM clinic slot, and clicked Save, only the third resident's session actually ended up in the file — the first two were silently dropped. No error, no toast, just gone.

If you've used multi-rotator outpatient saves over the past few weeks, your sessions may be incomplete. Worth a quick sweep through the Outpatient calendar to spot any clinic slots where you remember picking multiple people but only one shows up. Re-saving with all the right rotators selected will fix it going forward — every selected rotator will persist now.

The same kind of bug also affected the Inpatient page in a narrower way: assigning a second rotator to the same role (e.g. two residents both as "Resident") on the same day used to wipe the first one. That's fixed too.

### Other fixes in this build

- **Day-off ranges in the Excel importer.** Writing "Mon-Fri" or "Tue through Thu" in the Day Off column now expands to the full weekday range. Before, "Mon-Fri" was silently read as just Monday.
- **Lowercase "b" in the matrix-format roster.** The week-by-week roster importer used to silently drop cells marked with a lowercase "b" or "!b" — those weeks now register correctly.
- **Sparse re-imports no longer wipe rotator details.** Importing a second roster row for the same rotator with the Program or Clinic column left blank used to overwrite the original Program / Continuity Clinic with the defaults. Now blank cells leave the existing value alone.
- **Range-assigning a fellow shows the right role.** Used to record "Resident" regardless; now picks up the fellow's actual role for the daily report and legend.
- **Planning grid date math is timezone-safe.** No visible effect for you (Houston is west of UTC, where the bug never bit), but the calculation no longer depends on the machine's timezone setting.
- **PDF "Open Conflicts" page is now scoped to the exported block.** A schedule PDF for May won't list conflicts from June anymore.
- **Saving when the browser storage is full no longer crashes the app.** The save just fails and the rest of the session stays intact instead of breaking the UI.
- **Editing a block's start/end date now triggers a re-apply of pre-assignments** for the new days the block covers. Before, you had to switch blocks and back to make it pick up.
- **Methodist auto-assign and per-segment pre-assignment no longer double-write.** If you run both on the same Methodist rotator (or run either twice), the outpatient slots stay deduplicated. Manual entries always win.

### Privacy / local-only

No change to behavior, but the design spec (and the test that enforces it) now make the distinction explicit: the app forbids **off-machine** communication, not a local helper. Nothing leaves your Mac. A future local helper bound to `127.0.0.1` would be allowed; a remote server would not.

## 0.15.0 — planning grid restructure: sections that match real schedules

You sent over a sharp observation right after we sketched the dashboard layout: *"Realized an issue we would run into when I thought about this more. Many people will have mixed assignments between inpatient and outpatient."* You were exactly right — a Methodist 14/14 rotator (IP for two weeks, then OP for two weeks) doesn't fit cleanly into a "Inpatient" section OR an "Outpatient" section. They belong to both, on different days.

This build retargets the planning grid to the architecture you proposed: classify by **what state each person is in for this block**, not by their phase.

### Five sections, ordered by attention priority

The planning grid groups rotators into these bands, top to bottom:

1. **Needs Assignment** — anyone with at least one day still unassigned (amber bar). These are the action items — they float to the top so you see them first.
2. **Mixed Assignments** — rotators with both IP and OP days in this block (purple bar). Split schedules that deserve extra eyes. This is where Methodist 14/14 rotators land.
3. **Fully Inpatient** — entire active block is inpatient (green bar).
4. **Fully Outpatient** — entire active block is outpatient (blue bar).
5. **Not in block** — rotators with no overlap (muted gray bar). Kept visible for context.

Each section header still shows its count and has a chevron to collapse if it's in your way.

### Cells now show per-day colors

Previously each row was tinted with one band color. Now every cell carries the color of *that day's* assignment:

- **Green** = inpatient
- **Blue** = outpatient
- **Amber** = available but unassigned
- **Gray hash** = off / unavailable
- **Gray double-hash** = not in this block

So a Mixed-section rotator shows green cells for their IP days and blue cells for their OP days, on the same row — the actual shape of the assignment.

### Views are now row-filters, not section-tab navigation

The three view tabs at the top still work, but they're defined differently now:

- **Master view** — all rotators, all 5 sections.
- **Inpatient view** — only rows that have *at least one IP day*. A Methodist 14/14 rotator appears here because they have IP days, even though they're classified as Mixed.
- **Outpatient view** — only rows that have at least one OP day. The same Methodist rotator also appears here.

A row can show up in both IP and OP views. The view filter doesn't lock people into one or the other — it just hides rows that have nothing of that phase. Not-in-block stays visible in every view so you can see who's not on service without losing them.

This change closes the bug you predicted: nobody gets silently miscategorized, and the eye-attention order you wanted (who still needs work → who has complex schedules → who's locked in → who's out) is what the grid shows by default.

### What stays the same from 0.14.0

- Three view tabs at the top with the same color outlines
- Range-assign form
- Section header chevrons for collapsing
- "Show next block too" toggle when a next block exists
- Footer totals in Master view

## 0.14.0 — the planning grid becomes your whole dashboard

You sketched out what the planning grid should grow into: *"That would let you build most of the schedule from one page visually, instead of jumping between files."* This build is that — three view modes layered over four organized sections, all on the planning grid page.

### Three view modes

A tab strip across the top of the Planning Grid tab now lets you pick which slice you're looking at:

- **Master view** — all rotators, all four sections at once. Daily totals (Inpatient / Outpatient / Unassigned) show as the footer rows. This is the overview you spend most of the time in.
- **Inpatient view** — only the Inpatient section is shown (plus Not-in-block at the bottom for context). Same grid, same range-assign form, just filtered down to the people you're actually scheduling for inpatient.
- **Outpatient view** — same idea for outpatient.

Switching tabs is purely a view filter. Anything you assign from the range-assign form (or via any other path) shows up across all three views.

### Four sections inside the grid

Rotators are now grouped into four labeled bands instead of being mixed together:

1. **Unassigned / Available** — present in the block, not off, not yet assigned to IP or OP. This is the section you act on. Orange band.
2. **Inpatient** — anyone with at least one IP assignment (or an IP pre-assign on their profile). Green band.
3. **Outpatient** — anyone with at least one OP assignment (or an OP pre-assign on their profile). Blue band.
4. **Not in block** — rotators whose date ranges don't intersect this block, kept visible at the bottom in a muted gray band so they're still recognizable but clearly out-of-scope.

Each section header carries the section title, the count in parentheses (e.g., "Unassigned / Available (9)"), and a small chevron — click it to collapse a section if it's getting in the way. Rows inside each section are sorted alphabetically by name.

### Rows move when you assign

When you assign someone IP or OP via the range-assign form, their row jumps to the matching section the next time the grid renders. Same person, same data, just regrouped. This is the visual feedback you described: *"Once you assign them IP or OP, their row changes color and moves into the correct section."*

The cells in each row also pick up that section's color band, so an IP rotator's whole row reads green at a glance (with the off-pattern still showing on their actual off days), and an OP rotator's row reads blue.

### What's gone

The "Only show rotators assigned to this block" checkbox is removed — the new layout already separates absent rotators into the **Not in block** section at the bottom, where they show muted but visible. If they were getting in the way, click the section header to collapse it.

The "Show next block too" toggle stays, so month-to-month continuity still works the same way.

### What's coming later (not in this build)

The yellow and purple "preference match" stars in the mockup are deferred. Those need a new field on each rotator's profile to record per-service or per-day preferences, plus a place in the rotator card to fill them in. We wanted to land the structural layout work first; the preference stars become a follow-up once that data exists.

## 0.13.0 — you tell us which column is which

You asked: *"The way to import from a CSV or XLSM, we can say which row or column means what. That way it imports it correctly. After importing the Excel sheet, it shows the table. Then Coordinator should be able to say which is which. It should auto-select those that it knows, but should let Coordinator say what row or column is what."*

That's what this build does.

### Pick your columns after the file shows up

When you upload a roster spreadsheet, the import dialog now has a **Column mapping** panel above the preview table. It lists all eight known fields — Name, Program, Level, Start, End, Continuity Clinic, Day Off, Unavailable — each with a dropdown showing every column in your spreadsheet (with the Excel column letter next to it for easy reading: "Service Begin (col B)"). The app pre-selects whatever it can recognize automatically — those rows say "(auto)" next to them. Anything it couldn't guess shows up as "— pick one —" so you can fill it in.

As soon as you change a dropdown, the preview table below updates in place to show what each rotator will look like with that mapping. So you can try, see the result, and adjust until the names, dates, and clinic times all read correctly.

### Loud warnings when something would break the import

The new dialog catches the most common mistakes before they happen:

- **Name column not picked** — Import is disabled (you can't add a rotator without a name), with a red banner saying *"A Name column is required to import."*
- **Start or End column not picked** — a yellow banner warns that *"No End column selected — rotators will import with no dates and won't appear on the schedule."* You can still import (you might want to load names first and fill dates later on the Who's On Pedi tab), but the consequences are spelled out instead of silent.
- **Same column picked for two fields** — a gray banner notes *"Start and End both map to column D. Imports will be single-day rotations."* That's a legitimate choice for one-day events, so it's a heads-up, not a block.

If you have rows with missing dates because no column is picked, the per-row warnings collapse into a single summary line (*"...and 23 more rows missing dates because the column isn't picked above"*) instead of flooding the same root cause forty times.

### Layout toggle for the rare misfire

A small **Layout** radio at the top of the dialog lets you choose between **Template** (one row per rotator) and **Grid (matrix)** (week columns with B / !B presence marks). The app pre-selects whichever it auto-detected. If it picked wrong — for example a small wide-grid file with fewer than six week columns gets read as a template by mistake — flip the toggle and the dialog rewires immediately. The other layout is grayed out with an explanation when the file doesn't support it.

### Preview "show all"

If your file has more than five rotators, the preview shows the first five by default with a **Show all N** link in the bottom corner of the preview. Click it to scroll through every rotator and confirm the mapping looks right end-to-end. This is meant for catching the kind of mid-file inconsistency that the top-five rows wouldn't surface ("the first five all have Start filled in but the next twelve are blank").

### What's gone

The 0.12.0 "We couldn't find a start date or end date column" warning is removed. With the new mapping panel, that message would have been a redundant second voice telling you the same thing the panel already shows. The panel-level warning banners cover that ground now.

### Keyboard

The whole import dialog is keyboard-accessible: tab through Layout → the eight dropdowns in order → Show all → action buttons. Hit Escape to close.

## 0.12.0 — your full May 21 punch list

You sent over a thick stack of notes asking for the next round of changes. Here's how the app answers each one, in your own words where it helps.

### Who's On Pedi tab is now a list of editable provider cards

Before, this tab was a wide table of providers above a separate "Availability per rotator" section. You said: *"Move these options underneath their name on the list"* and *"I want to be able to click someone's name and change all the options using that nice ADD ROTATOR thing. Ideally all of these options would be able to be edited in this window."*

The table is gone. In its place, each provider now has one card that holds everything for that person:

- **Full name**, **Program**, **Level**, and **Continuity clinic** — all editable inline. Just type or pick from the dropdown; your changes save as you go without a popup or "Save" button.
- **Day off each week** — the recurring weekday-off checkboxes that were previously in the lower panel.
- **Time off (vacation / single days)** — same as before, with new help text reminding you that a single-day off is just a range with the same From and To date. You can add as many of these as you need.
- **Date ranges (on service)** — and these are now fully editable. Previously you could see a rotator's date range but couldn't change it without re-importing. Now each range has editable From and To dates, the Pre-assign dropdown (Outpatient / Inpatient / none), and a per-range **Remove** button. There's an **Add date range** button at the bottom of the section. This means: *"give me the ability to add date ranges on service, just in case there are changes made in the future"* — exactly what you asked for.
- **Remove rotator** button in the card header — deletes the entire profile (and any inpatient/outpatient assignments tied to it) after confirming. You said: *"give me the option to delete rotator profiles on The Who's on pedi tab."* Done.

The header inside each card carries the name, program, and level next to a small Remove button so it's never hidden. The filter checkbox at the top of the page (**"Only show providers active in this block"**) still works the same way — when on, the page only renders cards for providers with date ranges that intersect the active block.

### Planning Grid: weekends gone, IP/OP grouped, more controls

You said: *"Saturday and Sunday don't have to be included because clinic is closed then."* The planning grid now only renders Monday through Friday columns for the active block. The IP/OP/Unassigned totals row at the bottom is recomputed on the visible (weekday) columns so the numbers always match what you see.

You said: *"After I assign inpatient or outpatient can they go to either the top or the bottom... outpatient are all in the first half of rows and those on inpatient are all on the second bottom half."* The grid now sorts rows into three bands automatically: outpatient providers at the top, unassigned in the middle, and inpatient at the bottom. The bands are recomputed as you change assignments, so the moment you flip somebody from OP to IP they move down to the IP band. Inside each band the original roster order is preserved (no random shuffling).

Two new checkboxes above the grid:

- **Only show rotators assigned to this block** (on by default) hides providers whose date ranges don't overlap the active block. That removes the noise of seeing a stack of "absent" rows for people who aren't on service right now.
- **Show next block too** (off by default) extends the grid's date window to also cover the next chronological block. You asked: *"I want the option to view two blocks at once there so I can ensure continuity from month to month."* Turn it on and the grid stretches across both blocks at once. The next-block name appears in the toggle label so you know which block you're about to pull in.

### Pre-assignments fire as soon as you set them

You said: *"I want the people preassigned to outpatient or inpatient on the rotator profile to then automatically show up in that spot in the planning grid."* They do now. Setting a Pre-assign value on a date range (Outpatient or Inpatient) immediately auto-fills the planning grid for that range. Before, this only happened when the block was first opened; now it re-runs whenever any rotator's data changes, so newly-set pre-assignments populate instantly.

The connection runs the other way too: when you assign IP or OP from the planning grid via the range-assign form, the **Inpatient** and **Outpatient** tabs see those records straight away (they read from the same shared data). You said: *"I want any changes I make in the planning grid to show up in the outpatient and inpatient pages."* Done — the planning grid is now your single source of truth for IP/OP assignments.

### Spreadsheet importer says when start/end dates aren't pulling

You said: *"The start and end dates are still not pulling in from the spread sheet."* That's almost always because the column header in your file is named something the importer didn't recognize. Two changes:

1. The importer now accepts a much wider set of header names for the start and end columns: any of "Start", "Start Date", "Rotation Start", "Service Start", "Block Start", "On Service", "Begin", "Begins", "From", "Starts", and the matching variants for End ("Off Service", "Ends", "Through", etc).
2. If after all that it still can't find a Start or End column in your header row, the import summary now tells you *which* column headers it actually saw and *which* names it was looking for. So instead of dates silently coming through blank, you'll see a message like *"We couldn't find a start date or end date column in your header row (Name, Program, Service Begin, ...). Try renaming the column to 'Start' and 'End' (or 'Rotation Start' / 'Rotation End')."*

If you re-import your file and still see blank dates, the warning at the top of the import preview now points to the actual issue.

### Smaller polish

- The Configuration tab already supported add/remove for attendings and Expected Source programs in 0.10.0 — that's still there. (Mentioning it here only because you flagged it; the buttons are visible at the per-row level when there are entries, and the empty-state hint shows the textbox + Add button when the list is blank.)
- Toast notifications no longer pop up on every single keystroke when you edit a rotator's name, level, continuity clinic, segment dates, or time-off range dates. They still fire on discrete actions (adding a range, removing a rotator, toggling a day off) so you know something happened.

## 0.11.0 — day-level planning view + range assign

You said you needed the planning view to be day-level, not just week-level — that rotators often start or leave midweek, and you wanted a calendar grid showing each person's actual available dates across the block, with the ability to assign IP or OP by date range and watch the daily staffing totals update so coverage gaps stand out immediately. This release ships both halves of that.

**Planning Grid tab.** New tab between "Who's On Pedi" and "Inpatient." Rotator × day matrix for the active block. Each cell shows that person's status for that day: **IP** (inpatient), **OP** (outpatient), **OFF** (unavailable), or **—** (available but unassigned). Mid-block start and leave dates render as striped "absent" cells — no fake "week 1 / week 2" structure. Both row labels (rotator names) and column headers (weekday + M/D) stay stuck in place when you scroll, so you can always see whose day you're looking at.

**Daily totals at the bottom.** Three footer rows: Inpatient, Outpatient, and Unassigned. The Unassigned row is the action item — it turns amber the moment any day has Unassigned > 0, so coverage gaps stand out at a glance without having to read the numbers.

**Range assign form atop the grid.** Pick a rotator, a From and To date, and one of three buttons:
- **IP** — sets that rotator to inpatient across the range.
- **OP** — sets them to outpatient (AM placeholder, clinic "Methodist Outpatient", attending blank for you to fill).
- **Clear** — wipes both IP and OP for that rotator across the range. True blank slate.

The form is smart about what to skip: days where the rotator isn't in their segment (absent) or is marked unavailable (off, day-off, range) are skipped silently. The success message tells you how many days were applied vs. skipped. If you pick a From or To outside the block, it auto-clamps to the block boundaries and tells you what it did ("clamped from 4/15–6/30").

**Mutual exclusion is intentional.** Setting a range to IP strips any existing OP records for that rotator on those dates, and vice versa. Setting a range is an assertion of intent — if you actually want someone on both IP and OP on the same day, use the per-page IP / Outpatient forms (the planning grid will surface that day as a "both" cell with a conflict tooltip).

**Mid-segment phase changes finally work.** Previously, "Maya is IP May 4–10 then OP May 11–17" forced you to split her segment in two on the Who's On Pedi page. Now the range-assign form handles mid-segment phase changes directly — your segment shape stays clean, and the phase per day lives in the assignment records where it belongs.

## 0.10.0 — attending profiles + date-filtered dropdown

On the Configuration tab, each attending now has a profile, not just a name. Mark which weekdays + AM/PM they normally have clinic (a Sunday-through-Saturday grid with AM and PM checkboxes), and add one-off clinic dates for the random extras outside the recurring pattern.

On the Outpatient form, the Attending dropdown now filters to only the attendings who have clinic on the selected date and period. So when you pick a Tuesday + AM, you only see attendings whose Tuesday-AM box is checked (or who have a one-off for that exact date + AM). If no attending matches the filter, the dropdown falls back to the full list so you're never stuck.

The label on the dropdown tells you when it's actively filtering ("Attending (showing 2 with AM clinic on 2026-09-15)").

Old data lifts cleanly: any attending you'd previously added as just a name becomes a profile with no recurring days yet — fill in the grid on Configuration when you have a moment.

## 0.9.1 — per-segment pre-assignment

On the Who's On Pedi tab, each provider's "Date ranges (on service)" now has a "Pre-assign" picker per range. Three options: none, Outpatient, Inpatient.

When you mark a range as Outpatient or Inpatient, two things happen the moment that block is opened:

1. **Placeholder sessions appear automatically.** Outpatient pre-assignment fills both AM and PM placeholder rows on every weekday of the range (clinic and attending blank for you to fill in). Inpatient pre-assignment fills the Resident slot for every weekday of the range. Weekends are skipped. Manual assignments you'd already entered stay untouched.
2. **The dropdowns honor the pre-assignment.** A provider pre-assigned to Outpatient won't show up in the Inpatient dropdown for those dates, and vice versa. Pre-assignments survive across schedule rebuilds and apply automatically when you switch blocks.

Worked example: a provider with 3 separate 1-week ranges — Sept 14-20, Oct 5-11, Nov 2-8. Mark Sept 14-20 as Outpatient on her profile, and the moment the September block is opened, her week of weekday AM+PM placeholder sessions appears on the Outpatient calendar. The other two weeks stay unmarked and behave normally.

## 0.9.0 — built from your round-4 notes

**Duplicate-provider cleanup.** If your roster has duplicates (the same name showing up multiple times), the Who's On Pedi tab now shows a "Combine N duplicates" button. One click merges them into one profile per name; their date ranges all keep. The import modal also no longer shows the "Add all as new" option by default — it lives behind an "Advanced" toggle to prevent accidental duplicates on re-uploads.

**Who's On Pedi filters by the current block.** A checkbox at the top of the roster ("Only show providers active in this block") is on by default. Switch to another block and the roster automatically shows the people whose dates land inside that block. Uncheck to see everyone.

**Delete button on sources.** Each row in Reviewed Sources now has Delete next to Open and Replace. Removes the source record only — your providers stay on the roster. Confirms before removing.

**Delete button on blocks.** Each row in the All Blocks list in Block Setup now has a Delete button (except when there's only one block, since the app needs at least one). The provider roster and any assignments stay on file — they'll appear again under any future block covering the same dates.

**Provider → Attending dropdown.** The Outpatient Clinic Session form's Provider field is now labeled "Attending" and is a dropdown sourced from the new Configuration page. Default attending names: Alder, Birch, Gum, Dogwood, Cedar, Elm, Hazel. Edit the list on the Configuration tab.

**Multiple rotators per attending.** The Outpatient form now lets you pick one or more rotators for the same attending session. The dropdown filters to providers active on the selected date by default. Click Save and one session record is created per selected rotator.

**New Configuration page** in the nav between Rules and Export. Two sections today: Attendings (the dropdown list) and Expected Sources (the programs you expect to receive rosters from). Schedule Readiness panel below shows which expected sources are still missing.

**Schedule Readiness on the Dashboard.** The "Sources" tile on the Dashboard now reads "Waiting on N of M" or "All expected sources in" depending on whether the Expected Sources list (configured on the Configuration tab) has been fulfilled.

## 0.8.0 — Schedule PDF + matrix-format Excel import

**Download the entire schedule as a PDF.** On the Export tab there's now a "Download schedule as PDF" button. Click it and a single multi-page PDF saves to your Downloads folder containing the active block's inpatient schedule, outpatient schedule, provider legend, and any open conflicts. Landscape, US Letter, table layout. Built entirely on your machine — no network calls, no cloud printing.

## 0.7.1 (bug fix on top of 0.7.0)

The Excel importer now understands grid-style rosters — the kind where each column is a week-start date across the top and each row is a provider with "B" (or "!B") in the weeks they're on service. This matches the format of the "Pediatrics Resident Rotators" sheet you sent over. Runs of consecutive "B" weeks are combined into one date range automatically. Cells marked "!B" are treated as present for now, with a heads-up note so you can tell us if they should be excluded instead. The academic year is inferred from today (so a sheet whose dates run June → June is interpreted as the academic year currently in progress).

The original template-style import (one row per provider with Name/Start/End columns) still works exactly the same as before — the parser auto-picks between the two formats.

## New in this update (0.7.0)

Built from your three answers on 2026-05-20:

- **Multi-block: you can now create, switch between, and manage
  multiple rotation blocks.** There's a new "Block" picker at the
  top of every page — click it to switch to any other block you've
  created, or pick "+ New block…" to add one. New blocks default
  their dates to start the day after your previous block ends, so a
  whole academic year of blocks chains together with one click per
  block. The Block Setup page now has an "All Blocks" section at
  the top with switch buttons for each, and an "+ Add a new block"
  button.
- **Replace button on uploaded sources.** Each row in "Reviewed
  Sources" now has a Replace link next to Open. Click it, pick the
  new spreadsheet, and the source record swaps in place — no
  separate delete + re-upload. The provider merge happens by name,
  same as a normal import.
- **The "No inpatient coverage on [date]" warnings now show as
  soon as you've added providers to the block** — even before any
  inpatient assignments are made. They act as a checklist of days
  still to cover. (They stay hidden on a brand-new empty block
  where there's literally no one yet to assign.)

## New in this update (0.6.0)

- **A "Generate Methodist schedule" button** on the Inpatient tab fills in
  14 outpatient + 14 inpatient days for each Methodist provider, using
  each person's own 28-day rotation start. Manual assignments you've
  already entered stay untouched. The button only appears when at least
  one Methodist provider is on the roster.
- **The provider dropdown on Inpatient and Outpatient forms now filters
  to only show people actually on service on the selected date.** Change
  the date, and the list shrinks to who's actually here. The label tells
  you how many are showing (e.g., "Rotator (showing 1 active on
  2026-06-09)"). If no one is on service that day, the full list shows
  so you can still record an assignment if needed.
- **Multi-segment providers display correctly across the app now.** If a
  rotator has two date ranges (say, May 4–7 and May 24–31), every place
  that shows their dates shows both ranges instead of collapsing to
  "May 4 to May 31".

**The app now starts empty** — no example providers, no example sources,
no example assignments. The first time you open it, the Roster, Sources,
and calendars are all blank, waiting for your real information. Add your
providers (either by uploading your roster spreadsheet on the Sources
tab or by typing them in on the "Who's On Pedi" tab), then build the
schedule from there.

## Your Six Notes — All Addressed

1. **"What's a JSON?"** — Removed from the user interface. The Dashboard
   now shows "Provider roster", "Daily reports", "Conflicts list", and
   "Schedule package" instead of file extensions. The Save and Restore
   buttons are now labeled "Restore backup" and "Save a backup of this
   app's data".

2. **"I can't open the uploaded document."** — Click any row in the
   "Reviewed Sources" table on the Sources tab to preview what was
   uploaded. New uploads show a table of their contents; older ones
   show a clear note explaining they were added before previews were
   available.

3. **"Can profiles be auto-created from the Excel sheet?"** — Yes.
   Upload an Excel roster (.xlsx) on the Sources tab and rotator
   profiles are created for you. Before anything is saved, you see a
   preview and choose how to handle any matches: merge by name,
   replace all, or add as new. A "Download blank roster template"
   button shows the expected columns.

4. **"Another line to assign their day off."** — On the "Who's On Pedi"
   tab, each rotator card has Sunday–Saturday checkboxes for recurring
   days off.

5. **"Unavailable on — date range, in case someone needs more time
   away."** — Same place, below the day-off checkboxes. Click "Add
   time-off range" as many times as you need; each row takes a start
   and end date.

6. **"Show when someone has continuity clinic on the calendar."** — On
   the Inpatient Calendar, every day cell where a rotator has
   continuity clinic shows a small pill at the bottom labeled with the
   provider's first name and "AM" or "PM" (for example, the pill will
   read "Sarah · PM" if Sarah has a Tuesday PM clinic). You can tell at
   a glance who is in clinic without leaving the calendar.

## One Thing To Look At

The continuity-clinic pills (#6 above) show one pill per provider per
day. If your real team often has many providers all in PM clinic on the
same day, the cell might get visually busy. Let me know if you'd prefer
a tighter look (for example, two names combined into one pill).

## Big additions in this build (matches the way real rotations work)

- **A provider can now have more than one date range.** If someone is on
  service May 4–7 and again May 24–31, they're one provider with two
  date ranges, not two separate entries. The calendars correctly show
  them only on the days they're actually here.
- **Methodist Adult Neuro rotations now auto-split into 14 outpatient
  days + 14 inpatient days**, based on each Methodist resident's true
  28-day rotation start (not the pediatric block's start). If their
  rotation straddles two pediatric blocks, the phase carries across
  correctly — no manual day-by-day entry, no off-by-one from the
  midpoint flip.
- **A numbered "Legend" page** has been added to the navigation.
  Generates a clean numbered roster you can reference in compact
  calendar cells (e.g., "ON: 1, 3, Fellow"). Fellows and medical
  students get role labels instead of numbers, matching the format
  in your current schedules.
- **Inpatient calendar cells are now spec-complete**: ON list, OFF
  list, AM and PM clinic pull-outs, team senior, fellow coverage,
  academic half-days, holidays and weekends, daily notes, and
  conflict warnings inline. Click a cell to expand for the full
  per-day detail breakdown.
- **Outpatient calendar cells are now spec-complete**: AM/PM clinic
  rows with parsed patient counts/locations, medical-student and
  fellow ratios, CME / stay-tuned / no-clinic / students-off /
  residents-off status styling.
- **Three new conflict checks** are now active:
  • An inpatient day in the block with no one assigned (only flagged
    after you've started filling the schedule)
  • A provider who's scheduled but missing from the legend
  • An inpatient assignment that falls on a provider's continuity
    clinic day
- **The Excel roster importer** now understands multi-segment
  providers: two rows with the same name produce one provider with
  two date ranges. The "Day off" and "Unavailable" columns continue
  to work as before.

## Also Improved

- **The Outpatient tab has a calendar view** in addition to the session
  list. You see each day's outpatient sessions at a glance in a month
  grid, stacked AM then PM, with a thin colored bar on the left to tell
  AM and PM apart.
- The continuity-clinic pills on the Inpatient calendar name the
  affected provider (e.g., "Sarah · PM") instead of a generic "PM
  clinic" label, so you can see at a glance who is in clinic without
  hovering.
- A conflict is flagged when a provider is scheduled for an outpatient
  clinic on their day off or during a time-off range (was inpatient-
  only before).
- The "Rules" page wording is plainer; the older mention of a
  technical solver is gone.
- "Unknown" provider placeholders now read "[Removed]" so it's clear
  the provider was deleted, not that something broke.
- The Dashboard's "Export Readiness" panel now shows friendly names
  ("Provider roster", "Daily reports") instead of file extensions.

## One Thing To Look At

The continuity-clinic pills show one pill per provider per day. If your
real team often has many providers all in PM clinic on the same day,
the cell might get visually busy. Let me know if you'd prefer a tighter
look (for example, two names combined into one pill).

## How To Update

You're already doing it — this folder replaces the previous one.
Double-click `run-on-mac.command` to load and run. (First time only:
right-click → Open. See the README for the why.)
