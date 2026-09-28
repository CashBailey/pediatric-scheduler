# Best Algorithm for Pediatric Neurology Scheduler

## Recommendation

**1. Executive Recommendation**

Use a layered hybrid architecture:

1. deterministic import, parsing, and normalization,
2. deterministic interval-overlap and eligibility computation,
3. rule-based assignment locks for source-program rules and manual overrides,
4. staged constraint optimization with **OR-Tools CP-SAT** for person-date-session state decisions and inpatient coverage,
5. a separate **clinic-slot assignment subproblem**, solved with **min-cost bipartite matching / min-cost flow** for the MVP when clinic rules are mostly session-local, and upgraded to a CP-SAT submodel when clinic rules become strongly cross-day or fairness-coupled,
6. a deterministic conflict checker and explanation layer,
7. a human-in-the-loop repair workflow with pinned assignments, minimal-disruption reoptimization, and versioned schedules. citeturn9view0turn9view1turn26view0turn23view0turn9view8turn9view9turn9view5turn34view1

The best primary solver for this application is **CP-SAT**, not because every staffing problem must use CP, but because this one is dominated by boolean logic, half-day incompatibilities, locks, optional assignments, non-contiguous date segments, cross-block continuity, and explainable feasibility checks. OR-Tools explicitly positions CP-SAT as the primary solver for constraint programming and scheduling examples, and Google’s CP-SAT-LP paper describes it as a state-of-the-art integral CP/SAT/LP hybrid with diverse workers, scheduling benchmark breakthroughs, and competitive performance against top MIP solvers on purely integral problems. citeturn9view1turn9view0turn26view0turn23view0

The best **backup** architecture is **MILP through OR-Tools MathOpt with Gurobi or HiGHS**, especially for future yearly planning, multi-objective block allocation, or when you want stronger MIP ecosystem features such as solver swapping, warm starts, and, with Gurobi, IIS-style infeasibility analysis. Gurobi’s workforce example is a multi-objective MIP model, and OR-Tools MathOpt explicitly supports CP-SAT, Gurobi, and HiGHS with incremental solving and warm starts. HiGHS is a strong open-source LP/MIP/QP option if commercial licensing is undesirable. citeturn9view6turn10view0turn40search0

**2. Problem Type and Formalization**

This is not one classical problem. It is a **hybrid** of:

- resident **rotation scheduling**,
- daily **physician/nurse rostering**,
- session-level **clinic assignment**,
- and **stepping-horizon repair scheduling**. citeturn29view1turn11view2turn11view5turn31view0

That classification is technically defensible. Resident scheduling literature separates **rotation scheduling** from **shift scheduling**. Lia et al. describe these as two different resident-training problems, with rotation scheduling solved first to assign residents to services/blocks, then shift scheduling solved afterward for daily schedules. They also note that there is no universally accepted rotation-scheduling formulation, and that the basic resident rotation problem is NP-hard. citeturn11view1turn29view1

The nurse rostering literature is also directly relevant because your pediatric neurology problem shares the classic rostering pattern of assigning people to work states over a horizon while respecting coverage, qualifications, preferences, and overlapping hard and soft constraints. The KU Leuven nurse rostering description and the ANROM benchmark model both emphasize coverage constraints, skill constraints, contracts, planning periods, and high-value soft constraints that are rarely all simultaneously satisfiable in practice. citeturn11view5turn22view0

The correct problem abstraction, therefore, is:

- a **deterministic preprocessing layer** that identifies who can be scheduled, when, and under which locks,
- followed by a **constraint optimization layer** for state assignment,
- followed by a **matching layer** for clinic placement,
- followed by an **audit and repair layer**. citeturn26view0turn12view1turn31view0turn23view0

**3. Why This Is Not a Simple Calendar Problem**

A simple calendar system assumes that availability, assignment, and display are the same concept. Your scheduler breaks that assumption in several ways.

First, the pediatric neurology **service block** is not identical to each rotator’s actual participation window. The literature on resident scheduling already distinguishes block-level rotation assignment from later daily scheduling. Your design adds one more layer: a selected service block must be intersected with many independent real date segments. That is a scheduling-and-eligibility problem, not a calendar rendering problem. citeturn29view1turn11view1

Second, this scheduler is **session-granular**. Morning and afternoon can differ. CP and rostering literature treat these as separate assignment units or shift units because overlap and feasibility are session-dependent, not just date-dependent. ANROM explicitly defines assignment units at the shift-by-day level, not merely by day. MiniZinc’s scheduling library likewise centers on non-overlap and optional tasks at the task level. citeturn22view0turn9view2

Third, the system must support **cross-horizon continuity**. The stepping-horizon nurse rostering paper shows that optimizing isolated monthly horizons can create bad long-term results and that constraints often cross horizon borders. That directly matches your Methodist rule, where a 28-day inpatient/outpatient split must not reset when a new pediatric neurology service block starts. citeturn31view0

Fourth, the schedule must remain **human-auditable and repairable**. Real-world scheduling systems often fail when they optimize too aggressively without allowing expert steering. Human-guided optimization research found that fully automatic systems can be rejected because users want to preserve control, apply tacit knowledge, and minimize disruption during fixes. Automated resident scheduling tools that reused structural rules improved quality and resident satisfaction, but they still worked because the rules were encoded explicitly and remained adjustable. citeturn37view0turn33view0turn33view1

**4. Algorithm Options Compared**

The practical conclusion from the literature and solver documentation is that no single generic method dominates this entire workflow. Different layers want different algorithms. That is why the recommendation is hybrid, not monolithic. citeturn12view1turn11view8turn26view0

| Approach | Strengths | Weaknesses | Best use here | Evidence |
|---|---|---|---|---|
| Greedy rules only | Very easy to implement, transparent, fast | Brittle under interacting constraints, poor at global trade-offs, hard to repair fairly | Preprocessing, default rule locking, fallback draft only | citeturn33view0turn28view2 |
| Bipartite matching | Excellent for one-session-to-one-slot assignment | Does not naturally model cross-day fairness, continuity, or rich logical rules | Simple outpatient clinic session assignment | citeturn9view9 |
| Min-cost flow | Elegant capacity-and-cost assignment on a network | Awkward once many coupled logical constraints span days and policy types | MVP outpatient slot placement after eligibility is fixed | citeturn9view8turn9view9 |
| MILP | Strong exact optimization, mature ecosystem, multi-objective support, warm starts | Logical and reified rules can become cumbersome; model size can grow quickly | Backup for high-level block planning and alternate exact formulation | citeturn9view6turn10view0turn40search0 |
| CP-SAT | Strong fit for boolean-heavy scheduling, optional assignments, reified logic, combinatorial feasibility | Integer-only modeling, less natural IIS tooling than commercial MIP | Primary assignment engine for this application | citeturn9view0turn17view1turn26view0turn23view0 |
| Local search / tabu / VNS | Strong for large practical rosters and iterative improvement | No hard optimality proof, hard-constraint handling requires care | Secondary repair or production-grade improvement layer | citeturn11view8turn37view0 |
| Genetic algorithms | Flexible search, can explore large spaces | Lower explainability, weaker guarantee structure, tuning burden | Not recommended for MVP | citeturn28view2 |
| Hybrid CP / exact / heuristic | Best empirical fit in real rostering literature | More engineering complexity | Best long-term production architecture | citeturn12view1turn12view2turn11view8 |
| LLM-only scheduling | Flexible text handling | No formal feasibility guarantee, no auditable proof of constraint satisfaction | Not acceptable as final scheduling engine | citeturn23view0turn37view1 |

**5. Recommended Hybrid Architecture**

The recommended architecture is:

- **Layer A: Import and Parse**  
  Use OCR-free structured extraction when possible, with LLM assistance only for messy text, emails, Word files, or copied notes. Every extracted fact should carry provenance, confidence, and raw-source span. Uncertain dates and ambiguous assignments should be marked for review, not silently accepted. This aligns with explainable, human-steered optimization practice rather than black-box automation. citeturn37view0turn37view1

- **Layer B: Normalize and Lock**  
  Convert every source into a common schema: rotator, segments, program, role, inferred track, clinic notes, continuity clinic, holidays, academic half-days, and manual locks. This layer is deterministic.

- **Layer C: Eligibility Engine**  
  Compute active dates and active sessions by intersecting actual rotation segments with the selected service block. This must be deterministic and should not depend on optimization.

- **Layer D: CP-SAT Assignment Engine**  
  Solve the high-value discrete decisions: whether each active rotator-session is inpatient, outpatient, continuity clinic, CME, academic half-day, off, or unavailable; ensure inpatient coverage; enforce source locks; assign team senior; preserve published locks; minimize disruption. CP-SAT is the best fit here. citeturn9view0turn17view1turn26view0

- **Layer E: Outpatient Slot Assignment**  
  For the MVP, once session-state decisions are fixed, solve clinic-slot placement as a min-cost assignment over outpatient-eligible session units. If clinic rules later become deeply coupled across the month, replace this stage with a clinic-specific CP-SAT submodel. citeturn9view8turn9view9turn12view1

- **Layer F: Deterministic Conflict Checker**  
  Validate every schedule cell against actual dates, locks, continuity clinic rules, student protections, legend integrity, missing coverage, and override policy. CP-SAT’s assumption mechanism is useful when diagnosing infeasibility, but the post-solve checker should still exist independently. citeturn23view0

- **Layer G: Human Review and Incremental Repair**  
  Accept user locks, pin assignments, and reoptimize only affected windows with a change-minimizing objective. Timefold and OptaPlanner style pinning explicitly support this concept, and OR-Tools supports hints and assumptions that are useful in replaying and diagnosing solutions. citeturn9view5turn34view1turn39view0turn23view0

## System Model

**6. Data Model**

A practical relational model is below. Even if you implement with document storage or event sourcing, these entities should still exist conceptually.

```text
ServiceBlock
- id
- name
- start_date
- end_date
- block_type               # 4-week, 5-week, custom
- timezone
- notes
- status                   # draft, published, archived

Program
- id
- code                     # METHODIST, UTA, PEDS, PSYCH, MEDSTUDENT
- name
- rule_profile_id

RuleProfile
- id
- name
- methodist_requires_28_day_split
- supports_partial_blocks
- default_assignment_strategy
- requires_manual_start_track
- preserve_predetermined_assignments

Rotator
- id
- display_name
- person_external_id
- program_id
- role                     # resident, student, fellow
- pgy_level
- seniority_rank
- can_be_team_senior
- source_artifact_id
- notes

RotationSegment
- id
- rotator_id
- start_date
- end_date
- source_assignment        # inpatient, outpatient, unknown
- predetermined_lock       # bool
- block_anchor_date        # for 28-day logic if needed
- start_track              # inpatient, outpatient, unknown
- notes

SessionConstraint
- id
- rotator_id
- date
- session                  # AM, PM, FULL
- type                     # continuity_clinic, cme, ahd, holiday, no_clinic, off, unavailable
- location
- note
- locked                   # bool

ClinicTemplate
- id
- provider_name
- clinic_name
- location
- session_type             # AM, PM
- default_capacity
- required_pgy_min
- seniority_preference
- specialty_tags

ClinicSession
- id
- service_block_id
- date
- session                  # AM or PM
- provider_name
- clinic_name
- location
- capacity
- mandatory                # bool
- no_clinic                # bool
- stay_tuned_allowed       # bool
- expected_patient_count
- note

AssignmentLock
- id
- service_block_id
- rotator_id
- date
- session
- lock_type                # source_lock, manual_lock, published_lock
- locked_state             # inpatient, outpatient, clinic_session_id, off, continuity, etc.
- reason
- created_by
- created_at

SessionStateAssignment
- id
- version_id
- rotator_id
- date
- session
- state                    # inpatient, outpatient, continuity, cme, ahd, off, unavailable
- source                   # solver, manual, imported
- locked                   # bool

ClinicAssignment
- id
- version_id
- clinic_session_id
- rotator_id
- role_in_clinic           # resident, med_student, fellow
- pulled_from_inpatient    # bool
- note

DayAssignment
- id
- version_id
- rotator_id
- date
- inpatient_on             # derived or stored
- inpatient_off            # derived or stored
- team_senior              # bool
- fellow_covered           # bool
- note

LegendEntry
- id
- version_id
- display_number
- rotator_id
- label_mode               # compact, full, both

Conflict
- id
- version_id
- severity                 # info, warning, error
- type
- rotator_id
- date
- session
- clinic_session_id
- message
- rule_code
- overrideable             # bool
- resolved                 # bool
- resolved_by
- resolved_at

ManualOverride
- id
- version_id
- target_type              # session_state, clinic_assignment, conflict
- target_id
- action                   # force, unassign, downgrade_constraint, accept_conflict
- reason
- applied_by
- applied_at

ImportArtifact
- id
- source_type              # xlsx, docx, pdf, email, pasted_text
- filename_or_subject
- raw_text
- checksum
- imported_at

ParsedFact
- id
- artifact_id
- fact_type                # name, date_range, clinic_note, assignment
- value_json
- confidence
- provenance_span

ScheduleVersion
- id
- service_block_id
- parent_version_id
- created_at
- created_by
- status                   # draft, review, published
- optimization_run_id
- published_at

OptimizationRun
- id
- version_id
- engine                   # cp-sat-stage1, mincost-stage2, repair
- parameters_json
- objective_value
- solve_status
- runtime_ms
- solver_log_ref
```

This model supports multiple date segments per rotator, half-day constraints, locked source assignments, separate inpatient and outpatient views, numbered legends, versioned schedules, and a full conflict audit trail. Those features are essential given the cross-block, cross-session, and repair-oriented nature of real workforce scheduling. citeturn22view0turn31view0turn9view5

**7. Hard Constraints**

By default, these are non-negotiable. If a user wants to violate one, that should become an explicit override with a recorded reason.

1. A rotator cannot be scheduled outside any active rotation segment.
2. A rotator cannot be assigned to more than one incompatible state in the same session.
3. Predetermined medical-student placement cannot be overwritten unless the user explicitly overrides it.
4. Continuity clinic, CME, academic half-day, holiday, and no-clinic session locks must be honored.
5. A holiday or no-clinic session cannot carry regular clinic assignments unless explicitly overridden.
6. Every clinic assignment must correspond to an active outpatient-eligible session or a permitted inpatient pull-out.
7. A rotator cannot appear inpatient and outpatient in the same session unless the record explicitly says clinic pull-out.
8. Every used legend number must map to exactly one rotator in that schedule version.
9. Duplicate legend numbers are forbidden.
10. A clinic session marked mandatory must either be staffed or explicitly marked unresolved / overridden according to policy.
11. If the program requires a team senior on a date, one eligible person must be designated or a hard slack / error must be recorded.
12. If fellow coverage is required on a date, the schedule must reflect it or record an actionable error.
13. Methodist 28-day continuity cannot reset at the pediatric neurology block boundary. The assignment logic must follow the actual 28-day Methodist block.
14. Locked published assignments must remain fixed during repair unless the user explicitly unlocks them.

For future expansion, residency-wide hour and rest constraints can also enter the hard layer. The ACGME common program requirements specify 80 hours per week averaged over four weeks, minimum time free between scheduled periods, and one day in seven free of clinical work and education. Those are not the core MVP here, but the model can represent them if needed later. citeturn21view0turn21view1turn21view2

**8. Soft Constraints and Objective Function**

A single weighted-sum objective is tempting, but nurse rostering research has criticized pure weighted sums because they hide trade-offs and force users to choose abstract weights across conflicting priorities. Multi-objective and lexicographic approaches are better aligned with real scheduling practice. Böðvarsdóttir et al. specifically argue that weighted sums are often inadequate for real nurse rostering and propose lexicographic goal programming with instance-specific thresholds. citeturn19view1

So the right design here is **hierarchical optimization**:

**Tier A: clinical feasibility and policy integrity**

- minimize unfilled inpatient coverage,
- minimize unfilled mandatory clinic slots,
- minimize missing team senior assignments,
- minimize illegal double assignments,
- minimize illegal continuity-clinic conflicts,
- minimize violations of locked state assignments.

**Tier B: preserve continuity and minimize disruption**

- minimize Methodist track deviations,
- minimize student-assignment changes,
- minimize unnecessary inpatient pull-outs,
- minimize changes from the latest published schedule,
- minimize the number of explicit overrides needed.

**Tier C: improve schedule quality**

- balance inpatient and outpatient workload,
- balance provider-clinic exposure,
- prefer senior residents for clinics that need more autonomy,
- prefer not to overuse the same residents for pull-outs,
- minimize unresolved “stay tuned” clinic cells,
- prefer continuity across adjacent days when clinically sensible.

A practical weighted objective inside those tiers can be:

```text
Tier A
100000 * uncovered_inpatient_days
100000 * uncovered_mandatory_clinic_slots
50000  * missing_team_senior_days
50000  * illegal_double_assignment_slacks
30000  * illegal_locked_session_violations

Tier B
10000  * methodist_track_deviation_days
10000  * predetermined_assignment_changes
5000   * continuity_clinic_conflicts
3000   * inpatient_pullout_count
1000   * changed_published_cells

Tier C
500    * workload_imbalance
300    * provider_exposure_imbalance
100    * unresolved_stay_tuned_cells
50     * manual_override_count
25     * low_preference_clinic_assignments
```

In implementation, solve this **lexicographically**, not as one flat sum. First optimize Tier A, then fix Tier A’s optimum, optimize Tier B, then fix Tiers A and B, optimize Tier C. This preserves explainability and prevents the system from “buying” a missing clinic by improving fairness elsewhere. The literature and commercial workforce examples both support multi-objective thinking in this space. citeturn19view1turn9view6

**9. Solver Design**

The cleanest solver decomposition is:

### Stage One
CP-SAT assigns each active rotator-session a **state** and enforces daily inpatient coverage.

### Stage Two
A clinic assignment solver maps outpatient-eligible session units to clinic slots.

For the MVP, Stage Two should be **min-cost matching / min-cost flow**, because after Stage One most clinic decisions become “assign one available rotator-session unit to one clinic slot with a cost.” Network flow is a natural fit for that structure. If future clinic rules strongly couple assignments across days, replace Stage Two with a second CP-SAT model. citeturn9view8turn9view9turn26view0

A workable formulation is:

Sets:

```text
R = rotators
D = dates in the selected service block
S = {AM, PM}
M = {INP, OUTP, OFF, CONT, CME, AHD, UNAV}
K = clinic slots, where each slot represents one needed seat in a clinic session
```

Parameters:

```text
active[r,d,s] ∈ {0,1}
locked_state[r,d,s,m] ∈ {0,1}
can_be_senior[r] ∈ {0,1}
required_inpatient[d] ∈ Z+
required_senior[d] ∈ {0,1}
clinic_slot_date[k], clinic_slot_session[k]
clinic_allowed[r,k] ∈ {0,1}
published_state[r,d,s,m] ∈ {0,1}
```

Decision variables:

```text
x[r,d,s,m] ∈ {0,1}   # session state
z[r,d] ∈ {0,1}       # resident counted as inpatient that day
q[r,d] ∈ {0,1}       # team senior on that day
y[r,k] ∈ {0,1}       # clinic slot assignment
p[r,k] ∈ {0,1}       # inpatient pull-out flag
u[k] ∈ {0,1}         # unfilled clinic slot
miss_ip[d] ∈ {0,1}   # uncovered inpatient day slack
miss_sen[d] ∈ {0,1}  # missing senior slack
chg[r,d,s] ∈ {0,1}   # changed from published schedule
```

Core constraints:

```text
For each active rotator-session:
Σ_m x[r,d,s,m] = active[r,d,s]

Locked states:
if locked_state[r,d,s,m] = 1, then x[r,d,s,m] = 1

Inpatient day derivation:
z[r,d] ≥ x[r,d,AM,INP]
z[r,d] ≥ x[r,d,PM,INP]

Daily inpatient coverage:
Σ_r z[r,d] + miss_ip[d] ≥ required_inpatient[d]

Team senior:
Σ_r q[r,d] + miss_sen[d] = required_senior[d]
q[r,d] ≤ z[r,d]
q[r,d] ≤ can_be_senior[r]

Clinic-slot coverage:
Σ_r y[r,k] + u[k] = 1  # if one seat per slot

Clinic assignment only when permitted:
y[r,k] ≤ clinic_allowed[r,k]
y[r,k] ≤ x[r,date(k),session(k),OUTP] + p[r,k]

No duplicate clinic assignment in same session:
For each r,d,s:
Σ_{k with date(k)=d and session(k)=s} y[r,k] ≤ 1

No outpatient clinic during locked continuity/CME/off/unavailable sessions:
If x[r,d,s,CONT] = 1 then Σ_{k on d,s} y[r,k] = 0
Likewise for CME, AHD, OFF, UNAV unless explicit override model is used

Disruption tracking:
chg[r,d,s] ≥ x[r,d,s,m] - published_state[r,d,s,m]   for relevant m
```

The important design choice is that **eligibility is not a decision variable**. It is a deterministic input. Optimization should choose among eligible options, not guess eligibility. That separation is one of the biggest differences between robust clinical scheduling software and brittle spreadsheet automation. citeturn23view0turn26view0turn31view0

## Core Algorithms

**10. Pseudocode**

The pseudocode below is intended to be directly implementable.

### Date overlap calculation

```python
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

@dataclass(frozen=True)
class DateRange:
    start: date
    end: date  # inclusive

def intersect_range(a: DateRange, b: DateRange) -> Optional[DateRange]:
    start = max(a.start, b.start)
    end = min(a.end, b.end)
    if start > end:
        return None
    return DateRange(start, end)

def daterange(r: DateRange) -> Iterable[date]:
    cur = r.start
    while cur <= r.end:
        yield cur
        cur += timedelta(days=1)
```

### Multiple-segment rotator eligibility

```python
@dataclass
class Rotator:
    id: str
    program_code: str
    segments: list[DateRange]
    predetermined_track: Optional[str] = None
    methodist_start_track: Optional[str] = None

def active_dates_in_service_block(rotator: Rotator, service_block: DateRange) -> list[DateRange]:
    active = []
    for seg in rotator.segments:
        overlap = intersect_range(seg, service_block)
        if overlap is not None:
            active.append(overlap)
    return active

def build_session_eligibility(rotator: Rotator, service_block: DateRange, session_constraints) -> dict:
    """
    Returns:
      eligibility[(date, session)] = {
         'active': bool,
         'locked_state': Optional[str],
         'inpatient_eligible': bool,
         'outpatient_eligible': bool
      }
    """
    eligibility = {}
    for block_seg in active_dates_in_service_block(rotator, service_block):
        for d in daterange(block_seg):
            for session in ("AM", "PM"):
                eligibility[(d, session)] = {
                    "active": True,
                    "locked_state": None,
                    "inpatient_eligible": True,
                    "outpatient_eligible": True,
                }

    for rule in session_constraints:
        key = (rule.date, "AM") if rule.session == "FULL" else (rule.date, rule.session)
        if key not in eligibility:
            continue
        if rule.type in {"continuity_clinic", "cme", "ahd", "off", "unavailable"}:
            eligibility[key]["locked_state"] = rule.type
            eligibility[key]["inpatient_eligible"] = False
            eligibility[key]["outpatient_eligible"] = False

    return eligibility
```

### Methodist 28-day rule with cross-block continuity

```python
def methodist_track_for_day(
    actual_rotation_start: date,
    actual_rotation_end: date,
    query_day: date,
    start_track: str,  # "INPATIENT" or "OUTPATIENT"
) -> str:
    total_days = (actual_rotation_end - actual_rotation_start).days + 1
    if total_days != 28:
        raise ValueError("Methodist rule requires a 28-day actual rotation block.")
    if query_day < actual_rotation_start or query_day > actual_rotation_end:
        raise ValueError("Day outside Methodist block.")
    if start_track not in {"INPATIENT", "OUTPATIENT"}:
        raise ValueError("Methodist start track must be explicit or derived from prior data.")

    day_index = (query_day - actual_rotation_start).days  # 0..27
    first_half = range(0, 14)
    if day_index in first_half:
        return start_track
    return "OUTPATIENT" if start_track == "INPATIENT" else "INPATIENT"

def methodist_track_map_for_service_block(rotator, service_block: DateRange) -> dict[date, str]:
    result = {}
    for seg in rotator.segments:
        overlap = intersect_range(seg, service_block)
        if overlap is None:
            continue
        for d in daterange(overlap):
            result[d] = methodist_track_for_day(
                actual_rotation_start=seg.start,
                actual_rotation_end=seg.end,
                query_day=d,
                start_track=rotator.methodist_start_track
            )
    return result
```

This rule intentionally anchors the split to the **actual Methodist block start date**, not the pediatric neurology service-block start date. That is how you prevent the May 20 to June 16 example from incorrectly resetting on June 1. The stepping-horizon literature strongly supports this kind of boundary-aware logic. citeturn31view0

### Predetermined assignment preservation

```python
def apply_source_locks(rotator: Rotator, eligibility: dict) -> None:
    # Predetermined full-track assignment, common for some medical students.
    if rotator.predetermined_track in {"INPATIENT", "OUTPATIENT"}:
        for key, cell in eligibility.items():
            if not cell["active"]:
                continue
            cell["locked_state"] = rotator.predetermined_track
            cell["inpatient_eligible"] = rotator.predetermined_track == "INPATIENT"
            cell["outpatient_eligible"] = rotator.predetermined_track == "OUTPATIENT"

    # Methodist block-anchored track assignment.
    if rotator.program_code == "METHODIST":
        # Here, the caller should compute service-block-specific day mapping from actual segments.
        pass
```

### Inpatient assignment generation

```python
def generate_inpatient_plan(data):
    """
    Stage 1 CP-SAT solve.
    Input contains:
      - eligibility matrix
      - locked states
      - coverage requirements
      - team senior rules
      - prior published schedule for disruption minimization
    Output:
      - session states
      - inpatient ON/OFF by day
      - team senior
      - unresolved coverage slacks if overconstrained mode is enabled
    """
    model = CpModel()

    x = {}       # x[r,d,s,m]
    z = {}       # z[r,d]
    q = {}       # q[r,d]
    miss_ip = {}
    miss_sen = {}

    # Build state variables only for active sessions.
    for r in data.rotators:
        for (d, s), cell in data.eligibility[r.id].items():
            if not cell["active"]:
                continue
            allowed_states = derive_allowed_states(cell)
            x[(r.id, d, s)] = {m: model.new_bool_var(f"x_{r.id}_{d}_{s}_{m}") for m in allowed_states}
            model.add_exactly_one(x[(r.id, d, s)][m] for m in allowed_states)

            if cell["locked_state"] is not None:
                lock_state(model, x[(r.id, d, s)], cell["locked_state"])

    # Daily inpatient count and team senior variables.
    for d in data.dates:
        miss_ip[d] = model.new_bool_var(f"miss_ip_{d}")
        miss_sen[d] = model.new_bool_var(f"miss_sen_{d}")

        for r in data.rotators:
            z[(r.id, d)] = model.new_bool_var(f"z_{r.id}_{d}")
            q[(r.id, d)] = model.new_bool_var(f"q_{r.id}_{d}")
            bind_daily_inpatient(model, x, z[(r.id, d)], r.id, d)
            model.add(q[(r.id, d)] <= z[(r.id, d)])
            if not r.can_be_team_senior:
                model.add(q[(r.id, d)] == 0)

        model.add(sum(z[(r.id, d)] for r in data.rotators_active_on(d)) + miss_ip[d] >= data.required_inpatient[d])
        if data.team_senior_required[d]:
            model.add(sum(q[(r.id, d)] for r in data.rotators_active_on(d)) + miss_sen[d] == 1)
        else:
            model.add(sum(q[(r.id, d)] for r in data.rotators_active_on(d)) == 0)

    add_disruption_objective(model, x, data.published_version)
    add_tiered_feasibility_objective(model, miss_ip, miss_sen)

    return solve_cp_sat(model)
```

### Outpatient clinic session assignment

```python
def generate_outpatient_plan(stage1_solution, clinic_slots, cost_fn):
    """
    MVP version: min-cost assignment.
    Left side nodes: rotator-session units that Stage 1 marked OUTPATIENT
                    or explicitly allowed as inpatient pull-out.
    Right side nodes: clinic slots.
    """
    graph = MinCostFlowGraph()

    source = graph.add_node()
    sink = graph.add_node()

    left_nodes = {}
    right_nodes = {}

    # Build supply nodes from outpatient-eligible session units.
    for unit in stage1_solution.outpatient_units():
        n = graph.add_node()
        left_nodes[unit.key] = n
        graph.add_arc(source, n, capacity=1, cost=0)

    # Build demand nodes for clinic slots.
    for slot in clinic_slots:
        n = graph.add_node()
        right_nodes[slot.id] = n
        graph.add_arc(n, sink, capacity=1, cost=0)

    # Feasible assignment edges.
    for unit in stage1_solution.outpatient_units():
        for slot in clinic_slots:
            if slot.date != unit.date or slot.session != unit.session:
                continue
            if not slot.is_assignable_to(unit.rotator):
                continue
            cost = cost_fn(unit, slot)
            graph.add_arc(left_nodes[unit.key], right_nodes[slot.id], capacity=1, cost=cost)

    result = solve_min_cost_max_flow(graph)
    return decode_assignments(result)
```

For the MVP, a cost function can incorporate PGY match, provider exposure balance, continuity preferences, clinic importance, and “do not overuse inpatient pull-outs.” This is exactly the kind of costed assignment structure that min-cost matching handles well. Once clinic fairness becomes more global, the same cost concepts can move into a second CP-SAT model. citeturn9view8turn9view9

### Conflict detection

```python
def detect_conflicts(version):
    conflicts = []

    for session_state in version.session_states:
        rotator = version.rotator_map[session_state.rotator_id]

        if not is_within_any_active_segment(rotator, session_state.date):
            conflicts.append(conflict("OUTSIDE_ACTUAL_DATES", session_state))

        if violates_locked_state(version, session_state):
            conflicts.append(conflict("LOCK_VIOLATION", session_state))

    for assignment in version.clinic_assignments:
        if not clinic_session_exists(version, assignment.clinic_session_id):
            conflicts.append(conflict("MISSING_CLINIC_SESSION", assignment))
            continue

        clinic = version.clinic_session_map[assignment.clinic_session_id]
        state = get_session_state(version, assignment.rotator_id, clinic.date, clinic.session)

        if state in {"OFF", "UNAVAILABLE", "CME", "AHD", "CONTINUITY_CLINIC"}:
            conflicts.append(conflict("ASSIGNED_WHILE_UNAVAILABLE", assignment))

        if state == "INPATIENT" and not assignment.pulled_from_inpatient:
            conflicts.append(conflict("INPATIENT_CLINIC_WITHOUT_PULL_NOTE", assignment))

    used_numbers = set()
    for entry in version.legend_entries:
        if entry.display_number in used_numbers:
            conflicts.append(conflict("DUPLICATE_LEGEND_NUMBER", entry))
        used_numbers.add(entry.display_number)

    for token in version.compact_calendar_tokens():
        if token.is_number and token.value not in used_numbers:
            conflicts.append(conflict("NUMBER_USED_NOT_IN_LEGEND", token))

    for clinic in version.clinic_sessions:
        if clinic.mandatory and clinic.assigned_count == 0 and not clinic.no_clinic and not clinic.stay_tuned_allowed:
            conflicts.append(conflict("UNFILLED_MANDATORY_CLINIC", clinic))

    return conflicts
```

### Incremental repair after manual override

```python
def incremental_repair(base_version, overrides):
    """
    Strategy:
      1. Clone current version.
      2. Convert overrides into hard locks.
      3. Determine affected dates and neighboring dates.
      4. Rebuild only the affected subproblem.
      5. Add previous solution as a hint.
      6. Reoptimize with a strong minimize-change objective.
      7. Re-run deterministic conflict checker.
    """
    new_version = clone_version(base_version)

    for ov in overrides:
        apply_override_as_lock(new_version, ov)

    affected_dates = compute_affected_window(overrides, pad_days=2)

    subproblem = build_subproblem(new_version, affected_dates)

    model, vars_ = build_stage1_cp_sat_model(subproblem)

    previous_solution = extract_previous_values(base_version, affected_dates)
    for var, value in previous_solution.items():
        model.add_hint(var, value)

    add_minimize_change_objective(model, base_version, affected_dates)
    stage1 = solve_cp_sat(model)

    clinic_assignments = generate_outpatient_plan(
        stage1_solution=stage1,
        clinic_slots=subproblem.clinic_slots,
        cost_fn=default_clinic_cost_fn,
    )

    merge_subproblem_solution(new_version, stage1, clinic_assignments)
    new_version.conflicts = detect_conflicts(new_version)

    return new_version
```

OR-Tools’ Python API explicitly provides `add_hint()` and assumption APIs, and the troubleshooting guide documents assumptions for infeasibility diagnosis. Timefold and OptaPlanner both document pinning for repeated planning, which conceptually matches the lock-and-repair workflow recommended here. citeturn39view0turn23view0turn9view5turn34view1

**11. Conflict Detection Engine**

The conflict engine should be deterministic, separate from the solver, and run both **before** and **after** optimization.

Before optimization, it should catch:

- impossible source data,
- overlapping date segments that violate program rules,
- Methodist blocks that are not 28 days,
- missing Methodist start-track information when it cannot be inferred,
- duplicate people or duplicate legend numbers,
- contradictory locks such as “holiday” and “mandatory clinic” on the same session.

After optimization, it should catch:

- assignments outside actual segments,
- inpatient plus clinic without pull note,
- continuity clinic conflict,
- OFF plus clinic,
- no-clinic day populated incorrectly,
- used legend number missing from legend,
- legend entry never used,
- unfilled mandatory clinic slot,
- missing inpatient coverage,
- missing team senior,
- missing fellow coverage,
- unauthorized change to published or manually locked cells.

When the model is infeasible, the debug mode should add assumption literals to candidate soft-hard rules and use CP-SAT’s infeasibility explanation support to report a small conflicting set of assumptions. OR-Tools documents this mechanism directly. citeturn23view0

**12. Human Override and Incremental Repair**

Human override is not an edge feature. It is a core design requirement.

Timefold and OptaPlanner both formalize **pinning** so the solver does not move assignments the user wants preserved. Timefold specifically describes pinned planning entities as a way to keep specific assignments fixed and schedule around them, while OptaPlanner documents `@PlanningPin` for the same purpose. Human-guided optimization research also shows that users need the ability to refine schedules, focus optimization on subsets, and minimize disruption during repairs. citeturn9view5turn34view1turn37view0

So the repair workflow should be:

1. User changes a cell.
2. The system records a `ManualOverride`.
3. The changed cell becomes a lock.
4. The schedule engine rebuilds only the affected date window, or the whole block in low-frequency mode.
5. The objective heavily penalizes changes from the published schedule.
6. The system returns:
   - new candidate schedule,
   - changed-cell summary,
   - residual conflicts,
   - explanation of why any desired change could not be fully respected.

A separate explanation layer is valuable here. The Schedule Explainer work shows that optimization-backed scheduling can be paired with actionable textual explanations and user modifications, rather than treating the solver as an opaque black box. citeturn37view1

## Delivery Plan

**13. MVP Algorithm**

A safe and implementable MVP is:

**Phase one**  
Build deterministic import and normalization:

- spreadsheet upload,
- pasted text parsing,
- structured manual entry,
- raw artifact storage,
- parsed fact review.

**Phase two**  
Implement the roster overlap engine:

- service block creation,
- rotator records,
- multiple segment support,
- legend generation,
- source-program rule profiles,
- Methodist block anchoring.

**Phase three**  
Implement deterministic conflict checking and review UI:

- outside actual dates,
- duplicate sessions,
- lock violations,
- holiday/no-clinic mismatches,
- legend errors.

**Phase four**  
Implement Stage One CP-SAT:

- person-date-session states,
- inpatient coverage,
- team senior,
- disruption minimization.

**Phase five**  
Implement Stage Two outpatient assignment:

- clinic slots,
- min-cost matching over outpatient-eligible session units,
- medical-student protections,
- clinic pull-outs.

**Phase six**  
Implement exports:

- master roster,
- inpatient calendar,
- outpatient calendar,
- daily team report,
- legend,
- conflict summary.

This MVP is enough to replace the dangerous part of the manual workflow while keeping the system explainable. Automated scheduling tools in resident settings have shown measurable improvements in conflicts, preference satisfaction, perceived fairness, and satisfaction when rules are encoded and reused explicitly. citeturn33view0turn33view1turn33view2

**14. Production-Grade Algorithm**

The production version should add:

- versioned schedules and audit history,
- better LLM-assisted parsing with confidence thresholds,
- full rolling or stepping-horizon repair,
- learned clinic-preference priors,
- stronger fairness metrics,
- block-level and annual planning integration,
- unsat-core style explanation workflows,
- alternate solver backend support via MathOpt,
- provider-facing explanation engine,
- calendar and email integrations,
- more robust overconstrained planning modes.

The literature strongly supports this evolution path. Real-world nurse rostering often ends up hybrid, stepping-horizon effects matter across month boundaries, and practical systems need repair mechanisms rather than one-shot optimization. citeturn11view8turn31view0turn22view0

**15. Test Cases**

Use the following acceptance tests.

**Test Case 1**  
Service block is May 4 to May 31. Methodist resident has May 4 to May 31 actual 28-day block.  
Expected: exactly 14 inpatient days and 14 outpatient days, anchored to the Methodist block, not reinterpreted as a generic monthly rota.

**Test Case 2**  
Methodist resident starts May 20 and ends June 16. Assigned outpatient May 20 to June 2 and inpatient June 3 to June 16.  
Expected: when generating the June service block, June 1 and June 2 remain outpatient. The system must not reset the 14/14 split at June 1.

**Test Case 3**  
Medical student predetermined outpatient May 18 to May 29.  
Expected: outpatient lock preserved; solver cannot move the student inpatient without explicit override.

**Test Case 4**  
Pediatrics resident has two segments: May 1 to May 7 and May 24 to May 31.  
Expected: both ranges appear in the eligibility matrix; May 8 to May 23 is inactive.

**Test Case 5**  
UT Adult Neurology resident present only May 12 to May 16.  
Expected: no assignment before May 12 or after May 16.

**Test Case 6**  
Rotator has Tuesday PM continuity clinic.  
Expected: Tuesday PM session locked; no other clinic or inpatient assignment in that session unless override / pull mechanism is explicitly allowed and recorded.

**Test Case 7**  
Holiday or no-clinic day.  
Expected: outpatient clinic slots remain empty or flagged “no clinic”; regular clinic placement is rejected unless explicitly overridden.

**Test Case 8**  
Resident marked inpatient ON and assigned to outpatient clinic PM.  
Expected: flagged unless PM clinic pull-out is documented and policy allows it.

**Test Case 9**  
Legend number appears in calendar but not in legend table.  
Expected: deterministic legend conflict.

**Test Case 10**  
Clinic session has no assigned rotator and is not marked no-clinic or stay-tuned.  
Expected: mandatory coverage warning or error, depending on clinic configuration.

## Engineering Plan

**16. Implementation Stack Recommendation**

Use:

- **Python 3.12+** for the backend and optimization workers,
- **FastAPI** for the API,
- **Pydantic** for schema validation,
- **PostgreSQL** for durable schedule/version/audit storage,
- **SQLAlchemy** or SQLModel for persistence,
- **OR-Tools CP-SAT** for Stage One,
- **OR-Tools min-cost flow** or a standard assignment implementation for Stage Two,
- **OR-Tools MathOpt** as the abstraction layer if you want CP-SAT today and MILP backends later,
- **React / Next.js** for the frontend,
- a background job queue for optimization runs and imports. citeturn9view0turn9view8turn10view0

The frontend should expose:

- master roster page,
- rotator detail editor,
- service block configuration page,
- inpatient editor,
- outpatient editor,
- conflict review page,
- version history / publish page.

LLM parsing should live in an ingestion service, never in the final validation path. The parser may propose facts, but only normalized, schema-valid, date-valid facts should become solver inputs.

Manual overrides should be stored as first-class records, not ad hoc edits. Re-runs should never overwrite human edits silently. Instead:

1. clone prior version,
2. apply overrides as locks,
3. use prior version as hints,
4. reoptimize affected windows,
5. compare and publish only after review. citeturn39view0turn23view0turn9view5

**17. Risks and Mitigations**

| Risk | Why it matters | Mitigation |
|---|---|---|
| Bad source data | GIGO applies brutally in scheduling | store raw artifacts, parsed facts, confidence, and review queues |
| Missing Methodist start-track | 28-day split becomes ambiguous | require explicit `start_track` or derive from prior published schedule; otherwise block publish |
| Overfitting to one month’s spreadsheet | rules drift and brittle logic accumulates | encode rule profiles and version them; keep rules data-driven |
| Silent LLM hallucination | unsafe in a clinical schedule | LLM only proposes facts; deterministic validator decides acceptance |
| Solver infeasibility | common in real staffing | overconstrained mode with explicit slacks, assumptions for diagnosis, publish blockers for unresolved hard errors citeturn23view0 |
| Excessive schedule churn after repair | users lose trust | strong minimize-change objective, publish locks, date-window repair only |
| Poor explainability | chief residents and coordinators will reject black-box outputs | conflict summaries, “why not” explanations, explicit locks, version diffs, explanation layer citeturn37view0turn37view1 |
| Cross-block fairness drift | short-horizon optimization can create long-term problems | stepping-horizon aware inputs, carry-forward metrics, continuity-aware Methodist logic citeturn31view0 |
| Future regulatory expansion | duty-hour rules may become required | data model already supports rest, hours, and weekly aggregation; add later as hard constraints if needed citeturn21view0turn21view1turn21view2 |

**18. Final Developer Blueprint**

Use the following architecture.

```text
Raw inputs
  -> import artifacts storage
  -> parser / extractor
  -> parsed facts with confidence
  -> normalization and rule-profile application
  -> master rotator roster
  -> service-block overlap engine
  -> session eligibility matrix
  -> source locks + manual locks + published locks
  -> Stage 1 CP-SAT
       - session states
       - inpatient coverage
       - team senior
       - disruption minimization
  -> Stage 2 clinic assignment
       - min-cost matching / flow for MVP
       - CP-SAT clinic submodel later if needed
  -> deterministic conflict checker
  -> review UI
  -> manual overrides / pinning
  -> incremental repair
  -> exports
       - master roster
       - inpatient calendar
       - outpatient calendar
       - daily team report
       - legend
       - conflict report
```

If you build only one thing first, build the **deterministic overlap, lock, and conflict engine**. That gives immediate value and de-risks the optimization layer. Then add CP-SAT for high-level states. Then add clinic assignment. That order is the shortest path to something clinically useful, explainable, and incrementally deployable. citeturn33view0turn9view0turn26view0

**Open questions / limitations**

Two domain details remain essential to finalize before coding the full solver:

1. Whether Methodist residents always have a known first-half track, or whether the first 14-day half sometimes has to be manually identified.
2. Whether outpatient clinic assignment has provider-specific seniority, educational, or continuity rules that must hold across the whole block and not just within one session.

If those rules are simple, the clinic layer can remain min-cost matching for a long time. If they are rich and monthly, move the clinic layer to CP-SAT.

## Sources

**19. Sources**

Key sources used for the recommendation:

- Google OR-Tools, **CP-SAT Solver**. Official documentation on CP-SAT as the primary CP solver, integer-only modeling, statuses, and scheduling fit. citeturn9view0turn9view1
- Perron, Didier, Gay, **The CP-SAT-LP Solver**. CP 2023 invited talk describing CP-SAT-LP as a hybrid CP/SAT/LP solver with portfolio workers and strong scheduling performance. citeturn26view0
- Google OR-Tools, **Employee Scheduling** and **Minimum Cost Flows**. Official examples supporting CP-SAT for workforce scheduling and flow/assignment for costed slot matching. citeturn17view1turn9view8turn9view9
- Google OR-Tools, **MathOpt**. Official documentation that supports solver swapping, incremental solving, warm starts, callbacks, and Gurobi/HiGHS backends. citeturn10view0
- Gurobi, **Workforce Scheduling Problem** modeling example. Official multi-objective MIP example relevant to backup MILP architecture. citeturn9view6
- HiGHS, official site. Open-source LP/MIP/QP solver suitable as a noncommercial MILP backend. citeturn40search0
- MiniZinc, official language site and scheduling globals. Evidence for high-level CP modeling and optional-task/non-overlap scheduling primitives. citeturn9view2turn9view3
- Timefold documentation and OptaPlanner docs, on **pinned planning entities** and repeated planning / change response. Relevant to override locking and incremental repair. citeturn9view5turn14view2turn34view0turn34view1
- Li et al., **Equity-promoting Integer Programming Approaches for Medical Resident Rotation Scheduling**. Strong source on resident rotation scheduling, its distinction from shift scheduling, implementability of IP, and the lack of one universally accepted formulation. citeturn11view1turn29view1
- Topaloglu and Ozkarahan, **A constraint programming-based solution approach for medical resident scheduling problems**. Hybrid column-generation / CP approach using real hospital data for resident scheduling. citeturn11view2
- KU Leuven / Gent benchmark material on **the nurse rostering problem** and **ANROM**. Strong reference for coverage, skills, contracts, assignment units, planning horizons, freezing part of rosters, and practical complexity. citeturn11view5turn22view0
- Salassa and Vanden Berghe, **A stepping horizon view on nurse rostering**. Direct support for boundary-aware monthly scheduling and the harm of isolated-horizon optimization. citeturn31view0
- He and Qu, **A constraint programming based column generation approach to nurse rostering problems**. Strong hybrid exact-CP evidence for highly constrained real-world rostering. citeturn12view1
- Qu et al., **Hybrid CP approach for nurse rostering** benchmark results. Evidence that hybrid CP plus metaheuristics can outperform more naive approaches on real-world benchmarks. citeturn12view2
- Klyve et al. / SINTEF case-study summary, **A hybrid approach for solving real-world nurse rostering problems**. Evidence that practical hospital rostering often lands on hybrid exact-plus-local-search architectures. citeturn11view8
- Böðvarsdóttir et al., **Achieving compromise solutions in nurse rostering**. Strong evidence against relying only on weighted-sum objectives and for lexicographic / prioritized multi-objective thinking. citeturn19view1
- Howard et al., **Implementation of an automated scheduling tool improves schedule quality and resident satisfaction**. Empirical support that explicit automated scheduling can improve conflicts, preference satisfaction, fairness, and satisfaction in residency settings. citeturn33view0turn33view1turn33view2
- OR-Tools troubleshooting and Python API documentation, on **assumptions**, **infeasibility explanation**, and **solution hints**. Relevant for repair workflows and unsat diagnosis. citeturn23view0turn39view0
- ACGME **Common Program Requirements**. Relevant future hard constraints if residency-hour policies are added later. citeturn21view0turn21view1turn21view2