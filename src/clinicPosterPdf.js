// Clinic poster PDF (2026-05-28 poster feature).
//
//   buildClinicPosterPdf(state, block, { weekIndex })  — polished outpatient
//       clinic poster, one landscape page per week (weekIndex omitted = all
//       weeks = whole-block view; a number selects a single week).
//   buildInpatientPosterPdf(state, block, { weekIndex }) — minimal inpatient
//       counterpart (first cut; daily roster grid + staffing tone).
//
// This is a clean STRUCTURAL approximation of the reference mockup — real
// layout (header / 5 weekday columns / AM–PM / bottom panels), real content,
// and category color-coding — not a pixel match. Icons are simple drawn shapes;
// nothing is fetched from the network (local-only rule §0.2). All rendering is
// client-side via jsPDF, consistent with pdfExport.js.

import { jsPDF } from "jspdf";
import {
  serviceTypeForRotatorDate
} from "../shared/scheduler/service-assignments.js";
import {
  weekdayName,
  getRotator,
  DEFAULT_POSTER_SETTINGS,
  isPediatricNeurologyFellow
} from "../shared/scheduler/scheduler.js";
import { buildPosterWeeks } from "../shared/scheduler/poster-weeks.js";
import { clinicCategoryLegend } from "../shared/scheduler/clinic-categories.js";
import { inpatientHeatmapTone } from "../shared/scheduler/heatmap.js";

const PAGE_W = 792;
const PAGE_H = 612;
const M = 28;

const NAVY = [0, 31, 69];
const MED_BLUE = [0, 74, 159];
const ORANGE = [255, 138, 28];
const GRAY = [110, 116, 128];
const LIGHT_BORDER = [212, 220, 232];
const WHITE = [255, 255, 255];
const DARK_TEXT = [17, 24, 39];

const TONE_FILL = {
  critical: [254, 226, 226],
  below: [254, 243, 199],
  full: [220, 252, 231],
  surplus: [219, 234, 254]
};

function newDoc() {
  return new jsPDF({ orientation: "landscape", format: "letter", unit: "pt" });
}

function font(doc, style = "normal") {
  doc.setFont("helvetica", style);
}
function fill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function draw(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
function textColor(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function posterSettings(state) {
  return { ...DEFAULT_POSTER_SETTINGS, ...(state?.posterSettings || {}) };
}

// First Pediatric Neurology fellow active during the block. Returns display
// name or "" when none.
function fellowName(state, block) {
  const rotators = Array.isArray(state?.rotators) ? state.rotators : [];
  const overlaps = (r) =>
    (r.segments || []).some(
      (s) => s.start && s.end && s.start <= block.endDate && s.end >= block.startDate
    );
  const fellow = rotators.find((r) => isPediatricNeurologyFellow(r) && overlaps(r));
  return fellow ? fellow.displayName || fellow.fullName || "" : "";
}

function blockDateLabel(block) {
  return `${block.startDate} – ${block.endDate}`;
}

// ── header ────────────────────────────────────────────────────────────────
function drawHeader(doc, state, block, week, ps) {
  const top = M;
  // simple brain glyph: a rounded navy ring
  draw(doc, NAVY);
  doc.setLineWidth(2.5);
  doc.circle(M + 14, top + 16, 12, "S");
  doc.setLineWidth(0.5);

  let x = M + 38;
  textColor(doc, NAVY);
  font(doc, "bold");
  doc.setFontSize(10);
  doc.text(String(ps.programName || "").toUpperCase(), x, top + 8);
  doc.setFontSize(22);
  doc.text("OUTPATIENT CLINIC SCHEDULE", x, top + 30);
  textColor(doc, MED_BLUE);
  doc.setFontSize(12);
  const wkLabel = week ? ` (${week.label})` : "";
  doc.text(`${block.startDate} – ${block.endDate}${wkLabel}`, x, top + 46);

  // metadata block (center-right)
  const metaX = 470;
  let metaY = top + 6;
  textColor(doc, NAVY);
  doc.setFontSize(9);
  const rows = [
    ["Fellow", fellowName(state, block) || "—"],
    ["Chief", ps.chief || "—"],
    ["Block", blockDateLabel(block)]
  ];
  for (const [label, value] of rows) {
    font(doc, "bold");
    doc.text(`${label}:`, metaX, metaY);
    font(doc, "normal");
    doc.text(String(value), metaX + 42, metaY);
    metaY += 13;
  }

  drawKeyBox(doc, PAGE_W - M - 150, top, 150);
  return top + 56; // y where the column grid may begin
}

function drawKeyBox(doc, x, y, w) {
  const legend = clinicCategoryLegend();
  const rowH = 11;
  const h = 16 + legend.length * rowH;
  fill(doc, [250, 251, 253]);
  draw(doc, LIGHT_BORDER);
  doc.setLineWidth(0.7);
  doc.roundedRect(x, y, w, h, 4, 4, "FD");
  textColor(doc, NAVY);
  font(doc, "bold");
  doc.setFontSize(8);
  doc.text("KEY", x + 6, y + 11);
  font(doc, "normal");
  let cy = y + 22;
  for (const cat of legend) {
    fill(doc, cat.fill);
    draw(doc, cat.border);
    doc.roundedRect(x + 6, cy - 6, 8, 8, 1.5, 1.5, "FD");
    textColor(doc, DARK_TEXT);
    doc.setFontSize(7.5);
    doc.text(cat.label, x + 18, cy);
    cy += rowH;
  }
}

// ── weekday columns ─────────────────────────────────────────────────────────
function cardHeight() {
  return 34;
}

function drawCard(doc, card, x, y, w) {
  const h = cardHeight();
  fill(doc, card.category.fill);
  draw(doc, card.category.border);
  doc.setLineWidth(0.8);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setLineWidth(0.5);
  const tx = x + 5;
  textColor(doc, DARK_TEXT);
  font(doc, "bold");
  doc.setFontSize(7.5);
  doc.text(trim(doc, card.clinicName || "Clinic", w - 10), tx, y + 10);
  font(doc, "normal");
  doc.setFontSize(7);
  textColor(doc, [55, 65, 81]);
  doc.text(trim(doc, card.attendingName || "—", w - 10), tx, y + 19);
  textColor(doc, NAVY);
  const rot = card.rotatorNames.length ? card.rotatorNames.join(", ") : "[uncovered]";
  doc.text(trim(doc, `Rotator: ${rot}`, w - 10), tx, y + 28);
  return h;
}

function trim(doc, str, maxW) {
  const s = String(str || "");
  if (doc.getTextWidth(s) <= maxW) return s;
  let out = s;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawSession(doc, label, cards, x, y, w, h) {
  // accent dot + label
  fill(doc, ORANGE);
  draw(doc, ORANGE);
  doc.circle(x + 4, y - 2, 2.5, "F");
  textColor(doc, NAVY);
  font(doc, "bold");
  doc.setFontSize(8);
  doc.text(label, x + 11, y + 1);
  font(doc, "normal");

  const gap = 4;
  const cardH = cardHeight();
  let cy = y + 8;
  const available = h - 8;
  const maxCards = Math.max(1, Math.floor(available / (cardH + gap)));
  if (cards.length === 0) {
    drawEmptyCard(doc, x, cy, w, "No clinic scheduled");
    return;
  }
  const shown = cards.length > maxCards ? cards.slice(0, maxCards - 1) : cards;
  for (const card of shown) {
    cy += drawCard(doc, card, x, cy, w) + gap;
  }
  const hidden = cards.length - shown.length;
  if (hidden > 0) {
    textColor(doc, GRAY);
    doc.setFontSize(7);
    doc.text(`+${hidden} more`, x + 4, cy + 6);
  }
}

function drawEmptyCard(doc, x, y, w, msg) {
  const h = cardHeight();
  fill(doc, [255, 255, 255]);
  draw(doc, LIGHT_BORDER);
  doc.setLineDashPattern([2, 2], 0);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setLineDashPattern([], 0);
  textColor(doc, GRAY);
  font(doc, "italic");
  doc.setFontSize(7);
  doc.text(msg, x + 5, y + 18);
  font(doc, "normal");
}

function drawColumns(doc, week, top, bottom) {
  const days = week.days;
  const cols = 5;
  const gap = 6;
  const totalGap = gap * (cols - 1);
  const colW = (PAGE_W - 2 * M - totalGap) / cols;
  const headerH = 24;
  const bodyTop = top + headerH;
  const bodyH = bottom - bodyTop;
  const dividerY = bodyTop + bodyH / 2;

  // Index days by weekday so missing days (partial weeks) render as empty.
  const byWeekday = new Map(days.map((d) => [d.weekday, d]));
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  order.forEach((wd, i) => {
    const x = M + i * (colW + gap);
    const day = byWeekday.get(wd);
    // navy header
    fill(doc, NAVY);
    draw(doc, NAVY);
    doc.roundedRect(x, top, colW, headerH, 3, 3, "F");
    textColor(doc, WHITE);
    font(doc, "bold");
    doc.setFontSize(8.5);
    doc.text(wd.toUpperCase(), x + colW / 2, top + 10, { align: "center" });
    doc.setFontSize(8);
    doc.text(day ? day.short : "", x + colW / 2, top + 20, { align: "center" });

    // column body background
    fill(doc, WHITE);
    draw(doc, LIGHT_BORDER);
    doc.setLineWidth(0.7);
    doc.rect(x, bodyTop, colW, bodyH, "S");
    doc.setLineWidth(0.5);
    // AM/PM divider
    draw(doc, LIGHT_BORDER);
    doc.line(x + 4, dividerY, x + colW - 4, dividerY);

    const halfH = bodyH / 2;
    drawSession(doc, "AM", day ? day.AM : [], x + 4, bodyTop + 12, colW - 8, halfH - 14);
    drawSession(doc, "PM", day ? day.PM : [], x + 4, dividerY + 12, colW - 8, halfH - 14);
  });
}

// ── bottom panels ───────────────────────────────────────────────────────────
function drawBottomPanels(doc, state, week, ps, top) {
  const gap = 10;
  const w = (PAGE_W - 2 * M - 2 * gap) / 3;
  const h = PAGE_H - top - 26;
  const x0 = M;
  drawRotatorPanel(doc, week, x0, top, w, h);
  drawNotesPanel(doc, ps, x0 + w + gap, top, w, h);
  drawLocationsPanel(doc, ps, x0 + 2 * (w + gap), top, w, h);
}

function panelShell(doc, x, y, w, h, title) {
  fill(doc, WHITE);
  draw(doc, LIGHT_BORDER);
  doc.setLineWidth(0.7);
  doc.roundedRect(x, y, w, h, 4, 4, "FD");
  doc.setLineWidth(0.5);
  textColor(doc, NAVY);
  font(doc, "bold");
  doc.setFontSize(8.5);
  doc.text(title, x + 8, y + 13);
  font(doc, "normal");
}

function drawRotatorPanel(doc, week, x, y, w, h) {
  panelShell(doc, x, y, w, h, "OUTPATIENT ROTATORS THIS WEEK");
  let cy = y + 26;
  if (week.rotators.length === 0) {
    textColor(doc, GRAY);
    font(doc, "italic");
    doc.setFontSize(8);
    doc.text("No outpatient rotators this week.", x + 8, cy);
    font(doc, "normal");
    return;
  }
  for (const r of week.rotators) {
    if (cy > y + h - 8) break;
    // OP pill
    fill(doc, [243, 250, 240]);
    draw(doc, [168, 214, 162]);
    doc.roundedRect(x + 8, cy - 7, 20, 10, 3, 3, "FD");
    textColor(doc, [47, 110, 70]);
    doc.setFontSize(6.5);
    doc.text(r.type, x + 18, cy, { align: "center" });
    textColor(doc, NAVY);
    font(doc, "bold");
    doc.setFontSize(8);
    doc.text(trim(doc, r.name, w - 110), x + 34, cy);
    font(doc, "normal");
    textColor(doc, GRAY);
    doc.setFontSize(7);
    doc.text(trim(doc, r.rangeLabel, 70), x + w - 8, cy, { align: "right" });
    cy += 14;
  }
}

function drawNotesPanel(doc, ps, x, y, w, h) {
  panelShell(doc, x, y, w, h, "NOTES");
  let cy = y + 26;
  textColor(doc, DARK_TEXT);
  doc.setFontSize(7.5);
  for (const note of ps.notes || []) {
    if (cy > y + h - 6) break;
    const lines = doc.splitTextToSize(`• ${note}`, w - 16);
    for (const line of lines) {
      if (cy > y + h - 6) break;
      doc.text(line, x + 8, cy);
      cy += 10;
    }
  }
}

function drawLocationsPanel(doc, ps, x, y, w, h) {
  panelShell(doc, x, y, w, h, "LOCATIONS");
  let cy = y + 26;
  textColor(doc, NAVY);
  for (const loc of ps.locations || []) {
    if (cy > y + h - 6) break;
    font(doc, "bold");
    doc.setFontSize(8);
    doc.text(trim(doc, loc.name || "", w - 16), x + 8, cy);
    cy += 10;
    if (loc.address) {
      font(doc, "normal");
      textColor(doc, GRAY);
      doc.setFontSize(7.5);
      doc.text(trim(doc, loc.address, w - 16), x + 8, cy);
      textColor(doc, NAVY);
      cy += 12;
    } else {
      cy += 2;
    }
  }
}

function drawFooter(doc, state, ps, page, pages) {
  const y = PAGE_H - 14;
  textColor(doc, GRAY);
  doc.setFontSize(7.5);
  font(doc, "normal");
  doc.text(`Page ${page} of ${pages}`, M, y);
  font(doc, "italic");
  doc.setFontSize(8.5);
  textColor(doc, NAVY);
  doc.text(ps.tagline || "", PAGE_W / 2, y, { align: "center" });
  font(doc, "normal");
  textColor(doc, GRAY);
  doc.setFontSize(7.5);
  doc.text("Generated locally by Scheduler", PAGE_W - M, y, { align: "right" });
}

function emptyPage(doc, message) {
  textColor(doc, NAVY);
  font(doc, "bold");
  doc.setFontSize(16);
  doc.text("OUTPATIENT CLINIC SCHEDULE", M, M + 24);
  font(doc, "normal");
  textColor(doc, GRAY);
  doc.setFontSize(11);
  doc.text(message, M, M + 50);
}

/**
 * Polished outpatient clinic poster. One landscape page per week.
 * opts.weekIndex (1-based) selects a single week; omitted = all weeks.
 */
export function buildClinicPosterPdf(state, block, opts = {}) {
  const doc = newDoc();
  const ps = posterSettings(state);
  if (!block || !block.startDate || !block.endDate) {
    emptyPage(doc, "No active block selected.");
    return doc.output("blob");
  }
  let weeks = buildPosterWeeks(state, block);
  if (opts.weekIndex != null) {
    weeks = weeks.filter((w) => w.weekIndex === opts.weekIndex);
  }
  if (weeks.length === 0) {
    emptyPage(doc, "No weekday clinic dates in this block.");
    return doc.output("blob");
  }

  const COLUMNS_BOTTOM = 470; // leaves room for the 3 bottom panels
  weeks.forEach((week, i) => {
    if (i > 0) doc.addPage();
    const gridTop = drawHeader(doc, state, block, week, ps) + 8;
    drawColumns(doc, week, gridTop, COLUMNS_BOTTOM);
    drawBottomPanels(doc, state, week, ps, COLUMNS_BOTTOM + 12);
    drawFooter(doc, state, ps, i + 1, weeks.length);
  });
  return doc.output("blob");
}

// ── inpatient poster (minimal first cut) ────────────────────────────────────
function inpatientWeekCounts(state, week) {
  // For each day, count rotators on inpatient ('inpatient' or 'both').
  return week.days.map((day) => {
    let count = 0;
    const names = [];
    for (const r of state.rotators || []) {
      const svc = serviceTypeForRotatorDate(state, r.id, day.date);
      if (svc === "inpatient" || svc === "both") {
        count += 1;
        names.push(getRotator(state, r.id)?.displayName || r.fullName || r.id);
      }
    }
    return { day, count, names: names.sort((a, b) => a.localeCompare(b)) };
  });
}

/**
 * Minimal inpatient poster (first cut; the user asked to flesh this out later).
 * Reuses the poster header + a simple weekday staffing grid colored by the
 * shared heatmap tone, one page per week.
 */
export function buildInpatientPosterPdf(state, block, opts = {}) {
  const doc = newDoc();
  const ps = posterSettings(state);
  if (!block || !block.startDate || !block.endDate) {
    emptyPage(doc, "No active block selected.");
    return doc.output("blob");
  }
  let weeks = buildPosterWeeks(state, block);
  if (opts.weekIndex != null) {
    weeks = weeks.filter((w) => w.weekIndex === opts.weekIndex);
  }
  if (weeks.length === 0) {
    emptyPage(doc, "No weekday dates in this block.");
    return doc.output("blob");
  }

  weeks.forEach((week, i) => {
    if (i > 0) doc.addPage();
    // header (reuse outpatient header but override title)
    const top = M;
    draw(doc, NAVY);
    doc.setLineWidth(2.5);
    doc.circle(M + 14, top + 16, 12, "S");
    doc.setLineWidth(0.5);
    textColor(doc, NAVY);
    font(doc, "bold");
    doc.setFontSize(10);
    doc.text(String(ps.programName || "").toUpperCase(), M + 38, top + 8);
    doc.setFontSize(22);
    doc.text("INPATIENT SCHEDULE", M + 38, top + 30);
    textColor(doc, MED_BLUE);
    doc.setFontSize(12);
    doc.text(`${block.startDate} – ${block.endDate} (${week.label})`, M + 38, top + 46);

    const counts = inpatientWeekCounts(state, week);
    const cols = 5;
    const gap = 6;
    const colW = (PAGE_W - 2 * M - gap * (cols - 1)) / cols;
    const gridTop = top + 70;
    const headerH = 24;
    const bodyTop = gridTop + headerH;
    const bodyH = PAGE_H - bodyTop - 36;
    const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const byWeekday = new Map(counts.map((c) => [c.day.weekday, c]));

    order.forEach((wd, idx) => {
      const x = M + idx * (colW + gap);
      const entry = byWeekday.get(wd);
      fill(doc, NAVY);
      doc.roundedRect(x, gridTop, colW, headerH, 3, 3, "F");
      textColor(doc, WHITE);
      font(doc, "bold");
      doc.setFontSize(8.5);
      doc.text(wd.toUpperCase(), x + colW / 2, gridTop + 10, { align: "center" });
      doc.setFontSize(8);
      doc.text(entry ? entry.day.short : "", x + colW / 2, gridTop + 20, { align: "center" });

      const count = entry ? entry.count : 0;
      const tone = inpatientHeatmapTone(count);
      fill(doc, TONE_FILL[tone] || WHITE);
      draw(doc, LIGHT_BORDER);
      doc.rect(x, bodyTop, colW, bodyH, "FD");
      textColor(doc, NAVY);
      font(doc, "bold");
      doc.setFontSize(14);
      doc.text(`${count}`, x + colW / 2, bodyTop + 24, { align: "center" });
      doc.setFontSize(7.5);
      font(doc, "normal");
      doc.text("on inpatient", x + colW / 2, bodyTop + 36, { align: "center" });

      let cy = bodyTop + 52;
      textColor(doc, DARK_TEXT);
      doc.setFontSize(7.5);
      for (const name of entry ? entry.names : []) {
        if (cy > bodyTop + bodyH - 6) break;
        doc.text(trim(doc, name, colW - 10), x + 5, cy);
        cy += 10;
      }
    });

    drawFooter(doc, state, ps, i + 1, weeks.length);
  });
  return doc.output("blob");
}
