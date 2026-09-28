import { describe, expect, it } from "vitest";
import {
  makeRotator,
  createInitialState,
  scheduleInpatientAssignment
} from "./scheduler.js";
import { generateDraft } from "./program-rules.js";

// Mon–Fri week (2026-05-04..08) so weekday demand applies every day.
const fullWeekSeg = [{ start: "2026-05-04", end: "2026-05-08" }];

function weekState({ coverage, rotators, inpatientAssignments = [], outpatientSessions = [] }) {
  const block = {
    id: "b1",
    name: "B",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage
  };
  let s = createInitialState();
  s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators, inpatientAssignments, outpatientSessions };
  return { s, block };
}

function methodistRotator(overrides = {}) {
  const base = {
    id: overrides.id || "rot-methodist-test",
    fullName: "Casey Methodist",
    displayName: "Casey Methodist",
    program: "Methodist",
    schoolType: "methodist",
    level: "PGY-3",
    role: "Resident",
    segments: overrides.segments || [{ start: "2026-06-01", end: "2026-06-28" }],
    rotationStartDate: "rotationStartDate" in overrides ? overrides.rotationStartDate : "2026-06-01",
    continuityClinic: "",
    dayOff: [],
    unavailableRanges: []
  };
  return base;
}

function blockOf(name, start, end) {
  return {
    id: `block-${name}`,
    name,
    startDate: start,
    endDate: end,
    status: "Draft",
    generate: { inpatient: true, outpatient: true },
    holidays: []
  };
}

describe("generateDraft — top-level auto-draft orchestrator (A1 keystone)", () => {
  it("returns a { state, report } pair with a checks array", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const result = generateDraft(s, block);
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("report");
    expect(Array.isArray(result.report.checks)).toBe(true);
    expect(Array.isArray(result.report.unmet)).toBe(true);
    expect(result.report.summary).toBeTruthy();
  });

  it("seeds open inpatient coverage (composes proposeSchedule) and reports what it added", () => {
    // "Other" rotators are exempt from the length split, so every inpatient
    // record here must come from the fair-fill path.
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [
        makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "Other", "PGY-3", fullWeekSeg)
      ]
    });
    const { state, report } = generateDraft(s, block);
    const draft = state.inpatientAssignments.filter((a) => a.source === "Auto-Draft");
    expect(draft.length).toBe(5); // Mon–Fri, 1/day
    expect(report.summary.inpatientAdded).toBe(5);
  });

  it("never overwrites a manual assignment: the pre-seeded cell is preserved exactly", () => {
    let { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [
        makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "UT Pediatrics", "PGY-3", fullWeekSeg)
      ]
    });
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "r1", role: "Team senior", source: "Manual" });
    const manualBefore = s.inpatientAssignments.find((a) => a.date === "2026-05-04" && a.rotatorId === "r1");
    const { state } = generateDraft(s, block);
    const manualAfter = state.inpatientAssignments.find(
      (a) => a.date === "2026-05-04" && a.rotatorId === "r1" && a.source === "Manual"
    );
    expect(manualAfter).toEqual(manualBefore);
    // Monday demand of 1 is already met by the manual entry -> no Auto-Draft on Monday.
    const mondayDraft = state.inpatientAssignments.filter(
      (a) => a.date === "2026-05-04" && a.source === "Auto-Draft"
    );
    expect(mondayDraft.length).toBe(0);
  });

  it("is idempotent: running on its own output adds nothing and yields a deep-equal state", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [
        makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "UT Pediatrics", "PGY-3", fullWeekSeg)
      ]
    });
    const once = generateDraft(s, block).state;
    const twice = generateDraft(once, block).state;
    expect(twice).toEqual(once);
  });

  it("does not mutate the input state", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const before = s.inpatientAssignments.length;
    generateDraft(s, block);
    expect(s.inpatientAssignments.length).toBe(before);
  });

  it("report carries no wall-clock timestamp (this is what keeps the draft idempotent)", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const { report } = generateDraft(s, block);
    // ISO *datetime* (date + "T" + clock) must not appear; date-only strings are fine.
    expect(JSON.stringify(report)).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
  });

  it("flags below-minimum inpatient staffing (error) when the roster can't cover demand", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 2 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)] // need 2, have 1
    });
    const { report } = generateDraft(s, block);
    const belowMin = report.checks.filter((c) => c.id === "ip-below-min");
    expect(belowMin.length).toBeGreaterThan(0);
    expect(belowMin.every((c) => c.severity === "error")).toBe(true);
    expect(report.unmet.length).toBeGreaterThan(0);
  });

  it("does NOT flag below-min when every required day is covered", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [
        makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "UT Pediatrics", "PGY-3", fullWeekSeg)
      ]
    });
    const { report } = generateDraft(s, block);
    expect(report.checks.some((c) => c.id === "ip-below-min")).toBe(false);
  });

  it("runs the Methodist 14/14 auto-assign as part of the draft", () => {
    const block = blockOf("jun", "2026-06-01", "2026-06-28");
    let s = createInitialState();
    s = {
      ...s,
      serviceBlocks: [block],
      activeBlockId: block.id,
      rotators: [methodistRotator({ id: "m" })],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const { state } = generateDraft(s, block);
    expect(state.inpatientAssignments.some((a) => a.rotatorId === "m" && a.source === "Auto-Methodist")).toBe(true);
    expect(state.outpatientSessions.some((o) => o.rotatorId === "m" && o.source === "Auto-Methodist")).toBe(true);
  });

  it("reports the derived start for a Methodist rotator missing a rotation start date", () => {
    // Coordinator 2026-07-10: the split derives from the first scheduled day, so
    // the report surfaces the assumption instead of a can't-generate warning.
    const block = blockOf("jun", "2026-06-01", "2026-06-28");
    let s = createInitialState();
    s = {
      ...s,
      serviceBlocks: [block],
      activeBlockId: block.id,
      rotators: [methodistRotator({ id: "m", rotationStartDate: undefined })],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const { report } = generateDraft(s, block);
    expect(report.checks.some((c) => c.id === "methodist-derived-start" && c.rotatorId === "m")).toBe(true);
    expect(report.checks.some((c) => c.id === "methodist-no-start")).toBe(false);
  });

  it("warns when an active fellow ends up with no inpatient assignment in the block", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 0 } } }, // no IP demand -> nobody seeded to IP
      rotators: [makeRotator("f1", "Fel", "Other", "Fellow", fullWeekSeg)]
    });
    const { report } = generateDraft(s, block);
    expect(report.checks.some((c) => c.id === "fellow-no-inpatient")).toBe(true);
  });

  it("does NOT warn about a missing-IP fellow when there is no fellow in the block", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 0 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const { report } = generateDraft(s, block);
    expect(report.checks.some((c) => c.id === "fellow-no-inpatient")).toBe(false);
  });

  it("returns the input state unchanged (no report crash) when block is missing", () => {
    const { s } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", fullWeekSeg)]
    });
    const result = generateDraft(s, null);
    expect(result.state).toBe(s);
    expect(result.report.checks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Staged rules 2/3/4/5b/6/7/11 + swap repair (Coordinator gap-fill, 2026-07-05)
// ---------------------------------------------------------------------------
import {
  segmentSplitPlan,
  chooseMethodistStartSide,
  proposeSchedule,
  OUTPATIENT_TARGET_ROTATORS
} from "./scheduler.js";

describe("segmentSplitPlan — length-based split shapes (rules 3/4/7)", () => {
  const seg = (days) => ({ start: "2026-05-04", end: addIso("2026-05-04", days - 1) });
  function addIso(iso, n) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const phases = (days) => segmentSplitPlan(seg(days)).map((c) => c.phase[0]); // i/o

  it("produces the canonical shapes for 1–5 week segments", () => {
    expect(phases(7)).toEqual(["i"]);
    expect(phases(14)).toEqual(["i", "o"]);
    expect(phases(21)).toEqual(["i", "i", "o"]);
    expect(phases(28)).toEqual(["o", "i", "i", "o"]);
    expect(phases(35)).toEqual(["o", "i", "i", "i", "o"]); // rule 4 verbatim
  });

  it("keeps the inpatient weeks as ONE consecutive run for every length (no rule-4 sandwich)", () => {
    for (let days = 7; days <= 70; days += 7) {
      const p = phases(days).join("");
      expect(p).toMatch(/^o*i+o*$/);
    }
  });

  it("covers the whole segment: last chunk absorbs remainder days", () => {
    const plan = segmentSplitPlan({ start: "2026-05-04", end: "2026-05-27" }); // 24 days ≈ 3 wk
    expect(plan[0].start).toBe("2026-05-04");
    expect(plan[plan.length - 1].end).toBe("2026-05-27");
    expect(plan.length).toBe(3);
  });

  it("returns [] for invalid segments", () => {
    expect(segmentSplitPlan(null)).toEqual([]);
    expect(segmentSplitPlan({ start: "2026-05-04" })).toEqual([]);
  });
});

describe("length-split seeding inside generateDraft (rules 3/7)", () => {
  const fourWeekBlock = () => ({
    id: "b4",
    name: "B4",
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    status: "Draft",
    generate: {},
    holidays: [],
    coverage: {
      weekday: { ip: { count: 0 } },
      saturday: { ip: { count: 0 } },
      sunday: { ip: { count: 0 } },
      holiday: { ip: { count: 0 } }
    }
  });
  const fourWeekState = (rotators) => {
    let s = createInitialState();
    const block = fourWeekBlock();
    return { s: { ...s, serviceBlocks: [block], activeBlockId: "b4", rotators, inpatientAssignments: [], outpatientSessions: [] }, block };
  };

  it("seeds a 4-week UT Peds visit as OP / IP / IP / OP over their actual dates", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-06-01", end: "2026-06-28" }]);
    const { s, block } = fourWeekState([r]);
    const { state } = generateDraft(s, block);
    const ipOn = (d) => state.inpatientAssignments.some((a) => a.rotatorId === "r1" && a.date === d);
    const opOn = (d) => state.outpatientSessions.some((o) => o.rotatorId === "r1" && o.date === d);
    expect(opOn("2026-06-02")).toBe(true);  // week 1 → outpatient (Tue)
    expect(ipOn("2026-06-02")).toBe(false);
    expect(ipOn("2026-06-10")).toBe(true);  // week 2 → inpatient
    expect(ipOn("2026-06-17")).toBe(true);  // week 3 → inpatient
    expect(opOn("2026-06-23")).toBe(true);  // week 4 → outpatient (Tue)
    expect(ipOn("2026-06-23")).toBe(false);
    // seeded records carry the Auto-Split source
    expect(state.inpatientAssignments.filter((a) => a.rotatorId === "r1").every((a) => a.source === "Auto-Split")).toBe(true);
  });

  it("skips segments the user already gave a defaultPhase, and never stacks IP over an existing OP day", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-06-01", end: "2026-06-28", defaultPhase: "outpatient" }]);
    const { s, block } = fourWeekState([r]);
    const { state } = generateDraft(s, block);
    expect(state.inpatientAssignments.filter((a) => a.rotatorId === "r1" && a.source === "Auto-Split")).toEqual([]);

    // manual OP day inside an IP-plan week wins over the split
    const r2 = makeRotator("r2", "B", "UT Pediatrics", "PGY-3", [{ start: "2026-06-01", end: "2026-06-28" }]);
    const { s: s2, block: b2 } = fourWeekState([r2]);
    const manualOp = { id: "m1", date: "2026-06-10", period: "AM", clinic: "QRS", provider: "", rotatorId: "r2", status: "Scheduled", source: "Manual" };
    const { state: state2 } = generateDraft({ ...s2, outpatientSessions: [manualOp] }, b2);
    expect(state2.inpatientAssignments.some((a) => a.rotatorId === "r2" && a.date === "2026-06-10")).toBe(false);
  });

  it("is idempotent: drafting a drafted state changes nothing", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-06-01", end: "2026-06-28" }]);
    const { s, block } = fourWeekState([r]);
    const once = generateDraft(s, block);
    const twice = generateDraft(once.state, block);
    expect(twice.state).toEqual(once.state);
  });
});

describe("Methodist start side (rule 5b)", () => {
  it("keeps the spec §9.1 outpatient-first example: rotation May 20 – Jun 16, block June", () => {
    const r = methodistRotator({ rotationStartDate: "2026-05-20", segments: [{ start: "2026-05-20", end: "2026-06-16" }] });
    const block = blockOf("june", "2026-06-01", "2026-06-30");
    expect(chooseMethodistStartSide(r, block)).toBe("outpatient");
  });

  it("keeps outpatient-first on a full-overlap tie", () => {
    const r = methodistRotator({ rotationStartDate: "2026-06-01" });
    const block = blockOf("june", "2026-06-01", "2026-06-30");
    expect(chooseMethodistStartSide(r, block)).toBe("outpatient");
  });

  it("flips to inpatient-first when only the FIRST fortnight falls inside the block", () => {
    const r = methodistRotator({ rotationStartDate: "2026-06-20", segments: [{ start: "2026-06-20", end: "2026-07-17" }] });
    const block = blockOf("june", "2026-06-01", "2026-06-30");
    expect(chooseMethodistStartSide(r, block)).toBe("inpatient");
  });

  it("generateDraft persists the choice and seeds inpatient (not clinic) on the in-block days", () => {
    const r = methodistRotator({ id: "m1", rotationStartDate: "2026-06-20", segments: [{ start: "2026-06-20", end: "2026-07-17" }] });
    const block = blockOf("june", "2026-06-01", "2026-06-30");
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: block.id, rotators: [r], inpatientAssignments: [], outpatientSessions: [] };
    const { state } = generateDraft(s, block);
    expect(state.rotators.find((x) => x.id === "m1").methodistStartSide).toBe("inpatient");
    expect(state.inpatientAssignments.some((a) => a.rotatorId === "m1" && a.date === "2026-06-22" && a.source === "Auto-Methodist")).toBe(true);
  });

  it("an explicit user-set start side always wins", () => {
    const r = methodistRotator({ id: "m1", rotationStartDate: "2026-06-20", segments: [{ start: "2026-06-20", end: "2026-07-17" }] });
    r.methodistStartSide = "outpatient";
    const block = blockOf("june", "2026-06-01", "2026-06-30");
    let s = createInitialState();
    s = { ...s, serviceBlocks: [block], activeBlockId: block.id, rotators: [r], inpatientAssignments: [], outpatientSessions: [] };
    const { state } = generateDraft(s, block);
    expect(state.rotators.find((x) => x.id === "m1").methodistStartSide).toBe("outpatient");
    // 2026-06-22 is day 2 of the rotation → outpatient-first keeps it in clinic
    expect(state.outpatientSessions.some((o) => o.rotatorId === "m1" && o.date === "2026-06-22")).toBe(true);
    expect(state.inpatientAssignments.some((a) => a.rotatorId === "m1" && a.date === "2026-06-22")).toBe(false);
  });
});

describe("fellow rule 2 / A2", () => {
  const fellow = (id, name) => ({
    id,
    fullName: name,
    displayName: name,
    program: "Pediatric Neurology Fellowship",
    schoolType: "other",
    level: "Fellow",
    role: "Fellow",
    segments: [{ start: "2026-05-04", end: "2026-05-08" }],
    continuityClinic: "",
    dayOff: [],
    unavailableRanges: []
  });

  it("does not treat a persisted Psychiatry PGY-5 role as the peds fellow", () => {
    const kai = {
      ...makeRotator("psych-1", "Kai Doe", "UT Psychiatry", "PGY-5", fullWeekSeg),
      role: "Fellow"
    };
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [kai]
    });
    const { state, report } = generateDraft(s, block);
    expect(state.inpatientAssignments.some(
      (assignment) => assignment.rotatorId === "psych-1" && assignment.role === "Fellow"
    )).toBe(false);
    expect(report.checks.some((check) => check.id.startsWith("fellow-"))).toBe(false);
  });

  it("a lone blank fellow is seeded inpatient (rule 10: weekday minimum is fellow + 2)", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 2 } } },
      rotators: [fellow("f1", "Coordinator"), makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg)]
    });
    const { state, report } = generateDraft(s, block);
    expect(state.inpatientAssignments.some((a) => a.rotatorId === "f1" && a.source === "Auto-Draft")).toBe(true);
    expect(report.checks.some((c) => c.id === "fellow-no-inpatient")).toBe(false);
    expect(report.checks.some((c) => c.id === "fellow-blank-candidates")).toBe(false);
  });

  it("two blank fellows are never guessed between — the report names the candidates", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [fellow("f1", "Coordinator"), fellow("f2", "Eden")]
    });
    const { state, report } = generateDraft(s, block);
    const check = report.checks.find((c) => c.id === "fellow-blank-candidates");
    expect(check).toBeTruthy();
    expect(check.candidates).toEqual(["Coordinator", "Eden"]);
    expect(check.message).toContain("Coordinator / Eden");
    expect(state.inpatientAssignments.some((a) => ["f1", "f2"].includes(a.rotatorId) && a.source === "Auto-Draft")).toBe(false);
    expect(state.outpatientSessions.some((s) => ["f1", "f2"].includes(s.rotatorId))).toBe(false);
  });

  it("a fellow whose template covers the date is not 'blank'", () => {
    const templated = fellow("f1", "Coordinator");
    templated.segments = [{ start: "2026-05-04", end: "2026-05-08", defaultPhase: "outpatient" }];
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [templated, fellow("f2", "Eden")]
    });
    const { state, report } = generateDraft(s, block);
    // f2 is the only blank fellow → seeded; no candidate ambiguity.
    expect(report.checks.some((c) => c.id === "fellow-blank-candidates")).toBe(false);
    expect(state.inpatientAssignments.some((a) => a.rotatorId === "f2" && a.source === "Auto-Draft")).toBe(true);
  });
});

describe("outpatient fair-fill (rule 11)", () => {
  it("tops clinic weekdays up toward the target and reports days still short", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [
        makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "Other", "PGY-3", fullWeekSeg)
      ]
    });
    const { state, report } = generateDraft(s, block);
    // one rotator lands inpatient each day; the free one is drafted to clinic
    const opDays = new Set(state.outpatientSessions.filter((o) => o.source === "Auto-Draft").map((o) => o.date));
    expect(opDays.size).toBe(5);
    // still below the 2-rotator target (only one body available) → warned
    const check = report.checks.find((c) => c.id === "op-below-target");
    expect(check).toBeTruthy();
    expect(check.dates.length).toBe(5);
    expect(OUTPATIENT_TARGET_ROTATORS).toBe(2);
  });

  it("never drafts an inpatient-assigned rotator into clinic the same day", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 1 } } },
      rotators: [makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg)]
    });
    const { state } = generateDraft(s, block);
    for (const o of state.outpatientSessions) {
      expect(state.inpatientAssignments.some((a) => a.date === o.date && a.rotatorId === o.rotatorId)).toBe(false);
    }
  });
});

describe("proposeSchedule swap-repair", () => {
  it("repairs a stranded slot by moving an Auto-Draft record and backfilling its day", () => {
    // cap 1 consecutive day. A covers Mon–Wed, B covers Mon–Tue.
    // Greedy: Wed (scarcest) → A; Mon → B (lightest); Tue → nobody
    // (A adjacent to Wed, B adjacent to Mon) → unmet without repair.
    // Repair: move B Mon→Tue, backfill Mon with A. All three staffed.
    const block = {
      id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-06",
      status: "Draft", generate: {}, holidays: [],
      coverage: { weekday: { ip: { count: 1 } } }
    };
    let s = createInitialState();
    s = {
      ...s,
      serviceBlocks: [block],
      activeBlockId: "b1",
      rules: { ...s.rules, maxConsecutiveInpatientDays: 1 },
      rotators: [
        makeRotator("ra", "A", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-06" }]),
        makeRotator("rb", "B", "Other", "PGY-3", [{ start: "2026-05-04", end: "2026-05-05" }])
      ],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    const { proposedState, unmet } = proposeSchedule(s, block);
    expect(unmet).toEqual([]);
    for (const d of ["2026-05-04", "2026-05-05", "2026-05-06"]) {
      expect(proposedState.inpatientAssignments.filter((a) => a.date === d && a.role !== "Off").length).toBe(1);
    }
    // determinism: same input → same output
    const again = proposeSchedule(s, block);
    expect(again.proposedState).toEqual(proposedState);
  });

  it("never moves a manual record and leaves truly impossible slots in unmet", () => {
    const block = {
      id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-05",
      status: "Draft", generate: {}, holidays: [],
      coverage: { weekday: { ip: { count: 2 } } }
    };
    let s = createInitialState();
    s = {
      ...s,
      serviceBlocks: [block],
      activeBlockId: "b1",
      rotators: [makeRotator("ra", "A", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-05" }])],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    s = scheduleInpatientAssignment(s, { date: "2026-05-04", rotatorId: "ra", role: "Resident", source: "Manual" });
    const { proposedState, unmet } = proposeSchedule(s, block);
    // the manual record is untouched
    const manual = proposedState.inpatientAssignments.find((a) => a.source === "Manual");
    expect(manual).toBeTruthy();
    expect(manual.date).toBe("2026-05-04");
    // demand of 2 with one rotator stays honestly short on both days
    expect(unmet.length).toBe(2);
    expect(unmet.every((u) => typeof u.reason === "string")).toBe(true);
  });
});

describe("report checks R4 (sandwich) + R6 (year balance)", () => {
  it("flags a lone inpatient week sandwiched between outpatient weeks", () => {
    const seg = [{ start: "2026-05-04", end: "2026-05-24" }]; // 3 weeks
    const r = makeRotator("r1", "A", "Other", "PGY-2", seg);
    const block = {
      id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-24",
      status: "Draft", generate: {}, holidays: [],
      coverage: {
        weekday: { ip: { count: 0 } }, saturday: { ip: { count: 0 } },
        sunday: { ip: { count: 0 } }, holiday: { ip: { count: 0 } }
      }
    };
    let s = createInitialState();
    const op = (date) => ({ id: `o-${date}`, date, period: "AM", clinic: "QRS", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" });
    const ip = (date) => ({ id: `i-${date}`, date, rotatorId: "r1", role: "Resident", source: "Manual" });
    s = {
      ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [r],
      // week 1 OP, week 2 solidly IP, week 3 OP → rule-4 violation
      outpatientSessions: [op("2026-05-05"), op("2026-05-06"), op("2026-05-19"), op("2026-05-20")],
      inpatientAssignments: [ip("2026-05-11"), ip("2026-05-12"), ip("2026-05-13"), ip("2026-05-14"), ip("2026-05-15")]
    };
    const { report } = generateDraft(s, block);
    const check = report.checks.find((c) => c.id === "five-week-sandwich");
    expect(check).toBeTruthy();
    expect(check.rotatorId).toBe("r1");
  });

  it("flags a UT rotator whose cross-block IP/OP day totals diverge past a week", () => {
    const r = makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-01-05", end: "2026-01-25" }]);
    const block = {
      id: "b1", name: "B", startDate: "2026-05-04", endDate: "2026-05-08",
      status: "Draft", generate: {}, holidays: [],
      coverage: {
        weekday: { ip: { count: 0 } }, saturday: { ip: { count: 0 } },
        sunday: { ip: { count: 0 } }, holiday: { ip: { count: 0 } }
      }
    };
    let s = createInitialState();
    const ips = [];
    for (let i = 5; i < 21; i += 1) {
      const date = `2026-01-${String(i).padStart(2, "0")}`;
      ips.push({ id: `i-${date}`, date, rotatorId: "r1", role: "Resident", source: "Manual" });
    }
    s = { ...s, serviceBlocks: [block], activeBlockId: "b1", rotators: [r], inpatientAssignments: ips, outpatientSessions: [] };
    const { report } = generateDraft(s, block);
    const check = report.checks.find((c) => c.id === "year-balance");
    expect(check).toBeTruthy();
    expect(check.message).toContain("16 inpatient vs 0 outpatient");
  });

  it("stays quiet for balanced rotators", () => {
    const { s, block } = weekState({
      coverage: { weekday: { ip: { count: 0 } } },
      rotators: [makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg)]
    });
    const { report } = generateDraft(s, block);
    expect(report.checks.some((c) => c.id === "five-week-sandwich")).toBe(false);
    expect(report.checks.some((c) => c.id === "year-balance")).toBe(false);
  });
});
