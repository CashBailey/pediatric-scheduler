import { useMemo, useState } from "react";
import {
  DragDropProvider,
  useDraggable,
  useDroppable,
  useDragOperation
} from "@dnd-kit/react";
import {
  expandClinicOccurrences,
  getClinicAssignments,
  eligibleOutpatientRotatorsForDate
} from "../../../shared/scheduler/clinic-selectors.js";
import {
  validateClinicAssignment,
  assignClinic,
  unassignClinic
} from "../../../shared/scheduler/clinic-validation.js";
import { weekdayName, dateRange, getRotator } from "../../../shared/scheduler/scheduler.js";
import "./ClinicsView.css";

const DRAG_PREFIX = "clinic-rotator::";

// --- date helpers (UTC, mirroring shared/scheduler dateRange's parsing) ---
function pad(x) {
  return String(x).padStart(2, "0");
}
function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function shiftDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  cur.setUTCDate(cur.getUTCDate() + n);
  return toISO(cur);
}
// Monday of the ISO week containing `iso`.
function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  const dow = cur.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  cur.setUTCDate(cur.getUTCDate() + delta);
  return toISO(cur);
}

// Build the visible 10-weekday window (Mon–Fri × 2) starting at `windowStart`.
function buildWeekdays(windowStart) {
  // 14 consecutive calendar days, weekends filtered out.
  const all = dateRange(windowStart, shiftDays(windowStart, 13));
  return all.filter((d) => {
    const wd = weekdayName(d);
    return wd !== "Saturday" && wd !== "Sunday";
  });
}

const SESSIONS = ["AM", "PM"];

function rotatorLabel(rotator) {
  return rotator?.displayName ?? rotator?.fullName ?? rotator?.id ?? "Rotator";
}

export function ClinicsView({ state, block, updateState, setNotice }) {
  const blockStart = block?.startDate ?? null;
  const [windowStart, setWindowStart] = useState(() =>
    blockStart ? mondayOf(blockStart) : null
  );

  // Re-anchor when the block changes underneath us (e.g. block switch).
  const anchoredStart = windowStart ?? (blockStart ? mondayOf(blockStart) : null);

  const weekdays = useMemo(
    () => (anchoredStart ? buildWeekdays(anchoredStart) : []),
    [anchoredStart]
  );

  const windowEnd = weekdays.length ? weekdays[weekdays.length - 1] : null;

  const occurrences = useMemo(() => {
    if (!state || !anchoredStart || !windowEnd) return [];
    return expandClinicOccurrences(state, { startDate: anchoredStart, endDate: windowEnd });
  }, [state, anchoredStart, windowEnd]);

  const assignments = useMemo(() => {
    if (!state || !anchoredStart || !windowEnd) return [];
    return getClinicAssignments(state, { startDate: anchoredStart, endDate: windowEnd });
  }, [state, anchoredStart, windowEnd]);

  // (date, session) -> occurrences[]
  const occByCell = useMemo(() => {
    const map = new Map();
    for (const occ of occurrences) {
      const key = `${occ.date}|${occ.session}`;
      const list = map.get(key) || [];
      list.push(occ);
      map.set(key, list);
    }
    return map;
  }, [occurrences]);

  // occurrenceId -> assignments[]
  const assignByOcc = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      const list = map.get(a.clinicOccurrenceId) || [];
      list.push(a);
      map.set(a.clinicOccurrenceId, list);
    }
    return map;
  }, [assignments]);

  // date -> eligible outpatient rotators[]
  const eligibleByDate = useMemo(() => {
    const map = new Map();
    if (!state) return map;
    for (const d of weekdays) {
      map.set(d, eligibleOutpatientRotatorsForDate(state, d));
    }
    return map;
  }, [state, weekdays]);

  const [focusedDate, setFocusedDate] = useState(null);
  const activeDate = focusedDate && weekdays.includes(focusedDate)
    ? focusedDate
    : weekdays[0] ?? null;

  function handleDragEnd(event) {
    // Mirror App.jsx handleDragEnd guard: a refused/off-grid drop has no target.
    if (event.canceled || !event.operation?.target) return;
    const source = event.operation.source;
    const target = event.operation.target;
    const rotatorId = source?.data?.rotatorId
      ?? (typeof source?.id === "string" && source.id.startsWith(DRAG_PREFIX)
        ? source.id.slice(DRAG_PREFIX.length)
        : null);
    if (!rotatorId) return;
    const data = target.data || {};
    const clinicOccurrenceId = data.clinicOccurrenceId ?? (typeof target.id === "string" ? target.id : null);
    const { date, session } = data;
    if (!clinicOccurrenceId || !date || !session) return;

    // assignClinic re-validates internally; trust its verdict.
    const r = assignClinic(state, { clinicOccurrenceId, rotatorId, date, session });
    if (!r.ok) {
      setNotice(r.message || "That clinic assignment isn't allowed.");
      return;
    }
    const rotator = getRotator(state, rotatorId);
    const occName = occByCell.get(`${date}|${session}`)?.find((o) => o.id === clinicOccurrenceId);
    updateState(
      r.state,
      `Assigned ${rotatorLabel(rotator)} → ${occName?.clinicName || occName?.attendingName || "clinic"} (${date} ${session}).`
    );
  }

  function handleRemove(assignment) {
    const next = unassignClinic(state, {
      clinicOccurrenceId: assignment.clinicOccurrenceId,
      rotatorId: assignment.rotatorId
    });
    if (next === state) return;
    const rotator = getRotator(state, assignment.rotatorId);
    updateState(next, `Removed ${rotatorLabel(rotator)} from clinic (${assignment.date} ${assignment.session}).`);
  }

  // --- QA: unassigned outpatient rotators (per active date) ---
  const assignedRotatorIdsByDate = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      const set = map.get(a.date) || new Set();
      set.add(a.rotatorId);
      map.set(a.date, set);
    }
    return map;
  }, [assignments]);

  const uncoveredOccurrences = useMemo(
    () => occurrences.filter((o) => (assignByOcc.get(o.id) || []).length === 0),
    [occurrences, assignByOcc]
  );

  if (!block || !blockStart) {
    return (
      <section className="panel full clinics-view">
        <h2 className="clinics-title">Clinics</h2>
        <p className="clinics-empty">No block selected — pick a block to schedule clinic sessions.</p>
      </section>
    );
  }

  if (occurrences.length === 0) {
    return (
      <section className="panel full clinics-view">
        <ClinicsHeader
          windowStart={anchoredStart}
          windowEnd={windowEnd}
          onShift={(n) => setWindowStart(shiftDays(anchoredStart, n))}
          onReset={() => setWindowStart(mondayOf(blockStart))}
        />
        <p className="clinics-empty">
          No clinic sessions in this two-week window. Recurring or one-off attending clinics will
          appear here once configured.
        </p>
      </section>
    );
  }

  // Split the 10 weekdays into two week-rows of up to 5.
  const week1 = weekdays.slice(0, 5);
  const week2 = weekdays.slice(5, 10);

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      <section className="panel full clinics-view">
        <ClinicsHeader
          windowStart={anchoredStart}
          windowEnd={windowEnd}
          onShift={(n) => setWindowStart(shiftDays(anchoredStart, n))}
          onReset={() => setWindowStart(mondayOf(blockStart))}
        />

        <div className="clinics-grid">
          {[week1, week2].map((week, wi) => (
            <div className="clinics-weekrow" key={wi}>
              {week.map((date) => (
                <DayColumn
                  key={date}
                  date={date}
                  isActive={date === activeDate}
                  onFocus={() => setFocusedDate(date)}
                  occByCell={occByCell}
                  assignByOcc={assignByOcc}
                  state={state}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="clinics-trays">
          <EligibleTray
            date={activeDate}
            rotators={activeDate ? eligibleByDate.get(activeDate) || [] : []}
          />

          <div className="panel clinics-qa">
            <h3 className="clinics-qa-title">Unassigned outpatient rotators</h3>
            <p className="clinics-qa-sub">{activeDate ? `for ${activeDate}` : ""}</p>
            <UnassignedList
              date={activeDate}
              eligible={activeDate ? eligibleByDate.get(activeDate) || [] : []}
              assignedSet={activeDate ? assignedRotatorIdsByDate.get(activeDate) : null}
            />
          </div>

          <div className="panel clinics-qa">
            <h3 className="clinics-qa-title">Uncovered clinics</h3>
            <p className="clinics-qa-sub">in this two-week window</p>
            {uncoveredOccurrences.length === 0 ? (
              <p className="clinics-qa-empty">All clinic sessions have at least one rotator.</p>
            ) : (
              <ul className="clinics-qa-list">
                {uncoveredOccurrences.map((o) => (
                  <li key={o.id} className="clinics-qa-item">
                    <span className="clinics-qa-when">{o.date} {o.session}</span>{" "}
                    {o.attendingName} — {o.clinicName || "clinic"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </DragDropProvider>
  );
}

function ClinicsHeader({ windowStart, windowEnd, onShift, onReset }) {
  return (
    <div className="clinics-header">
      <h2 className="clinics-title">Clinics</h2>
      <div className="clinics-window">
        <button type="button" className="clinics-nav" onClick={() => onShift(-7)} title="Previous week">
          ◀ Prev
        </button>
        <span className="clinics-window-label">
          {windowStart} → {windowEnd}
        </span>
        <button type="button" className="clinics-nav" onClick={() => onShift(7)} title="Next week">
          Next ▶
        </button>
        <button type="button" className="clinics-nav clinics-nav-reset" onClick={onReset} title="Back to block start">
          Reset
        </button>
      </div>
    </div>
  );
}

function DayColumn({ date, isActive, onFocus, occByCell, assignByOcc, state, onRemove }) {
  return (
    <div
      className={`clinics-day${isActive ? " is-active" : ""}`}
      onClick={onFocus}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onFocus();
      }}
    >
      <div className="clinics-day-head">
        <span className="clinics-day-wd">{weekdayName(date)}</span>
        <span className="clinics-day-date">{date}</span>
      </div>
      {SESSIONS.map((session) => (
        <div className="clinics-session" key={session}>
          <div className="clinics-session-label">{session}</div>
          {(occByCell.get(`${date}|${session}`) || []).length === 0 ? (
            <div className="clinics-session-empty">—</div>
          ) : (
            (occByCell.get(`${date}|${session}`) || []).map((occ) => (
              <SessionBox
                key={occ.id}
                occ={occ}
                date={date}
                session={session}
                assignments={assignByOcc.get(occ.id) || []}
                state={state}
                onRemove={onRemove}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function SessionBox({ occ, date, session, assignments, state, onRemove }) {
  // Mirror PlanningCell: read the active drag, compute validity synchronously,
  // and disable the droppable when the drop would be invalid. A disabled
  // droppable is what makes @dnd-kit refuse the drop (chess-style).
  const { source: activeSource } = useDragOperation();
  const activeRotatorId =
    activeSource?.data?.rotatorId ??
    (typeof activeSource?.id === "string" && activeSource.id.startsWith(DRAG_PREFIX)
      ? activeSource.id.slice(DRAG_PREFIX.length)
      : null);
  const dragActive = activeRotatorId != null;
  const verdict = dragActive && state
    ? validateClinicAssignment(state, {
        clinicOccurrenceId: occ.id,
        rotatorId: activeRotatorId,
        date,
        session
      })
    : { ok: true };
  const dropDisabled = dragActive && !verdict.ok;

  const { ref, isDropTarget } = useDroppable({
    id: occ.id, // occurrence ids are globally unique — safe as the drop id
    disabled: dropDisabled,
    data: { clinicOccurrenceId: occ.id, date, session }
  });

  const capLabel = occ.capacity == null ? "unlimited" : `${assignments.length}/${occ.capacity}`;
  const cls = [
    "clinics-box",
    dragActive && verdict.ok ? "clinics-box-droppable" : "",
    dragActive && !verdict.ok ? "clinics-box-invalid" : "",
    isDropTarget ? "clinics-box-active" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      title={dragActive && !verdict.ok ? verdict.message : undefined}
    >
      <div className="clinics-box-head">
        <span className="clinics-box-attending">{occ.attendingName}</span>
        <span className="clinics-box-clinic">{occ.clinicName || "clinic"}</span>
      </div>
      <div className="clinics-box-meta">
        {occ.location ? <span className="clinics-box-loc">{occ.location}</span> : null}
        <span className="clinics-box-cap">{capLabel}</span>
      </div>
      <div className="clinics-box-chips">
        {assignments.length === 0 ? (
          <span className="clinics-box-empty">no rotators</span>
        ) : (
          assignments.map((a) => {
            const rotator = getRotator(state, a.rotatorId);
            const isLegacy = a.source === "legacy";
            return (
              <span key={a.id || `${a.clinicOccurrenceId}|${a.rotatorId}`} className="clinics-chip">
                {rotatorLabel(rotator)}
                {isLegacy ? (
                  <span className="clinics-chip-legacy" title="Read-only (legacy session)">·</span>
                ) : (
                  <button
                    type="button"
                    className="clinics-chip-remove"
                    onClick={() => onRemove(a)}
                    title="Remove from clinic"
                    aria-label={`Remove ${rotatorLabel(rotator)}`}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function EligibleTray({ date, rotators }) {
  return (
    <div className="panel clinics-tray">
      <h3 className="clinics-tray-title">Eligible outpatient rotators</h3>
      <p className="clinics-tray-sub">{date ? `for ${date} — drag into a clinic` : "Select a day"}</p>
      {rotators.length === 0 ? (
        <p className="clinics-tray-empty">No strictly-outpatient rotators that day.</p>
      ) : (
        <div className="clinics-tray-list">
          {rotators.map((r) => (
            <DraggableRotator key={r.id} rotator={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableRotator({ rotator }) {
  const { ref, isDragging } = useDraggable({
    id: `${DRAG_PREFIX}${rotator.id}`,
    data: { rotatorId: rotator.id }
  });
  return (
    <div
      ref={ref}
      className={`clinics-source${isDragging ? " is-dragging" : ""}`}
      title={`${rotator.program ?? ""} ${rotator.level ?? ""} — drag into a clinic`.trim()}
    >
      {rotatorLabel(rotator)}
    </div>
  );
}

function UnassignedList({ date, eligible, assignedSet }) {
  if (!date) return <p className="clinics-qa-empty">Select a day.</p>;
  const unassigned = eligible.filter((r) => !assignedSet || !assignedSet.has(r.id));
  if (unassigned.length === 0) {
    return <p className="clinics-qa-empty">Every outpatient rotator has a clinic that day.</p>;
  }
  return (
    <ul className="clinics-qa-list">
      {unassigned.map((r) => (
        <li key={r.id} className="clinics-qa-item">
          {rotatorLabel(r)}
        </li>
      ))}
    </ul>
  );
}
