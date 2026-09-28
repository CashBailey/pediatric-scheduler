// Inpatient daily-staffing heatmap thresholds (plan §7).
//
// One cell per individual calendar day. The count passed in is the number of
// rotators physically on inpatient that day. Per migration-critic B2/Q2 that
// count MUST include double-booked ("both") rotators — the existing Planning
// Grid footer counts them as inpatient (buildPlanningGrid totals), a
// double-booked rotator IS on inpatient, and excluding them would undercount
// staffing and fire false understaffing alarms. The caller is responsible for
// computing count = (#inpatient + #both); this module only maps count → tone.

/**
 * Map an inpatient head-count to a staffing tone token. UI maps the token to a
 * concrete color. Thresholds (plan §7 / §14):
 *   0–1 → 'critical'  (red — understaffed)
 *   2–3 → 'below'     (amber — below ideal)
 *   4   → 'full'      (green — fully staffed)
 *   >4  → 'surplus'   (darker green / blue — surplus)
 */
export function inpatientHeatmapTone(count) {
  const n = Number(count) || 0;
  if (n <= 1) return "critical";
  if (n <= 3) return "below";
  if (n === 4) return "full";
  return "surplus";
}

// Human-readable label for each tone, for legends / tooltips / aria.
export const HEATMAP_TONE_LABELS = {
  critical: "Critical — understaffed",
  below: "Below ideal",
  full: "Fully staffed",
  surplus: "Surplus"
};
