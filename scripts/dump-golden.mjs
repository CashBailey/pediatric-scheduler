// Golden-vector generator for the JS→Python engine port.
//
// Runs the REAL JS domain functions over a fixed battery of inputs and writes
// {input, output} vectors to contracts/golden/. The Python port
// (backend_py/domain/) is then asserted against these vectors by
// backend_py/tests/test_golden.py, so parity is proven against the JS source
// of truth rather than hand-mirrored assertions that can drift.
//
// Regenerate after changing any ported function:  node scripts/dump-golden.mjs
//
// Only EXPORTED functions can be vectored here; module-private helpers
// (addDaysToIso, daysBetween) are covered transitively — addDaysToIso through
// extendBlockEnd, daysBetween by direct pytest unit tests.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  applyRangeAssignment,
  applyPreassignments,
  createInitialState,
  dateRange,
  extendBlockEnd,
  generateDailyReport,
  makeRotator,
  proposeSchedule,
  scheduleInpatientAssignment,
  scheduleOutpatientSession,
  weekdayName,
} from "../shared/scheduler/scheduler.js";
import { generateDraft } from "../shared/scheduler/program-rules.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "contracts", "golden");
mkdirSync(outDir, { recursive: true });

// Inputs chosen to exercise the parity hazards: weekends, month/year
// boundaries, the 2026 leap check (2028 is the next leap year — include Feb
// 29 2028), and US DST transitions (spring-forward 2026-03-08,
// fall-back 2026-11-01) where a naive local-time port would drift a day.
const WEEKDAY_DATES = [
  "2026-07-01", "2026-07-04", "2026-07-05", "2026-07-06", // Wed/Sat/Sun/Mon
  "2026-01-01", "2026-12-31",
  "2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02", // DST edges
  "2028-02-29", "2028-03-01",                              // leap day
];

const RANGE_CASES = [
  ["2026-07-01", "2026-07-07"],
  ["2026-07-01", "2026-07-01"], // single day
  ["2026-07-07", "2026-07-01"], // end before start -> []
  ["2026-02-26", "2026-03-02"], // month boundary
  ["2026-03-07", "2026-03-09"], // across spring-forward
  ["2026-10-31", "2026-11-02"], // across fall-back
  ["2028-02-27", "2028-03-01"], // across leap day
  ["2026-12-30", "2027-01-02"], // across year boundary
];

const EXTEND_CASES = [
  [{ id: "b", name: "B", endDate: "2026-07-30" }, 7],
  [{ id: "b", name: "B", endDate: "2026-07-30" }, -3],
  [{ id: "b", name: "B", endDate: "2026-02-26" }, 3],   // into March (non-leap)
  [{ id: "b", name: "B", endDate: "2026-12-28" }, 10],  // into next year
  [{ id: "b", name: "B", endDate: "2026-07-30" }, 0],
  [{ id: "b", name: "B" }, 7],                            // no endDate -> unchanged
];

const vectors = {
  generatedFrom: "shared/scheduler/scheduler.js",
  cases: {
    weekdayName: WEEKDAY_DATES.map((d) => ({ input: [d], output: weekdayName(d) })),
    dateRange: RANGE_CASES.map(([s, e]) => ({ input: [s, e], output: dateRange(s, e) })),
    extendBlockEnd: EXTEND_CASES.map(([b, n]) => ({ input: [b, n], output: extendBlockEnd(b, n) })),
  },
};

const outPath = join(outDir, "calendar.json");
writeFileSync(outPath, JSON.stringify(vectors, null, 2) + "\n");

const total = Object.values(vectors.cases).reduce((n, arr) => n + arr.length, 0);
console.log(`Wrote ${total} golden vectors to ${outPath}`);

function baseStateFor(block, rotators, extra = {}) {
  return {
    ...createInitialState(new Date("2026-01-01T12:00:00")),
    serviceBlocks: [block],
    activeBlockId: block.id,
    rotators,
    inpatientAssignments: extra.inpatientAssignments || [],
    outpatientSessions: extra.outpatientSessions || [],
  };
}

function weekBlock(overrides = {}) {
  return {
    id: "b1",
    name: "B",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    status: "Draft",
    generate: {},
    holidays: [],
    ...overrides,
  };
}

const fullWeekSeg = [{ start: "2026-05-04", end: "2026-05-08" }];
const peds = (id, name = id, segments = fullWeekSeg) =>
  makeRotator(id, name, "UT Pediatrics", "PGY-2", segments);
const methodist = (overrides = {}) => ({
  id: overrides.id || "m1",
  fullName: "Casey Methodist",
  displayName: "Casey Methodist",
  program: "Methodist",
  schoolType: "methodist",
  level: "PGY-3",
  role: "Resident",
  segments: overrides.segments || [{ start: "2026-05-20", end: "2026-06-16" }],
  rotationStartDate: "rotationStartDate" in overrides ? overrides.rotationStartDate : "2026-05-20",
  continuityClinic: "",
  dayOff: [],
  unavailableRanges: [],
  ...overrides,
});

function draftCase(name, block, state) {
  return { name, input: [state, block], output: proposeSchedule(state, block) };
}

let lockedState = baseStateFor(
  weekBlock({ coverage: { weekday: { ip: { count: 2 } } } }),
  [peds("r1", "A"), peds("r2", "B")]
);
lockedState = scheduleInpatientAssignment(lockedState, {
  date: "2026-05-04",
  rotatorId: "r1",
  role: "Resident",
  source: "Auto-Methodist",
});

const maxConsecBlock = {
  id: "b1",
  name: "B",
  startDate: "2026-05-04",
  endDate: "2026-05-10",
  status: "Draft",
  generate: {},
  holidays: [],
  coverage: {
    weekday: { ip: { count: 1 } },
    saturday: { ip: { count: 1 } },
    sunday: { ip: { count: 1 } },
  },
};

const swapRepairBlock = {
  id: "swap",
  name: "Swap",
  startDate: "2026-05-04",
  endDate: "2026-05-06",
  status: "Draft",
  generate: {},
  holidays: [],
  coverage: { weekday: { ip: { count: 1 } } },
};
const swapRepairState = {
  ...baseStateFor(swapRepairBlock, [
    makeRotator("ra", "A", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-06" }]),
    makeRotator("rb", "B", "Other", "PGY-3", [{ start: "2026-05-04", end: "2026-05-05" }]),
  ]),
  rules: { maxConsecutiveInpatientDays: 1, honorNoClinicHolidays: true },
};

const impossibleSwapBlock = {
  id: "manual-impossible",
  name: "Manual Impossible",
  startDate: "2026-05-04",
  endDate: "2026-05-05",
  status: "Draft",
  generate: {},
  holidays: [],
  coverage: { weekday: { ip: { count: 2 } } },
};
let manualImpossibleState = baseStateFor(impossibleSwapBlock, [
  makeRotator("ra", "A", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-05" }]),
]);
manualImpossibleState = scheduleInpatientAssignment(manualImpossibleState, {
  date: "2026-05-04",
  rotatorId: "ra",
  role: "Resident",
  source: "Manual",
});

const draftVectors = {
  generatedFrom: "shared/scheduler/scheduler.js::proposeSchedule",
  cases: [
    draftCase(
      "fills weekdays to demand",
      weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }), [
        peds("r1", "A"),
        peds("r2", "B"),
      ])
    ),
    draftCase("locks existing assignments", lockedState.serviceBlocks[0], lockedState),
    draftCase(
      "max consecutive cap",
      maxConsecBlock,
      baseStateFor(maxConsecBlock, [
        peds("r1", "A", [{ start: "2026-05-04", end: "2026-05-10" }]),
      ])
    ),
    draftCase(
      "over constrained unmet",
      weekBlock({ coverage: { weekday: { ip: { count: 2 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 2 } } } }), [peds("r1", "A")])
    ),
    draftCase(
      "balanced deterministic load",
      weekBlock({ endDate: "2026-05-07", coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(weekBlock({ endDate: "2026-05-07", coverage: { weekday: { ip: { count: 1 } } } }), [
        peds("r1", "A", [{ start: "2026-05-04", end: "2026-05-07" }]),
        peds("r2", "B", [{ start: "2026-05-04", end: "2026-05-07" }]),
      ])
    ),
    draftCase(
      "skips day off",
      weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }), [
        { ...peds("r1", "A"), dayOff: ["Wednesday"] },
      ])
    ),
    draftCase(
      "methodist outpatient fortnight excluded",
      { id: "b1", name: "B", startDate: "2026-05-25", endDate: "2026-05-29", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } },
      baseStateFor(
        { id: "b1", name: "B", startDate: "2026-05-25", endDate: "2026-05-29", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } },
        [methodist()]
      )
    ),
    draftCase(
      "methodist inpatient fortnight allowed",
      { id: "b1", name: "B", startDate: "2026-06-08", endDate: "2026-06-12", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } },
      baseStateFor(
        { id: "b1", name: "B", startDate: "2026-06-08", endDate: "2026-06-12", status: "Draft", generate: {}, holidays: [], coverage: { weekday: { ip: { count: 1 } } } },
        [methodist()]
      )
    ),
    draftCase(
      "role minimum",
      weekBlock({ coverage: { weekday: { ip: { count: 2, byRole: { Fellow: 1 } } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 2, byRole: { Fellow: 1 } } } } }), [
        { ...peds("f1", "Fellow"), role: "Fellow", level: "Fellow" },
        peds("r1", "Resident"),
      ])
    ),
    draftCase(
      "avoids continuity and outpatient double book",
      weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(
        weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
        [{ ...peds("r1", "A"), continuityClinic: "Wednesday PM" }],
        { outpatientSessions: [{ id: "out-manual-2026-05-05-am-r1", date: "2026-05-05", period: "AM", clinic: "Continuity", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" }] }
      )
    ),
    draftCase("swap repair backfills stranded slot", swapRepairBlock, swapRepairState),
    draftCase("swap repair never moves manual impossible slot", impossibleSwapBlock, manualImpossibleState),
  ],
};

const draftOutPath = join(outDir, "draft-fair-fill.json");
writeFileSync(draftOutPath, JSON.stringify(draftVectors, null, 2) + "\n");
console.log(`Wrote ${draftVectors.cases.length} draft golden vectors to ${draftOutPath}`);

const zeroCoverage = {
  weekday: { ip: { count: 0 } },
  saturday: { ip: { count: 0 } },
  sunday: { ip: { count: 0 } },
  holiday: { ip: { count: 0 } },
};

function blockOf(id, startDate, endDate, overrides = {}) {
  return {
    id,
    name: id,
    startDate,
    endDate,
    status: "Draft",
    generate: {},
    holidays: [],
    ...overrides,
  };
}

function fullDraftCase(name, block, state) {
  return { name, input: [state, block], output: generateDraft(state, block) };
}

const fellow = (id, name) => ({
  id,
  fullName: name,
  displayName: name,
  program: "Pediatric Neurology Fellowship",
  schoolType: "other",
  level: "Fellow",
  role: "Fellow",
  segments: fullWeekSeg,
  continuityClinic: "",
  dayOff: [],
  unavailableRanges: [],
});

const juneBlock = blockOf("june", "2026-06-01", "2026-06-28", { coverage: zeroCoverage });
const sideFlipBlock = blockOf("june-flip", "2026-06-01", "2026-06-30", { coverage: zeroCoverage });
const splitBlock = blockOf("split", "2026-06-01", "2026-06-28", { coverage: zeroCoverage });
const sandwichBlock = blockOf("sandwich", "2026-05-04", "2026-05-24", { coverage: zeroCoverage });
const sandwichRotator = makeRotator("r1", "A", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-24" }]);
const sandwichOp = (date) => ({ id: `o-${date}`, date, period: "AM", clinic: "QRS", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" });
const sandwichIp = (date) => ({ id: `i-${date}`, date, rotatorId: "r1", role: "Resident", source: "Manual" });

const fullDraftVectors = {
  generatedFrom: "shared/scheduler/program-rules.js::generateDraft",
  cases: [
    fullDraftCase(
      "fair fill plus outpatient top up",
      weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }), [
        makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg),
        makeRotator("r2", "B", "Other", "PGY-3", fullWeekSeg),
      ])
    ),
    fullDraftCase(
      "methodist seeds both phases",
      juneBlock,
      baseStateFor(juneBlock, [methodist({ id: "m1", rotationStartDate: "2026-06-01", segments: [{ start: "2026-06-01", end: "2026-06-28" }] })])
    ),
    fullDraftCase(
      "methodist staffing side flip",
      sideFlipBlock,
      baseStateFor(sideFlipBlock, [methodist({ id: "m1", rotationStartDate: "2026-06-20", segments: [{ start: "2026-06-20", end: "2026-07-17" }] })])
    ),
    fullDraftCase(
      "length split four week peds",
      splitBlock,
      baseStateFor(splitBlock, [makeRotator("r1", "A", "UT Pediatrics", "PGY-2", [{ start: "2026-06-01", end: "2026-06-28" }])])
    ),
    fullDraftCase(
      "lone fellow seeded inpatient",
      weekBlock({ coverage: { weekday: { ip: { count: 2 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 2 } } } }), [
        fellow("f1", "Coordinator"),
        makeRotator("r1", "A", "Other", "PGY-2", fullWeekSeg),
      ])
    ),
    fullDraftCase(
      "two fellow candidates reported",
      weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }),
      baseStateFor(weekBlock({ coverage: { weekday: { ip: { count: 1 } } } }), [
        fellow("f1", "Coordinator"),
        fellow("f2", "Eden"),
      ])
    ),
    fullDraftCase(
      "outpatient segment never drafted inpatient and weekend gets a day off",
      // Coordinator 2026-07-29 #6: weekend-inclusive block. r1 is explicitly
      // outpatient by segment.defaultPhase (must receive zero IP days);
      // r2/r3 fill the weekend without either working both Sat and Sun.
      blockOf("wknd", "2026-05-04", "2026-05-10", {
        coverage: { weekday: { ip: { count: 1 } }, saturday: { ip: { count: 1 } }, sunday: { ip: { count: 1 } } },
      }),
      baseStateFor(
        blockOf("wknd", "2026-05-04", "2026-05-10", {
          coverage: { weekday: { ip: { count: 1 } }, saturday: { ip: { count: 1 } }, sunday: { ip: { count: 1 } } },
        }),
        [
          { ...makeRotator("r1", "OutpatientOnly", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-10", defaultPhase: "outpatient" }]) },
          makeRotator("r2", "B", "Other", "PGY-3", [{ start: "2026-05-04", end: "2026-05-10" }]),
          makeRotator("r3", "C", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-10" }]),
        ]
      )
    ),
    fullDraftCase(
      "derived start methodist gets smart start side",
      // Coordinator 2026-07-29 #6c: no explicit rotationStartDate — the derived
      // window (first scheduled day) must still trigger chooseMethodistStartSide.
      blockOf("derived", "2026-06-01", "2026-06-14", { coverage: zeroCoverage }),
      baseStateFor(
        blockOf("derived", "2026-06-01", "2026-06-14", { coverage: zeroCoverage }),
        [methodist({ id: "m1", rotationStartDate: null, segments: [{ start: "2026-06-01", end: "2026-06-28" }] })]
      )
    ),
    fullDraftCase(
      "report sandwich warning",
      sandwichBlock,
      baseStateFor(
        sandwichBlock,
        [sandwichRotator],
        {
          outpatientSessions: [sandwichOp("2026-05-05"), sandwichOp("2026-05-06"), sandwichOp("2026-05-19"), sandwichOp("2026-05-20")],
          inpatientAssignments: [sandwichIp("2026-05-11"), sandwichIp("2026-05-12"), sandwichIp("2026-05-13"), sandwichIp("2026-05-14"), sandwichIp("2026-05-15")],
        }
      )
    ),
  ],
};

const fullDraftOutPath = join(outDir, "draft-full.json");
writeFileSync(fullDraftOutPath, JSON.stringify(fullDraftVectors, null, 2) + "\n");
console.log(`Wrote ${fullDraftVectors.cases.length} full draft golden vectors to ${fullDraftOutPath}`);

function preassignmentCase(name, block, state) {
  return { name, input: [state, block], output: applyPreassignments(state, block) };
}

const preassignmentBlock = {
  id: "pre",
  name: "Pre",
  startDate: "2026-09-14",
  endDate: "2026-09-20",
  status: "Draft",
  generate: {},
  holidays: [{ date: "2026-09-16", noClinic: true, label: "Closed clinic" }],
};
const preassignmentBase = (rotator, extra = {}) => baseStateFor(preassignmentBlock, [rotator], extra);
const preassignmentVectors = {
  generatedFrom: "shared/scheduler/scheduler.js::applyPreassignments",
  cases: [
    preassignmentCase(
      "outpatient skips weekends no-clinic holiday and continuity period",
      preassignmentBlock,
      preassignmentBase({
        ...makeRotator("r1", "Drew Quinn", "Other", "PGY-2", [
          { start: "2026-09-14", end: "2026-09-20", defaultPhase: "outpatient" },
        ]),
        continuityClinic: "Tuesday PM",
      })
    ),
    preassignmentCase(
      "inpatient weekdays preserve existing manual slot",
      preassignmentBlock,
      preassignmentBase(
        makeRotator("r2", "Bea Lee", "Other", "PGY-3", [
          { start: "2026-09-14", end: "2026-09-20", defaultPhase: "inpatient" },
        ]),
        {
          inpatientAssignments: [
            { id: "manual-ip", date: "2026-09-15", rotatorId: "r2", role: "Resident", source: "Manual" },
          ],
        }
      )
    ),
    preassignmentCase(
      "segments without default phase are no-op",
      preassignmentBlock,
      preassignmentBase(makeRotator("r3", "Cam Fox", "Other", "PGY-2", [
        { start: "2026-09-14", end: "2026-09-20" },
      ]))
    ),
  ],
};

const preassignmentOutPath = join(outDir, "preassignments.json");
writeFileSync(preassignmentOutPath, JSON.stringify(preassignmentVectors, null, 2) + "\n");
console.log(`Wrote ${preassignmentVectors.cases.length} preassignment golden vectors to ${preassignmentOutPath}`);

function rangeCase(name, block, state, args) {
  return { name, input: [state, block, args], output: applyRangeAssignment(state, block, args) };
}

const rangeBlock = {
  id: "range",
  name: "Range",
  startDate: "2026-05-04",
  endDate: "2026-05-10",
  status: "Draft",
  generate: {},
  holidays: [{ date: "2026-05-07", noClinic: true, label: "Closed clinic" }],
};
const rangeRotator = {
  ...makeRotator("r1", "Drew Quinn", "Other", "PGY-2", [{ start: "2026-05-04", end: "2026-05-10" }]),
  continuityClinic: "Wednesday PM",
};
const rangeBase = (extra = {}) => baseStateFor(rangeBlock, [rangeRotator], extra);
const rangeVectors = {
  generatedFrom: "shared/scheduler/scheduler.js::applyRangeAssignment",
  cases: [
    rangeCase(
      "inpatient strips outpatient and writes range ip",
      rangeBlock,
      rangeBase({
        outpatientSessions: [{ id: "manual-op", date: "2026-05-04", period: "AM", clinic: "QRS", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" }],
      }),
      { rotatorId: "r1", startDate: "2026-05-04", endDate: "2026-05-05", phase: "inpatient" }
    ),
    rangeCase(
      "outpatient skips weekend no clinic holiday and continuity period",
      rangeBlock,
      rangeBase({
        inpatientAssignments: [{ id: "manual-ip", date: "2026-05-06", rotatorId: "r1", role: "Resident", source: "Manual" }],
        outpatientSessions: [{ id: "manual-op", date: "2026-05-05", period: "AM", clinic: "Continuity", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" }],
      }),
      { rotatorId: "r1", startDate: "2026-05-05", endDate: "2026-05-10", phase: "outpatient" }
    ),
    rangeCase(
      "off strips services and writes off records",
      rangeBlock,
      rangeBase({
        inpatientAssignments: [{ id: "manual-ip", date: "2026-05-04", rotatorId: "r1", role: "Resident", source: "Manual" }],
        outpatientSessions: [{ id: "manual-op", date: "2026-05-05", period: "AM", clinic: "QRS", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" }],
      }),
      { rotatorId: "r1", startDate: "2026-05-04", endDate: "2026-05-05", phase: "off" }
    ),
    rangeCase(
      "clear removes services without additions",
      rangeBlock,
      rangeBase({
        inpatientAssignments: [{ id: "manual-ip", date: "2026-05-04", rotatorId: "r1", role: "Resident", source: "Manual" }],
        outpatientSessions: [{ id: "manual-op", date: "2026-05-05", period: "PM", clinic: "QRS", provider: "", rotatorId: "r1", status: "Scheduled", source: "Manual" }],
      }),
      { rotatorId: "r1", startDate: "2026-05-04", endDate: "2026-05-05", phase: "clear" }
    ),
    rangeCase(
      "clamps to block and skips unavailable day",
      rangeBlock,
      baseStateFor(rangeBlock, [{ ...rangeRotator, dayOff: ["Friday"] }]),
      { rotatorId: "r1", startDate: "2026-05-01", endDate: "2026-05-12", phase: "inpatient", role: "Team senior" }
    ),
  ],
};

const rangeOutPath = join(outDir, "range-assignment.json");
writeFileSync(rangeOutPath, JSON.stringify(rangeVectors, null, 2) + "\n");
console.log(`Wrote ${rangeVectors.cases.length} range assignment golden vectors to ${rangeOutPath}`);

function outpatientCase(name, state, input) {
  return { name, input: [state, input], output: scheduleOutpatientSession(state, input) };
}

const outpatientBlock = weekBlock();
const outpatientState = baseStateFor(outpatientBlock, [
  makeRotator("r1", "Drew Quinn", "Other", "PGY-2", fullWeekSeg),
]);
const outpatientVectors = {
  generatedFrom: "shared/scheduler/scheduler.js::scheduleOutpatientSession",
  cases: [
    outpatientCase(
      "writes default continuity session",
      outpatientState,
      { date: "2026-05-04", period: "AM", rotatorId: "r1" }
    ),
    outpatientCase(
      "dedupes same rotator period slot",
      {
        ...outpatientState,
        outpatientSessions: [
          { id: "out-2026-05-04-am-r1", date: "2026-05-04", period: "AM", clinic: "Old", provider: "", rotatorId: "r1", status: "Scheduled" },
        ],
      },
      { date: "2026-05-04", period: "AM", clinic: "QRS", provider: "Alder", rotatorId: "r1" }
    ),
    outpatientCase(
      "normalizes detail rows",
      outpatientState,
      {
        date: "2026-05-05",
        period: "PM",
        clinic: "Resident Clinic",
        provider: "Birch",
        rotatorId: "r1",
        details: [
          { clinicName: "  QRS   Clinic ", provider: " Alder ", task: " new patients ", note: " bring list " },
          { clinic: "   ", attending: "", task: "", notes: "" },
        ],
      }
    ),
  ],
};

const outpatientOutPath = join(outDir, "outpatient-session.json");
writeFileSync(outpatientOutPath, JSON.stringify(outpatientVectors, null, 2) + "\n");
console.log(`Wrote ${outpatientVectors.cases.length} outpatient session golden vectors to ${outpatientOutPath}`);

function reportCase(name, state, date) {
  return { name, input: [state, date], output: generateDailyReport(state, date) };
}

const reportBlock = weekBlock({
  name: "Report Week",
  coverage: {
    weekday: { ip: { count: 1 } },
    saturday: { ip: { count: 0 } },
    sunday: { ip: { count: 0 } },
  },
});
const reportRotators = [
  { ...makeRotator("r1", "Drew Quinn", "Other", "PGY-2", fullWeekSeg), continuityClinic: "Wednesday PM" },
  { ...makeRotator("r2", "Noah Patel", "Other", "PGY-3", fullWeekSeg), dayOff: ["Tuesday"] },
];
const reportState = baseStateFor(reportBlock, reportRotators, {
  inpatientAssignments: [
    { id: "in-manual-2026-05-04-r1", date: "2026-05-04", rotatorId: "r1", role: "Resident", source: "Manual" },
    { id: "in-manual-2026-05-05-r2", date: "2026-05-05", rotatorId: "r2", role: "Resident", source: "Manual" },
    { id: "in-manual-2026-05-06-r1", date: "2026-05-06", rotatorId: "r1", role: "Resident", source: "Manual" },
  ],
  outpatientSessions: [
    { id: "out-2026-05-04-am-r1", date: "2026-05-04", period: "AM", clinic: "QRS", provider: "Alder", rotatorId: "r1", status: "Scheduled" },
    { id: "out-2026-05-05-am-r2", date: "2026-05-05", period: "AM", clinic: "Continuity Clinic", provider: "Alder", rotatorId: "r2", status: "Scheduled" },
    { id: "out-2026-05-06-pm-r1", date: "2026-05-06", period: "PM", clinic: "Resident Clinic", provider: "Birch", rotatorId: "r1", status: "Scheduled" },
  ],
});
const reportVectors = {
  generatedFrom: "shared/scheduler/scheduler.js::generateDailyReport",
  cases: [
    reportCase("assigned day with double book", reportState, "2026-05-04"),
    reportCase("unavailable day", reportState, "2026-05-05"),
    reportCase("continuity conflict day", reportState, "2026-05-06"),
    reportCase("empty staffed weekday", reportState, "2026-05-08"),
  ],
};

const reportOutPath = join(outDir, "daily-report.json");
writeFileSync(reportOutPath, JSON.stringify(reportVectors, null, 2) + "\n");
console.log(`Wrote ${reportVectors.cases.length} daily report golden vectors to ${reportOutPath}`);
