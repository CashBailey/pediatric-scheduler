// Program-specific scheduling-rule dispatcher.
//
// Spec references:
//   §9.1   Methodist Adult Neurology Rule    — auto 14/14 split
//   §9.2   Psychiatry Rule                   — use actual dates (no auto)
//   §9.3   Pediatrics Resident Rule          — use actual dates (no auto)
//   §9.4   UT Houston Adult Neurology Rule   — short ranges (no auto)
//   §9.5   Medical Student Rule              — preserve predetermined (no auto)
//
// §9.2–§9.4 school types (psychiatry, peds, adult) are seeded by the
// length-based split (Coordinator rules 3/4/7) over their actual imported
// dates; §9.5 students stay predetermined-preserving no-ops.

import {
  applyMethodistAutoAssign,
  applyLengthSplitAutoAssign,
  chooseMethodistStartSide,
  fellowCandidateSlotKeys,
  fillOutpatientTarget,
  inferSchoolType,
  isPediatricNeurologyFellow,
  proposeSchedule,
  coverageForDate,
  dateRange,
  isRotatorActiveOn,
  methodistRotationWindow,
  seedFellowInpatient,
  segmentSplitPlan,
  weekdayName,
  OUTPATIENT_TARGET_ROTATORS
} from "./scheduler.js";

/**
 * Map a school type to a human-readable, plain-English description of
 * the rule the scheduler applies. Used by the UI legend / rules page;
 * keep strings physician-friendly (no "JSON", "config", "CP-SAT", etc).
 */
export const PROGRAM_RULE_DESCRIPTIONS = {
  methodist:
    "Methodist Adult Neurology rotators run a 28-day rotation split into 14 days outpatient and 14 days inpatient, preserved across rotation block boundaries. The draft normally starts them outpatient; when only part of the rotation falls inside the block it starts with whichever side gives the block more inpatient coverage, and you can override the side on the rotator profile.",
  "ut-adult":
    "UT Adult Neurology rotators are usually here for one to two weeks. Over their actual imported dates the draft assigns one-week visits to inpatient and splits two-week visits into an inpatient week then an outpatient week.",
  "ut-peds":
    "UT Pediatrics rotators are usually here for three to four weeks. Over their actual imported dates the draft splits the stay roughly half inpatient and half outpatient, keeping the inpatient weeks together so no one gets a lone inpatient week between clinic weeks.",
  "ut-student":
    "Medical students often arrive with their inpatient or outpatient assignment already set. The scheduler preserves that assignment unless someone changes it.",
  "ut-psychiatry":
    "Psychiatry rotators are usually here for a full calendar month, which may not line up with the pediatric block. Over their actual imported dates the draft splits the month roughly half inpatient and half outpatient with the inpatient weeks kept together.",
  other:
    "No automatic assignment rule applies. The scheduler uses the actual imported dates and leaves assignment to the scheduler."
};

/**
 * Return the school-type classification used for program-rule dispatch.
 * Reads the new `schoolType` field first; falls back to ST-A's canonical
 * `inferSchoolType` based on the program name.
 *
 * Stable values: "methodist" | "ut-adult" | "ut-peds" | "ut-student" |
 * "ut-psychiatry" | "other".
 */
export function classifyRotatorSchoolType(rotator) {
  if (!rotator) return "other";
  if (rotator.schoolType) return rotator.schoolType;
  return inferSchoolType(rotator.program);
}

/**
 * Per-school-type auto-assignment dispatch. Methodist runs the 14/14
 * cross-block-safe auto-assign. The other school types are
 * intentionally no-ops today (spec §9.2–§9.5 only require that we use
 * the imported actual dates), but the hook is in place so per-program
 * logic can be added without touching every call site.
 *
 * Always returns a state object. Always idempotent.
 */
export function applyProgramRules(state, block) {
  if (!state || !block) return state;

  const handlers = {
    methodist: applyMethodistAutoAssign,
    // Rules 3/4/7: length-based IP/OP split with the anti-burnout pattern.
    // One writer covers all three school types (it filters internally and is
    // idempotent, so dispatching it more than once is a no-op).
    "ut-adult": applyLengthSplitAutoAssign,
    "ut-peds": applyLengthSplitAutoAssign,
    "ut-psychiatry": applyLengthSplitAutoAssign,
    // §9.5: student assignments arrive predetermined — preserve them.
    "ut-student": noopAutoAssign,
    other: noopAutoAssign
  };
  let next = state;
  for (const schoolType of Object.keys(handlers)) {
    const hasAny = (next.rotators || []).some(
      (rotator) => classifyRotatorSchoolType(rotator) === schoolType
    );
    if (!hasAny) continue;
    next = handlers[schoolType](next, block);
  }
  return next;
}

function noopAutoAssign(state) {
  // Intentional no-op: §9.5 students arrive predetermined; "other" is manual.
  return state;
}

// ---------------------------------------------------------------------------
// A1 keystone: generateDraft — the single auto-draft orchestrator.
// ---------------------------------------------------------------------------
//
// generateDraft(state, block) -> { state, report }
//
// This is the ONE entry point the "Generate draft" button drives. It composes
// the existing, individually-tested pure primitives into a single pass:
//
//   1. applyProgramRules  — per-program SEEDING (Methodist 14/14 today; the
//                           per-school-type handler table above is where the
//                           staged rules R3/R7/... plug in next).
//   2. proposeSchedule    — deterministic inpatient fair-fill of whatever
//                           coverage is still open after seeding. LOCKS every
//                           existing assignment: it only fills empty cells and
//                           never overwrites a manual edit.
//   3. buildDraftReport   — the post-generate validation report (A3).
//
// Invariants this function MUST preserve (pinned by program-rules.test.js):
//   • Pure — never mutates `state`; returns fresh objects.
//   • Idempotent — generateDraft(generateDraft(s).state).state deep-equals
//     generateDraft(s).state. Both primitives are individually idempotent, so
//     the only way to break this is a wall-clock value in the report. The
//     report is therefore a pure function of (resulting state, block) with NO
//     timestamps. (Contrast generateExportManifest, which DOES stamp a time —
//     do not pull that pattern in here.)
//   • Empty-cell-only — seeds open cells exclusively; existing assignments of
//     every source (Manual, Auto-Methodist, Range-Assigned, ...) are kept.
//
// Note: Methodist-outpatient handling stays isolated inside
// applyMethodistAutoAssign. D1b is RESOLVED (Coordinator #8, 2026-06-02): a
// Methodist rotator is OFF our inpatient service during their outpatient
// fortnight, enforced in proposeSchedule's eligibleFor (getRotatorPhase
// exclusion) — so the 14/14 split is never broken by fair-fill.
export function generateDraft(state, block, baselineState = null) {
  if (!state || !block) {
    return { state: state ?? null, report: emptyReport(block) };
  }

  // Report counts diff against the true pre-command state. Callers that
  // preassign first (inpatient.draft) pass the original state here so cells
  // added by preassignment still count as "added" in the report.
  const baseline = baselineState ?? state;
  const inputIpCount = (baseline.inpatientAssignments || []).length;
  const inputOpCount = (baseline.outpatientSessions || []).length;

  // Step 0 — rule 5b: staffing-driven Methodist start side. Computed only for
  // Methodist rotators the user hasn't already decided (explicit
  // methodistStartSide wins). chooseMethodistStartSide is a pure function of
  // (rotator dates, block dates), so re-runs always land on the same side —
  // idempotency holds.
  const withSides = {
    ...state,
    rotators: (state.rotators || []).map((r) =>
      classifyRotatorSchoolType(r) === "methodist" && methodistRotationWindow(r) && !r.methodistStartSide
        ? { ...r, methodistStartSide: chooseMethodistStartSide(r, block) }
        : r
    )
  };

  // Step 1 — per-program seeding (Methodist 14/14; rules 3/4/7 length split).
  const seeded = applyProgramRules(withSides, block);

  // Step 1b — rule 2 / A2: seed a lone blank fellow inpatient; collect
  // candidate names for dates where several blank fellows are active.
  const { state: fellowSeeded, candidates: fellowCandidates } = seedFellowInpatient(seeded, block);
  const fellowCandidateSlots = fellowCandidateSlotKeys(fellowCandidates);

  // Step 2 — deterministic inpatient fair-fill of remaining open coverage
  // (rule 10: inpatient before outpatient), plus its one-pass swap repair.
  // proposeSchedule's eligibleFor excludes Methodist rotators in their
  // outpatient fortnight (D1b, Coordinator #8), so a Methodist OP-half rotator is
  // never fair-filled onto inpatient — the 14/14 split is honored even on
  // weekends/holidays where they hold no clinic and would otherwise look free.
  const { proposedState, unmet } = proposeSchedule(fellowSeeded, block, { excludedSlots: fellowCandidateSlots });

  // Step 2b — rule 11: top clinic weekdays up to the outpatient target.
  const opFilled = fillOutpatientTarget(proposedState, block, { excludedSlots: fellowCandidateSlots });

  // Step 3 — post-generate validation report (timestamp-free → idempotent).
  const report = buildDraftReport(opFilled, block, {
    unmet,
    fellowCandidates,
    inpatientAdded: (opFilled.inpatientAssignments || []).length - inputIpCount,
    outpatientAdded: (opFilled.outpatientSessions || []).length - inputOpCount
  });

  return { state: opFilled, report };
}

// The A3 validation report. Pure function of (resulting state, block).
function buildDraftReport(state, block, extras = {}) {
  const checks = [];
  const dates = dateRange(block.startDate, block.endDate);
  const rotators = state.rotators || [];
  const activeInBlock = rotators.filter((r) => dates.some((d) => isRotatorActiveOn(r, d)));

  // --- below-minimum inpatient staffing (algo-coupled to R10/R11) ----------
  // Read straight off the resulting state so it stays honest even for cells a
  // human filled by hand; proposeSchedule's `unmet` carries the per-slot reason
  // and is passed through verbatim for callers that want the detail.
  for (const date of dates) {
    const required = coverageForDate(block, date).count;
    if (required <= 0) continue;
    const staffed = new Set(
      (state.inpatientAssignments || [])
        .filter((a) => a.date === date && a.role !== "Off")
        .map((a) => a.rotatorId)
    );
    if (staffed.size < required) {
      checks.push({
        id: "ip-below-min",
        severity: "error",
        date,
        required,
        have: staffed.size,
        message: `${date}: inpatient is staffed by ${staffed.size}, needs ${required}.`
      });
    }
  }

  // --- Methodist rotator can't compute its 14/14 split (spec §9.1) ----------
  for (const r of activeInBlock) {
    if (classifyRotatorSchoolType(r) !== "methodist") continue;
    const window = methodistRotationWindow(r);
    if (!window) {
      checks.push({
        id: "methodist-no-start",
        severity: "warning",
        rotatorId: r.id,
        message: `${rotatorLabel(r)} is Methodist but has no rotation start date — the 14/14 inpatient/outpatient split can't be generated.`
      });
    } else if (window.derived) {
      // Coordinator 2026-07-10: without an explicit date, the first scheduled day
      // counts as day 1 and short rotations split in half. Surface the
      // assumption so a wrong guess is visible and correctable.
      checks.push({
        id: "methodist-derived-start",
        severity: "info",
        rotatorId: r.id,
        message: `${rotatorLabel(r)} has no explicit rotation start date — using their first scheduled day (${window.start}) as day 1 of a ${window.half}/${window.cycle - window.half} inpatient/outpatient split.`
      });
    }
  }

  // --- fellow present in the block but missing from IP / OP ----------------
  // Algo-coupled to the (not-yet-built) fellow rule R2/A2, but the *check* is
  // computable now and useful: a block with a fellow on neither service is
  // almost certainly an oversight.
  const fellows = activeInBlock.filter(isPediatricNeurologyFellow);
  if (fellows.length > 0) {
    const fellowIds = new Set(fellows.map((f) => f.id));
    const inBlock = (d) => d >= block.startDate && d <= block.endDate;
    const anyFellowIp = (state.inpatientAssignments || []).some(
      (a) => a.role !== "Off" && fellowIds.has(a.rotatorId) && inBlock(a.date)
    );
    const anyFellowOp = (state.outpatientSessions || []).some(
      (o) => fellowIds.has(o.rotatorId) && inBlock(o.date)
    );
    if (!anyFellowIp) {
      checks.push({
        id: "fellow-no-inpatient",
        severity: "warning",
        message: "No fellow is assigned to inpatient anywhere in this block."
      });
    }
    if (!anyFellowOp) {
      checks.push({
        id: "fellow-no-outpatient",
        severity: "warning",
        message: "No fellow is assigned to outpatient anywhere in this block."
      });
    }
  }

  // --- rule 2 / A2: blank fellow dates with multiple candidates -------------
  // Show the NAMES ("Coordinator / Eden"), never a bare "unresolved". One check
  // per distinct candidate set, with the dates it covers.
  const candidateGroups = new Map();
  for (const c of Array.isArray(extras.fellowCandidates) ? extras.fellowCandidates : []) {
    const key = c.names.join(" / ");
    if (!candidateGroups.has(key)) candidateGroups.set(key, []);
    candidateGroups.get(key).push(c.date);
  }
  for (const [names, cDates] of candidateGroups) {
    checks.push({
      id: "fellow-blank-candidates",
      severity: "warning",
      candidates: names.split(" / "),
      dates: cDates,
      message: `${cDates.length} day${cDates.length === 1 ? "" : "s"} (${cDates[0]}${cDates.length > 1 ? ` – ${cDates[cDates.length - 1]}` : ""}) need a fellow: pick ${names} on the Fellows page.`
    });
  }

  // --- rule 11: outpatient below target on clinic weekdays ------------------
  const noClinicHolidays = new Set(
    (block.holidays || []).filter((h) => h && h.noClinic).map((h) => h.date)
  );
  const opShortDates = dates.filter((date) => {
    const wd = weekdayName(date);
    if (wd === "Saturday" || wd === "Sunday" || noClinicHolidays.has(date)) return false;
    const opCount = new Set(
      (state.outpatientSessions || []).filter((s) => s.date === date).map((s) => s.rotatorId)
    ).size;
    return opCount < OUTPATIENT_TARGET_ROTATORS;
  });
  if (opShortDates.length > 0) {
    checks.push({
      id: "op-below-target",
      severity: "warning",
      dates: opShortDates,
      message: `${opShortDates.length} clinic day${opShortDates.length === 1 ? "" : "s"} (first: ${opShortDates[0]}) have fewer than ${OUTPATIENT_TARGET_ROTATORS} outpatient rotators.`
    });
  }

  // --- rule 4: five-week sandwich (isolated inpatient week) -----------------
  // Week phases are read off the ACTUAL records (so hand edits are checked
  // too, not just what the split seeded): a week is IP if it has inpatient
  // days and no outpatient days, OP for the reverse; mixed/empty weeks don't
  // participate. An IP week flanked by OP weeks is the anti-burnout
  // violation.
  for (const r of activeInBlock) {
    if (isPediatricNeurologyFellow(r)) continue;
    let flagged = false;
    for (const seg of Array.isArray(r.segments) ? r.segments : []) {
      const chunks = segmentSplitPlan(seg);
      if (chunks.length < 3 || flagged) continue;
      const phases = chunks.map((chunk) => {
        // Majority day-count per week — auto clinic fill can add a stray OP
        // day to an inpatient week (and hand edits the reverse), so presence
        // alone would misread the week's actual service.
        const ipDays = new Set(
          (state.inpatientAssignments || [])
            .filter((a) => a.rotatorId === r.id && a.role !== "Off" && a.date >= chunk.start && a.date <= chunk.end)
            .map((a) => a.date)
        ).size;
        const opDays = new Set(
          (state.outpatientSessions || [])
            .filter((s) => s.rotatorId === r.id && s.date >= chunk.start && s.date <= chunk.end)
            .map((s) => s.date)
        ).size;
        if (ipDays > opDays) return "ip";
        if (opDays > ipDays) return "op";
        return null;
      });
      for (let i = 1; i < phases.length - 1; i += 1) {
        if (phases[i] === "ip" && phases[i - 1] === "op" && phases[i + 1] === "op") {
          checks.push({
            id: "five-week-sandwich",
            severity: "warning",
            rotatorId: r.id,
            message: `${rotatorLabel(r)} has a single inpatient week sandwiched between outpatient weeks — keep inpatient weeks consecutive.`
          });
          flagged = true;
          break;
        }
      }
    }
  }

  // --- rule 6: UT year balance (cross-block IP/OP imbalance) ----------------
  // ponytail: |IP − OP| > 7 days once ≥ 14 days are on the books; tune the
  // thresholds if Coordinator wants a tighter definition of "balanced".
  for (const r of rotators) {
    const type = classifyRotatorSchoolType(r);
    if (type !== "ut-peds" && type !== "ut-adult") continue;
    const ipDays = new Set(
      (state.inpatientAssignments || [])
        .filter((a) => a.rotatorId === r.id && a.role !== "Off")
        .map((a) => a.date)
    ).size;
    const opDays = new Set(
      (state.outpatientSessions || []).filter((s) => s.rotatorId === r.id).map((s) => s.date)
    ).size;
    if (ipDays + opDays >= 14 && Math.abs(ipDays - opDays) > 7) {
      checks.push({
        id: "year-balance",
        severity: "warning",
        rotatorId: r.id,
        message: `${rotatorLabel(r)} has ${ipDays} inpatient vs ${opDays} outpatient days across all blocks — rebalance future blocks.`
      });
    }
  }

  return {
    summary: {
      blockName: block.name || "",
      startDate: block.startDate || "",
      endDate: block.endDate || "",
      inpatientAdded: Number.isFinite(extras.inpatientAdded) ? extras.inpatientAdded : 0,
      outpatientAdded: Number.isFinite(extras.outpatientAdded) ? extras.outpatientAdded : 0,
      errorCount: checks.filter((c) => c.severity === "error").length,
      warningCount: checks.filter((c) => c.severity === "warning").length
    },
    checks,
    unmet: Array.isArray(extras.unmet) ? extras.unmet : []
  };
}

function rotatorLabel(rotator) {
  return rotator.displayName || rotator.fullName || rotator.id;
}

function emptyReport(block) {
  return {
    summary: {
      blockName: block?.name || "",
      startDate: block?.startDate || "",
      endDate: block?.endDate || "",
      inpatientAdded: 0,
      outpatientAdded: 0,
      errorCount: 0,
      warningCount: 0
    },
    checks: [],
    unmet: []
  };
}
