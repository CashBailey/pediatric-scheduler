import { useMemo, useState } from "react";
import { FileDown, AlertTriangle, Image } from "lucide-react";

import { weekdayName } from "../../../shared/scheduler/scheduler.js";
import { buildOutpatientScheduleView } from "../../../shared/scheduler/outpatient-schedule-selectors.js";
import { buildPosterWeeks } from "../../../shared/scheduler/poster-weeks.js";
import { buildOutpatientPdf } from "../../pdfExport.js";
import { buildClinicPosterPdf } from "../../clinicPosterPdf.js";

import "./OutpatientSchedule.css";

// The Outpatient Schedule is the polished, READ-ONLY final output (plan §8):
// where every outpatient person goes, plus the warnings the user must resolve
// back on the Clinics/Planning Grid screens. No drag/drop, no mutation here.
export function OutpatientSchedule({ state, block, setNotice }) {
  const view = useMemo(
    () => (block ? buildOutpatientScheduleView(state, block) : null),
    [state, block]
  );
  const posterWeeks = useMemo(
    () => (block ? buildPosterWeeks(state, block) : []),
    [state, block]
  );
  const [posterWeek, setPosterWeek] = useState("all");

  if (!block) {
    return (
      <section className="panel full">
        <h2>Outpatient Schedule</h2>
        <p className="op-sched-empty">No active block selected — nothing to project.</p>
      </section>
    );
  }

  function safeBlockName() {
    return (block.name || "schedule").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  }
  function downloadPdf() {
    try {
      const blob = buildOutpatientPdf(state, block);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeBlockName()}-outpatient.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice?.("Outpatient schedule PDF downloaded.");
    } catch (err) {
      setNotice?.(`Could not build the outpatient PDF: ${err.message}`);
    }
  }
  function downloadPoster() {
    try {
      const opts = posterWeek === "all" ? {} : { weekIndex: Number(posterWeek) };
      const blob = buildClinicPosterPdf(state, block, opts);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const suffix = posterWeek === "all" ? "all-weeks" : `week-${posterWeek}`;
      anchor.download = `${safeBlockName()}-clinic-poster-${suffix}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice?.("Clinic poster PDF downloaded.");
    } catch (err) {
      setNotice?.(`Could not build the poster: ${err.message}`);
    }
  }

  const { byDateSession, byRotator, unassigned, uncovered, conflicts } = view;
  const hasWarnings = unassigned.length > 0 || uncovered.length > 0 || conflicts.length > 0;

  return (
    <section className="panel full op-sched">
      <div className="op-sched-header">
        <div>
          <h2>Outpatient Schedule</h2>
          <p className="op-sched-subtitle">
            Final outpatient destinations. Read-only — assign clinics on the Clinics page.
          </p>
        </div>
        <div className="op-sched-actions">
          <select
            className="op-sched-week-select"
            value={posterWeek}
            onChange={(e) => setPosterWeek(e.target.value)}
            title="Choose which week the poster covers."
            aria-label="Poster week"
          >
            <option value="all">All weeks</option>
            {posterWeeks.map((w) => (
              <option key={w.weekIndex} value={String(w.weekIndex)}>
                {w.label} ({w.startDate} – {w.endDate})
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            onClick={downloadPoster}
            title="Export the polished clinic poster (color-coded, one page per week)."
          >
            <Image size={18} /> Clinic poster
          </button>
          <button
            className="secondary-button"
            onClick={downloadPdf}
            title="Save the outpatient schedule as a PDF for distribution."
          >
            <FileDown size={18} /> Outpatient PDF
          </button>
        </div>
      </div>

      {/* Warnings */}
      {hasWarnings && (
        <div className="op-sched-warnings">
          <h3><AlertTriangle size={16} /> Needs attention</h3>
          {conflicts.length > 0 && (
            <ul className="op-sched-warn-list">
              {conflicts.map((c, i) => (
                <li key={`c-${i}`} className="op-sched-warn op-sched-warn-critical">
                  {c.type === "clinic-double-book" && `Double-booked clinic — ${c.date} ${c.session}`}
                  {c.type === "clinic-over-capacity" && `Over capacity (${c.assigned}/${c.capacity}) — ${c.date} ${c.session}`}
                  {c.type === "clinic-stale-occurrence" && `Assignment references a removed clinic — ${c.date} ${c.session}`}
                </li>
              ))}
            </ul>
          )}
          {uncovered.length > 0 && (
            <div className="op-sched-warn-group">
              <strong>Clinics with no rotator ({uncovered.length}):</strong>
              <ul className="op-sched-warn-list">
                {uncovered.map((o) => (
                  <li key={o.id} className="op-sched-warn op-sched-warn-amber">
                    {o.date} {o.session} — {o.attendingName} {o.clinicName ? `(${o.clinicName})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="op-sched-warn-group">
              <strong>Outpatient rotators not in a clinic:</strong>
              <ul className="op-sched-warn-list">
                {unassigned.map((d) => (
                  <li key={d.date} className="op-sched-warn op-sched-warn-amber">
                    {d.date} — {d.rotators.map((r) => r.name).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* By date / session / clinic */}
      <div className="op-sched-section">
        <h3>By date &amp; session</h3>
        {byDateSession.length === 0 ? (
          <p className="op-sched-empty">No clinic sessions in this block.</p>
        ) : (
          <div className="op-sched-days">
            {byDateSession.map((day) => (
              <div key={day.date} className="op-sched-day">
                <div className="op-sched-day-label">{weekdayName(day.date).slice(0, 3)} {day.date}</div>
                {["AM", "PM"].map((session) => (
                  <div key={session} className="op-sched-session">
                    <span className="op-sched-session-label">{session}</span>
                    <div className="op-sched-session-body">
                      {day[session].length === 0 ? (
                        <span className="op-sched-none">—</span>
                      ) : (
                        day[session].map((entry) => (
                          <div key={entry.occurrence.id} className="op-sched-occ">
                            <span className="op-sched-occ-clinic">
                              {entry.occurrence.attendingName}
                              {entry.occurrence.clinicName ? ` — ${entry.occurrence.clinicName}` : ""}
                            </span>
                            <span className="op-sched-occ-rotators">
                              {entry.rotators.length === 0
                                ? <em className="op-sched-uncovered">[uncovered]</em>
                                : entry.rotators.map((r) => r.name).join(", ")}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By rotator */}
      <div className="op-sched-section">
        <h3>By rotator</h3>
        {byRotator.length === 0 ? (
          <p className="op-sched-empty">No outpatient rotators in this block.</p>
        ) : (
          <div className="op-sched-rotators">
            {byRotator.map((r) => (
              <div key={r.rotatorId} className="op-sched-rotator">
                <div className="op-sched-rotator-name">
                  {r.name}
                  <span className="op-sched-rotator-meta">{r.serviceDayCount} OP day{r.serviceDayCount === 1 ? "" : "s"}</span>
                </div>
                {r.stops.length === 0 ? (
                  <span className="op-sched-rotator-none">outpatient — no clinic assigned</span>
                ) : (
                  <ul className="op-sched-stops">
                    {r.stops.map((s, i) => (
                      <li key={i} className={s.stale ? "op-sched-stop op-sched-stale" : "op-sched-stop"}>
                        {weekdayName(s.date).slice(0, 3)} {s.date} {s.session} → {s.attendingName}
                        {s.clinicName ? ` / ${s.clinicName}` : ""}
                        {s.stale ? " (removed clinic)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
