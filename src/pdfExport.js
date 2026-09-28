// PDF export. Three public functions:
//
//   buildSchedulePdf(state, block)    — combined: inpatient + outpatient + legend + conflicts
//   buildInpatientPdf(state, block)   — inpatient + legend + inpatient-relevant conflicts
//   buildOutpatientPdf(state, block)  — outpatient + legend + outpatient-relevant conflicts
//
// Coordinator wanted the two split versions so she can distribute the
// inpatient calendar to one set of recipients and the outpatient
// calendar to another (her phone call, 2026-05-22).
//
// All three render entirely client-side via jsPDF + jspdf-autotable;
// no network calls. The offline-contract test only inspects our own
// src/ + shared/ + backend_py/ files for forbidden primitives, so
// importing these libs is safe under §0.2.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  dateRange,
  detectConflicts,
  generateLegend,
  getRotator
} from "../shared/scheduler/scheduler.js";
import { outpatientDayData } from "../shared/scheduler/derived-views.js";
import { expandClinicOccurrences } from "../shared/scheduler/clinic-selectors.js";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
const INPATIENT_COLUMNS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OUTPATIENT_COLUMNS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const ACTUAL_SCHEDULE_CONFLICT_TYPES = new Set([
  "double-booked",
  "holiday-clinic",
  "missing-legend"
]);

function dayOfWeek(iso) {
  if (!iso) return "";
  const d = parseIsoDate(iso);
  if (!d) return "";
  return WEEKDAY_NAMES[d.getUTCDay()];
}

function safeName(rotator) {
  return rotator?.displayName ?? "[Removed]";
}

function newDoc() {
  return new jsPDF({ orientation: "landscape", format: "letter", unit: "pt" });
}

const MARGIN = 36; // ~0.5 inch

function renderHeader(doc, block, title) {
  let cursorY = MARGIN;
  doc.setFontSize(20);
  doc.text(title || block?.name || "Pediatric Neurology Schedule", MARGIN, cursorY);
  cursorY += 24;
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (block?.startDate && block?.endDate) {
    doc.text(`${block.startDate} to ${block.endDate}${block.status ? ` · ${block.status}` : ""}`, MARGIN, cursorY);
    cursorY += 14;
  }
  doc.text(`Generated ${new Date().toLocaleString()}`, MARGIN, cursorY);
  doc.setTextColor(0);
  cursorY += 20;
  return cursorY;
}

function parseIsoDate(iso) {
  const parts = String(iso || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function isoFromDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso, days) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDate(date);
}

function startOfWeekIso(iso, startDay) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const diff = (date.getUTCDay() - startDay + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return isoFromDate(date);
}

function endOfWeekIso(iso, endDay) {
  const date = parseIsoDate(iso);
  if (!date) return null;
  const diff = (endDay - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + diff);
  return isoFromDate(date);
}

function dateLabel(iso) {
  const date = parseIsoDate(iso);
  if (!date) return iso || "";
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function calendarRows(block, { weekdaysOnly = false } = {}) {
  if (!block?.startDate || !block?.endDate || block.startDate > block.endDate) return [];
  const blockDates = new Set(dateRange(block.startDate, block.endDate));
  if (blockDates.size === 0) return [];

  const columns = weekdaysOnly ? 5 : 7;
  const weekStart = weekdaysOnly ? startOfWeekIso(block.startDate, 1) : startOfWeekIso(block.startDate, 0);
  const weekEnd = weekdaysOnly ? endOfWeekIso(block.endDate, 5) : endOfWeekIso(block.endDate, 6);
  if (!weekStart || !weekEnd) return [];

  const rows = [];
  for (let rowStart = weekStart; rowStart && rowStart <= weekEnd; rowStart = addDaysIso(rowStart, 7)) {
    const row = [];
    for (let column = 0; column < columns; column += 1) {
      const iso = addDaysIso(rowStart, column);
      row.push(iso && blockDates.has(iso) ? iso : null);
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function setFont(doc, style = "normal") {
  if (typeof doc.setFont === "function") {
    doc.setFont("helvetica", style);
  }
}

function drawWrappedLines(doc, lines, x, y, width, maxY, options = {}) {
  const lineHeight = options.lineHeight || 9;
  let cursorY = y;
  for (const line of lines.filter(Boolean)) {
    const wrapped = doc.splitTextToSize(String(line), width);
    for (const piece of wrapped) {
      if (cursorY > maxY) {
        doc.text("...", x, maxY);
        return maxY;
      }
      doc.text(piece, x, cursorY);
      cursorY += lineHeight;
    }
  }
  return cursorY;
}

function scheduledRotatorIds(state, block, scope = "all") {
  if (!block?.startDate || !block?.endDate) return new Set();
  const ids = new Set();
  if (scope === "all" || scope === "inpatient") {
    for (const item of state.inpatientAssignments || []) {
      if (item.date >= block.startDate && item.date <= block.endDate && item.rotatorId && item.role !== "Off") {
        ids.add(item.rotatorId);
      }
    }
  }
  if (scope === "all" || scope === "outpatient") {
    for (const item of state.outpatientSessions || []) {
      if (item.date >= block.startDate && item.date <= block.endDate && item.rotatorId) {
        ids.add(item.rotatorId);
      }
    }
  }
  return ids;
}

function inpatientEntriesForDate(state, date) {
  return (state.inpatientAssignments || [])
    .filter((item) => item.date === date && item.role !== "Off")
    .map((item) => ({
      assignment: item,
      rotator: getRotator(state, item.rotatorId)
    }));
}

function inpatientLine(entry) {
  return `${safeName(entry.rotator)} - ${entry.assignment.role || "Resident"}`;
}

function outpatientLine(session) {
  const people = [];
  if (session.rotator) people.push(safeName(session.rotator));
  if (session.provider && !people.includes(session.provider)) people.push(session.provider);
  const details = [
    session.clinicName || "Clinic",
    people.join(" / "),
    session.location && `@ ${session.location}`,
    session.count != null && `${session.count} patients`
  ].filter(Boolean);
  if (session.status === "stay-tuned") details.push("stay tuned");
  if (session.status === "cme") details.push("CME");
  if (session.status === "no-clinic") details.push("no clinic");
  if (session.status === "students-off") details.push("students off");
  if (session.status === "residents-off") details.push("residents off");
  return details.join(" - ");
}

function renderCellShell(doc, date, x, y, width, height, options = {}) {
  if (!date) {
    doc.setFillColor(249, 250, 251);
    doc.setDrawColor(229, 231, 235);
    doc.rect(x, y, width, height, "FD");
    return false;
  }

  const isWeekend = !options.weekdaysOnly && [0, 6].includes(parseIsoDate(date)?.getUTCDay());
  const fill = isWeekend ? [248, 250, 252] : [255, 255, 255];
  doc.setFillColor(...fill);
  doc.setDrawColor(209, 213, 219);
  doc.rect(x, y, width, height, "FD");
  doc.setTextColor(31, 41, 55);
  setFont(doc, "bold");
  doc.setFontSize(8);
  doc.text(`${dateLabel(date)} ${dayOfWeek(date).slice(0, 3)}`, x + 5, y + 11);
  setFont(doc, "normal");
  return true;
}

function renderCalendarGrid(doc, { heading, columns, rows, startY, renderCell, weekdaysOnly = false, emptyMessage }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - (MARGIN * 2);
  const columnWidth = usableWidth / columns.length;
  const headerHeight = 18;
  const minRowHeight = 58;
  const maxRowHeight = 88;

  if (rows.length === 0) {
    doc.setFontSize(14);
    setFont(doc, "bold");
    doc.text(heading, MARGIN, startY);
    setFont(doc, "normal");
    doc.setFontSize(10);
    doc.text(emptyMessage, MARGIN, startY + 20);
    return startY + 44;
  }

  let rowIndex = 0;
  let pageStartY = startY;
  let continued = false;
  let finalY = startY;

  while (rowIndex < rows.length) {
    if (continued || pageStartY > pageHeight - 140) {
      doc.addPage();
      pageStartY = MARGIN;
    }

    doc.setFontSize(14);
    setFont(doc, "bold");
    doc.text(continued ? `${heading} (continued)` : heading, MARGIN, pageStartY);
    setFont(doc, "normal");

    const headerY = pageStartY + 16;
    const gridY = headerY + headerHeight;
    const availableHeight = Math.max(minRowHeight, pageHeight - gridY - 48);
    const rowsPerPage = Math.max(1, Math.floor(availableHeight / minRowHeight));
    const pageRows = rows.slice(rowIndex, rowIndex + rowsPerPage);
    const rowHeight = Math.min(maxRowHeight, availableHeight / pageRows.length);

    columns.forEach((label, column) => {
      const x = MARGIN + (column * columnWidth);
      doc.setFillColor(55, 65, 81);
      doc.setDrawColor(55, 65, 81);
      doc.rect(x, headerY, columnWidth, headerHeight, "FD");
      doc.setTextColor(255);
      doc.setFontSize(8);
      setFont(doc, "bold");
      doc.text(label, x + 5, headerY + 12);
    });
    setFont(doc, "normal");
    doc.setTextColor(0);

    pageRows.forEach((row, rowOffset) => {
      const y = gridY + (rowOffset * rowHeight);
      row.forEach((date, column) => {
        const x = MARGIN + (column * columnWidth);
        if (renderCellShell(doc, date, x, y, columnWidth, rowHeight, { weekdaysOnly })) {
          renderCell(date, x, y, columnWidth, rowHeight);
        }
      });
    });

    finalY = gridY + (pageRows.length * rowHeight);
    rowIndex += pageRows.length;
    continued = true;
  }

  doc.setTextColor(0);
  setFont(doc, "normal");
  return finalY + 24;
}

function renderInpatientCalendar(doc, state, block, startY, heading = "Inpatient Calendar") {
  return renderCalendarGrid(doc, {
    heading,
    columns: INPATIENT_COLUMNS,
    rows: calendarRows(block),
    startY,
    emptyMessage: "No inpatient dates are configured for this block.",
    renderCell(date, x, y, width, height) {
      const entries = inpatientEntriesForDate(state, date);
      const lines = entries.length ? entries.map(inpatientLine) : ["No assignments"];
      doc.setFontSize(8);
      doc.setTextColor(entries.length ? 17 : 107, entries.length ? 24 : 114, entries.length ? 39 : 128);
      drawWrappedLines(doc, lines, x + 5, y + 25, width - 10, y + height - 6, { lineHeight: 9 });
    }
  });
}

function renderOutpatientCalendar(doc, state, block, startY, heading = "Outpatient Weekday Clinics") {
  return renderCalendarGrid(doc, {
    heading,
    columns: OUTPATIENT_COLUMNS,
    rows: calendarRows(block, { weekdaysOnly: true }),
    startY,
    weekdaysOnly: true,
    emptyMessage: "No outpatient weekdays are configured for this block.",
    renderCell(date, x, y, width, height) {
      const data = outpatientDayData(state, date, {});
      let cursorY = y + 25;
      for (const period of ["AM", "PM"]) {
        const sessions = data.sessions[period] || [];
        doc.setTextColor(31, 41, 55);
        doc.setFontSize(8);
        setFont(doc, "bold");
        doc.text(period, x + 5, cursorY);
        setFont(doc, "normal");
        if (sessions.length > 0) {
          doc.setTextColor(17, 24, 39);
          cursorY = drawWrappedLines(
            doc,
            sessions.map(outpatientLine),
            x + 23,
            cursorY,
            width - 28,
            y + height - 6,
            { lineHeight: 8.5 }
          );
        }
        cursorY += 8;
      }
    }
  });
}

// Final clinic placements from the Clinics tab (2026-05-28 redesign). Reads
// ONLY persisted state.clinicAssignments — these are weekday Mon–Fri by
// construction, so this never surfaces weekend sessions and is independent of
// the outpatientSessions-based weekday calendar above. Skipped entirely when no
// clinic assignments exist (e.g. legacy-only states).
function renderClinicAssignments(doc, state, block) {
  const assignments = (state?.clinicAssignments || []).filter(Boolean);
  if (assignments.length === 0) return;
  const occById = new Map(
    expandClinicOccurrences(state, { startDate: block?.startDate, endDate: block?.endDate })
      .map((o) => [o.id, o])
  );
  const rows = assignments
    .map((a) => {
      const occ = occById.get(a.clinicOccurrenceId);
      const rot = getRotator(state, a.rotatorId);
      const day = WEEKDAY_NAMES[new Date(`${a.date}T00:00:00`).getDay()];
      return [
        rot?.displayName || a.rotatorId,
        a.date,
        day,
        a.session,
        occ?.clinicName || "",
        occ?.attendingName || ""
      ];
    })
    .sort((x, y) => (x[1] === y[1] ? x[3].localeCompare(y[3]) : x[1].localeCompare(y[1])));
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Clinic Assignments", MARGIN, MARGIN);
  autoTable(doc, {
    startY: MARGIN + 6,
    head: [["Rotator", "Date", "Day", "AM/PM", "Clinic", "Attending"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 64, 90], textColor: 255 },
    margin: { left: MARGIN, right: MARGIN }
  });
}

function renderLegend(doc, state, block, scope = "all") {
  const ids = scheduledRotatorIds(state, block, scope);
  if (ids.size === 0) return;
  const legend = generateLegend(state, block);
  const entries = legend.entries.filter((entry) => ids.has(entry.rotatorId));
  if (entries.length === 0) return;
  let residentCounter = 0;
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Provider Legend", MARGIN, MARGIN);
  autoTable(doc, {
    startY: MARGIN + 6,
    head: [["#", "Provider"]],
    body: entries.map((e) => {
      const number = /^\d+$/.test(String(e.number)) ? String(++residentCounter) : String(e.number);
      return [number, e.displayLabel];
    }),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [55, 65, 81], textColor: 255 },
    margin: { left: MARGIN, right: MARGIN }
  });
}

function renderConflicts(doc, state, block, filter = null) {
  // Scope to the block window so a multi-block state doesn't bleed
  // conflicts from a different rotation into the current block's PDF.
  let conflicts = detectConflicts(state).filter(
    (c) => !block?.startDate || !block?.endDate ||
           (c.date >= block.startDate && c.date <= block.endDate)
  ).filter((c) => ACTUAL_SCHEDULE_CONFLICT_TYPES.has(c.type));
  if (filter === "inpatient") {
    conflicts = conflicts.filter((c) => !c.detail || !/session falls/i.test(c.detail));
  } else if (filter === "outpatient") {
    conflicts = conflicts.filter((c) => !c.detail || !/inpatient coverage/i.test(c.detail));
  }
  if (conflicts.length === 0) return;
  doc.addPage();
  doc.setFontSize(14);
  doc.text(`Open Conflicts (${conflicts.length})`, MARGIN, MARGIN);
  autoTable(doc, {
    startY: MARGIN + 6,
    head: [["Severity", "Date", "Issue", "Why flagged"]],
    body: conflicts.map((c) => [c.severity, c.date, c.title, c.detail]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [120, 53, 15], textColor: 255 },
    margin: { left: MARGIN, right: MARGIN }
  });
}

function renderFooter(doc, block, titleOverride) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    const title = titleOverride || block?.name || "Schedule";
    doc.text(`${title} — Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 18, { align: "center" });
    doc.setTextColor(0);
  }
}

/**
 * Inpatient-only PDF: header + inpatient calendar + scheduled-provider
 * legend + inpatient-relevant actual schedule conflicts.
 */
export function buildInpatientPdf(state, block) {
  const doc = newDoc();
  const title = `${block?.name || "Schedule"} — Inpatient`;
  let cursorY = renderHeader(doc, block, title);
  renderInpatientCalendar(doc, state, block, cursorY);
  renderLegend(doc, state, block, "inpatient");
  renderConflicts(doc, state, block, "inpatient");
  renderFooter(doc, block, title);
  return doc.output("blob");
}

/**
 * Outpatient-only PDF: header + weekday AM/PM clinic calendar +
 * scheduled-provider legend + outpatient-relevant actual schedule conflicts.
 */
// 2026-05-28 redesign: the outpatient PDF = outpatientSessions-based weekday
// calendar (includes legacy real-clinic data) + the new Clinics-tab placements
// (renderClinicAssignments, reading state.clinicAssignments) + legend + conflicts.
export function buildOutpatientPdf(state, block) {
  const doc = newDoc();
  const title = `${block?.name || "Schedule"} — Outpatient`;
  let cursorY = renderHeader(doc, block, title);
  renderOutpatientCalendar(doc, state, block, cursorY);
  renderClinicAssignments(doc, state, block);
  renderLegend(doc, state, block, "outpatient");
  renderConflicts(doc, state, block, "outpatient");
  renderFooter(doc, block, title);
  return doc.output("blob");
}

/**
 * Combined PDF (backward-compatible export). Header -> inpatient
 * calendar -> outpatient calendar -> scheduled-provider legend ->
 * actual schedule conflicts.
 */
export function buildSchedulePdf(state, block) {
  const doc = newDoc();
  let cursorY = renderHeader(doc, block);
  cursorY = renderInpatientCalendar(doc, state, block, cursorY);
  if (cursorY > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage();
    cursorY = MARGIN;
  }
  renderOutpatientCalendar(doc, state, block, cursorY);
  renderLegend(doc, state, block);
  renderConflicts(doc, state, block);
  renderFooter(doc, block);
  return doc.output("blob");
}
