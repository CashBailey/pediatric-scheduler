import { useMemo } from "react";
import { FileDown, Image } from "lucide-react";

import { serviceTypeForRotatorDate } from "../../../shared/scheduler/service-assignments.js";
import { inpatientHeatmapTone, HEATMAP_TONE_LABELS } from "../../../shared/scheduler/heatmap.js";
import { dateRange, weekdayName, getRotator } from "../../../shared/scheduler/scheduler.js";
import { inpatientDayData } from "../../../shared/scheduler/derived-views.js";
import { buildInpatientPdf } from "../../pdfExport.js";
import { buildInpatientPosterPdf } from "../../clinicPosterPdf.js";

import "./InpatientSchedule.css";

// indexConflictsByDate lives in App.jsx (not exported from shared), so we
// inline the same trivial reducer here to keep this component self-contained.
function indexConflictsByDate(conflicts) {
  if (!Array.isArray(conflicts)) return {};
  const index = {};
  for (const c of conflicts) {
    if (!c || !c.date) continue;
    (index[c.date] = index[c.date] || []).push(c);
  }
  return index;
}

// A rotator is physically on inpatient that day when its service type is
// 'inpatient' OR 'both' (double-booked rotators ARE on inpatient — this
// matches the Planning Grid footer / heatmap.js B2 note).
function isOnInpatient(serviceType) {
  return serviceType === "inpatient" || serviceType === "both";
}

function shortDate(dateStr) {
  // "2026-05-04" -> "5/4"
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * Read-only Inpatient Schedule (plan §7) — a pure projection of the Planning
 * Grid service data. No writes/mutations.
 */
export function InpatientSchedule({ state, block, conflicts, setNotice }) {
  const conflictsByDate = useMemo(() => indexConflictsByDate(conflicts), [conflicts]);

  // Compute the full date × rotator inpatient matrix ONCE and feed all three
  // sections from it: heatmap counts, timeline rows, and (indirectly) the
  // daily roster headers.
  const model = useMemo(() => {
    if (!block || !block.startDate || !block.endDate) return null;
    const rotators = Array.isArray(state?.rotators) ? state.rotators : [];
    const dates = dateRange(block.startDate, block.endDate);

    // dayCounts[date] = number of rotators on inpatient that day.
    // rotatorDays[rotatorId] = Set of dates that rotator is on inpatient.
    const dayCounts = {};
    const rotatorDays = new Map();
    for (const date of dates) dayCounts[date] = 0;

    for (const rotator of rotators) {
      for (const date of dates) {
        const svc = serviceTypeForRotatorDate(state, rotator.id, date);
        if (!isOnInpatient(svc)) continue;
        dayCounts[date] += 1;
        if (!rotatorDays.has(rotator.id)) rotatorDays.set(rotator.id, new Set());
        rotatorDays.get(rotator.id).add(date);
      }
    }

    // Timeline rows: only rotators with ≥1 inpatient day in the block.
    const timelineRows = [];
    for (const [rotatorId, daySet] of rotatorDays.entries()) {
      const rotator = getRotator(state, rotatorId);
      if (!rotator) continue;
      timelineRows.push({ rotator, days: daySet });
    }
    timelineRows.sort((a, b) =>
      String(a.rotator.fullName || "").localeCompare(String(b.rotator.fullName || ""))
    );

    return { dates, dayCounts, timelineRows };
  }, [state, block]);

  function safeBlockName() {
    return (block?.name || "schedule").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  }

  // Mirror PlanningPdfToolbar.savePdfBlob exactly: buildInpatientPdf returns a
  // Blob, so we object-URL + anchor-download (NOT doc.save).
  function downloadPdf() {
    const blob = buildInpatientPdf(state, block);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeBlockName()}-inpatient.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    if (setNotice) setNotice("Inpatient schedule PDF saved to your Downloads folder.");
  }

  function downloadPoster() {
    try {
      const blob = buildInpatientPosterPdf(state, block);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeBlockName()}-inpatient-poster.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      if (setNotice) setNotice("Inpatient poster PDF downloaded.");
    } catch (err) {
      if (setNotice) setNotice(`Could not build the inpatient poster: ${err.message}`);
    }
  }

  if (!model) {
    return (
      <section className="panel full">
        <h2>Inpatient Schedule</h2>
        <p className="ip-sched-empty">No active block selected — nothing to project.</p>
      </section>
    );
  }

  const { dates, dayCounts, timelineRows } = model;

  if (timelineRows.length === 0) {
    return (
      <section className="panel full">
        <div className="ip-sched-header">
          <h2>Inpatient Schedule</h2>
          <button className="secondary-button" onClick={downloadPdf} title="Save the inpatient calendar as its own PDF for distribution.">
            <FileDown size={18} />
            Download inpatient PDF
          </button>
        </div>
        <p className="ip-sched-empty">No rotators are assigned to inpatient in this block.</p>
      </section>
    );
  }

  const toneTokens = ["critical", "below", "full", "surplus"];

  return (
    <section className="panel full ip-sched">
      <div className="ip-sched-header">
        <div>
          <h2>Inpatient Schedule</h2>
          <p className="ip-sched-subtitle">
            Read-only projection of inpatient service days for {block?.name || "this block"}.
          </p>
        </div>
        <div className="ip-sched-actions">
          <button
            className="secondary-button"
            onClick={downloadPoster}
            title="Export a polished inpatient poster (one page per week)."
          >
            <Image size={18} />
            Inpatient poster
          </button>
          <button
            className="secondary-button"
            onClick={downloadPdf}
            title="Save the inpatient calendar (plus legend and inpatient-relevant conflicts) as its own PDF for distribution."
          >
            <FileDown size={18} />
            Download inpatient PDF
          </button>
        </div>
      </div>

      {/* 1. Daily inpatient heatmap — one cell per calendar day. */}
      <div className="ip-sched-section">
        <h3>Daily inpatient staffing</h3>
        <div className="ip-sched-legend" aria-label="Heatmap legend">
          {toneTokens.map((tone) => (
            <span key={tone} className="ip-sched-legend-item">
              <span className={`ip-sched-swatch ip-sched-tone-${tone}`} />
              {HEATMAP_TONE_LABELS[tone]}
            </span>
          ))}
        </div>
        <div className="ip-sched-heatmap">
          {dates.map((date) => {
            const count = dayCounts[date] || 0;
            const tone = inpatientHeatmapTone(count);
            return (
              <div
                key={date}
                className={`ip-sched-heat-cell ip-sched-tone-${tone}`}
                title={`${weekdayName(date)} ${date} — ${count} on inpatient (${HEATMAP_TONE_LABELS[tone]})`}
              >
                <span className="ip-sched-heat-dow">{weekdayName(date).slice(0, 3)}</span>
                <span className="ip-sched-heat-date">{shortDate(date)}</span>
                <span className="ip-sched-heat-count">{count} IP</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Inpatient continuity timeline — rotator rows × date columns. */}
      <div className="ip-sched-section">
        <h3>Inpatient continuity timeline</h3>
        <div className="ip-sched-timeline-scroll">
          <table className="ip-sched-timeline">
            <thead>
              <tr>
                <th className="ip-sched-tl-name">Rotator</th>
                {dates.map((date) => (
                  <th key={date} className="ip-sched-tl-col" title={`${weekdayName(date)} ${date}`}>
                    {shortDate(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timelineRows.map(({ rotator, days }) => (
                <tr key={rotator.id}>
                  <td className="ip-sched-tl-name" title={rotator.fullName}>
                    {rotator.fullName}
                  </td>
                  {dates.map((date) => (
                    <td
                      key={date}
                      className={`ip-sched-tl-cell${days.has(date) ? " ip-sched-tl-on" : ""}`}
                      title={days.has(date) ? `${rotator.fullName} — inpatient ${date}` : undefined}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Daily roster cards — reuse inpatientDayData per date. */}
      <div className="ip-sched-section">
        <h3>Daily roster</h3>
        <div className="ip-sched-roster">
          {dates.map((date) => {
            const day = inpatientDayData(state, date, conflictsByDate);
            const onNames = day.on.map((x) => x.rotator.fullName);
            const seniorNames = day.senior.map((r) => r.fullName);
            const fellowNames = day.fellow.map((r) => r.fullName);
            return (
              <div key={date} className="ip-sched-roster-card">
                <div className="ip-sched-roster-head">
                  <span className="ip-sched-roster-dow">{weekdayName(date)}</span>
                  <span className="ip-sched-roster-date">{shortDate(date)}</span>
                  {day.holiday && <span className="ip-sched-roster-holiday">{day.holiday.label || "Holiday"}</span>}
                </div>
                {onNames.length === 0 ? (
                  <p className="ip-sched-roster-empty">No one on service.</p>
                ) : (
                  <ul className="ip-sched-roster-list">
                    {onNames.map((name, i) => (
                      <li key={`${date}-on-${i}`}>{name}</li>
                    ))}
                  </ul>
                )}
                {seniorNames.length > 0 && (
                  <p className="ip-sched-roster-meta">
                    <strong>Senior:</strong> {seniorNames.join(", ")}
                  </p>
                )}
                {fellowNames.length > 0 && (
                  <p className="ip-sched-roster-meta">
                    <strong>Fellow:</strong> {fellowNames.join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
