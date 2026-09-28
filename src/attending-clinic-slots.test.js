// DEF-1 — the AttendingProfileEditor must honor the legacy `session` key on clinic
// slots (the rest of the app reads `slot.session ?? slot.period`; the editor used to
// read only `slot.period`, so seed/imported clinics stored under `session` rendered
// UNCHECKED). These pure helpers live in App.jsx so the read/toggle/normalize logic is
// testable in isolation — same pattern as recordUndo/applyUndo in undo-history.test.js.
import { describe, it, expect } from "vitest";
import {
  clinicSlotPeriod,
  hasRecurringClinic,
  toggleRecurringClinic,
  normalizeOneOffPeriod,
} from "./App.jsx";

describe("DEF-1 — attending clinic-slot period accessor honors legacy `session`", () => {
  it("clinicSlotPeriod prefers `session`, falls back to `period`", () => {
    expect(clinicSlotPeriod({ weekday: "Monday", session: "AM" })).toBe("AM");
    expect(clinicSlotPeriod({ weekday: "Monday", period: "PM" })).toBe("PM");
    expect(clinicSlotPeriod({ weekday: "Monday", session: "PM", period: "AM" })).toBe("PM"); // session wins, matches clinic-selectors
    expect(clinicSlotPeriod({ weekday: "Monday" })).toBe(null);
    expect(clinicSlotPeriod(null)).toBe(null);
  });

  it("hasRecurringClinic recognizes a slot stored under the legacy `session` key", () => {
    const recurring = [{ weekday: "Monday", session: "AM", clinicName: "General Neuro" }];
    expect(hasRecurringClinic(recurring, "Monday", "AM")).toBe(true); // the DEF-1 case: was false
    expect(hasRecurringClinic(recurring, "Monday", "PM")).toBe(false);
    expect(hasRecurringClinic(recurring, "Tuesday", "AM")).toBe(false);
  });

  it("hasRecurringClinic still works for current `period`-keyed slots", () => {
    const recurring = [{ weekday: "Wednesday", period: "PM" }];
    expect(hasRecurringClinic(recurring, "Wednesday", "PM")).toBe(true);
    expect(hasRecurringClinic([], "Wednesday", "PM")).toBe(false);
    expect(hasRecurringClinic(undefined, "Wednesday", "PM")).toBe(false);
  });

  it("toggleRecurringClinic REMOVES a legacy `session` slot instead of duplicating it", () => {
    const recurring = [{ weekday: "Monday", session: "AM", clinicName: "General Neuro" }];
    const next = toggleRecurringClinic(recurring, "Monday", "AM");
    expect(next).toEqual([]); // removed, not appended as a second {weekday,period} entry
  });

  it("toggleRecurringClinic ADDS a new slot under the current `period` key", () => {
    const next = toggleRecurringClinic([], "Friday", "PM");
    expect(next).toEqual([{ weekday: "Friday", period: "PM" }]);
    // adding a second distinct slot leaves the first intact
    const next2 = toggleRecurringClinic(next, "Friday", "AM");
    expect(next2).toEqual([{ weekday: "Friday", period: "PM" }, { weekday: "Friday", period: "AM" }]);
  });

  it("normalizeOneOffPeriod writes `period` and DROPS the stale `session` key (single source of truth)", () => {
    const slot = { date: "2026-05-10", session: "PM", clinicName: "Epilepsy" };
    const next = normalizeOneOffPeriod(slot, "AM");
    expect(next).toEqual({ date: "2026-05-10", period: "AM", clinicName: "Epilepsy" });
    expect("session" in next).toBe(false); // would otherwise win via `session ?? period` and snap back
    expect(clinicSlotPeriod(next)).toBe("AM");
  });
});
