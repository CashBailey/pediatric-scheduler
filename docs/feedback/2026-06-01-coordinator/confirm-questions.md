# Quick questions for Coordinator — confirm 7 behaviors + D1b resolution (2026-06-01)

A handful of scheduling behaviors are already built and live in the app. We
picked a sensible default for each, but they're the kind of thing only you can
say is *right* for how your service actually runs. Below are seven yes/no
confirmations plus the now-resolved Methodist outpatient policy.

For each: if the described behavior is what you want, just say **"yes, keep it."**
If not, the "what we'd change" line says exactly what we'd do instead — so a
**"no"** is enough for us to act on.

These are all forwardable as-is; reply inline if that's easiest.

---

## Part A — Seven things already built (confirm or flip)

### 1. Marking days off by painting

**Today:** On the planning grid you can paint a person's day as **Off** (same
way you paint Inpatient or Outpatient). A given person/day is always exactly
*one* of Off / Inpatient / Outpatient — never two at once. So marking someone
Off on a day they were on inpatient (or in clinic) clears that assignment, and
putting them back on inpatient/clinic clears the Off.

**Question:** Is "one status per person per day, and Off is just another paint
status" what you want?

*If no:* we'd change Off so it doesn't automatically clear an existing
assignment — e.g. ask you to confirm first, or let Off coexist with a note.

---

### 2. Overriding a person's pre-set rotation

**Today:** When a rotator's imported rotation profile says they're (say)
outpatient on a given day, and you paint or drag them to inpatient anyway, the
app **lets you do it** — it doesn't block you. It just marks that cell with a
small badge ("overrides rotation profile") so it's visible that you went
against the import. No pop-up, no nagging; the badge clears itself if you later
paint that day back to match the profile.

**Question:** Is "warn-but-allow" the right call — you can always override an
imported rotation, and we just flag it visually?

*If no:* we'd make an override require a confirmation click first, or block it
outright and require editing the rotation profile instead.

---

### 3. Inpatient and clinic can't share the same day

**Today:** A person can't be both inpatient *and* in outpatient clinic on the
same day. If you paint inpatient onto a day that already had clinic (or vice
versa), the new one **replaces** the old — the day flips, it never becomes
"both."

**One thing worth knowing:** because of this, painting *inpatient* over a day
that held a person's **continuity clinic** will remove that continuity-clinic
session for that day. (Continuity clinic is otherwise protected — the automatic
scheduler never writes over it — but a manual inpatient paint will.)

**Question:** Is "one service per person per day, and a manual paint wins
(including over continuity clinic)" what you want?

*If no:* we'd protect continuity clinic from being painted over too (block or
warn), and/or allow a genuine split day where someone is inpatient one half and
clinic the other.

---

### 4. The Inpatient and Outpatient pages are now view-only

**Today:** All schedule *building* happens on one unified **Planning Grid**
(inpatient + outpatient + off, side by side). The separate **Inpatient
Schedule** and **Outpatient Schedule** pages still exist in the menu, but they're
now **read-only views** — clean per-service printouts/projections of what you
built on the Planning Grid. You don't edit on them anymore.

**Question:** Is it right that you build everything in one place (Planning Grid)
and the Inpatient/Outpatient pages are just clean read-only views of the result?

*If no:* we'd restore direct editing on the standalone Inpatient and Outpatient
pages so you can work on either service in isolation.

---

### 5. Dragging someone onto a day they already have clinic

**Today:** Dragging a person onto an inpatient cell adds them to inpatient for
that day. But if they **already have clinic that day**, the drag is **blocked**
(it won't create a conflicting inpatient + clinic day) — consistent with #3.

**Question:** Should a drag onto a day where the person already has clinic stay
**blocked**?

*If no:* we'd let the drag go through and create a same-day clinic-plus-inpatient
(mixed) assignment, leaving it to you to sort out.

---

### 6. Inpatient coverage on weekends and holidays

**Today:** The schedule assumes the **inpatient service needs at least one
resident every single day — including weekends and holidays.** A weekend or
holiday with nobody on inpatient gets flagged as missing coverage. (Outpatient
*clinic* is treated the opposite way — no clinic runs on weekends or on
holidays you've marked "no clinic.") Inpatient demand can be adjusted per block
if a particular block is different.

**Question:** Is "every day, including weekends and holidays, needs at least one
resident on inpatient" the correct default for your service?

*If no:* we'd make weekends and holidays default to **no required inpatient
coverage** — they'd only get someone if you explicitly assign them — and stop
flagging an empty weekend/holiday as a gap.

---

### 7. Grouping the "Who's On Pedi" roster

**Today:** On the **Who's On Pedi** roster, the people cards are **grouped by
program** by default (Methodist, UT Adult Neuro, UT Pediatrics, etc.), each
under its own heading. There's a **"Group by source"** checkbox — turn it off
and you get one flat alphabetical-ish list instead.

**Question:** Is grouping the roster by program **on by default** the right
starting view?

*If no:* we'd default to the flat list (you could still switch grouping on), or
group by a different field if there's one you'd rather see.

---

## Part B — Resolved Methodist outpatient policy

### D1b. What happens to a Methodist rotator during their *outpatient* two weeks?

**Background:** Methodist Adult Neurology rotators run a 28-day rotation split
**14 days outpatient, then 14 days inpatient.** During their **outpatient**
fortnight, the scheduler now treats them as **off our inpatient service**.

Resolved behavior as of 2026-06-02: the automatic draft never pulls a Methodist
rotator into our inpatient service during their outpatient fortnight, including
weekends and holidays where they would otherwise look "free." If inpatient
coverage is short, the app reports an honest gap instead of breaking the 14/14
split.

The planner may still keep internal outpatient-half markers so the rotation is
visible in the working grid. Those markers are not real clinic supply. The real
visible clinic fact is still the rotator's weekly continuity clinic, with the
D1 show/hide behavior for planner-facing vs. rotator-facing output.

---

*D1b no longer blocks automatic-scheduling work; it is pinned by JS and Python
regression tests.*
