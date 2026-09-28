import Foundation

/// Pure helpers for the Planning Grid paint sweep. Ports
/// shared/scheduler/paint-selection.js so the native drag-paint commits the
/// same contiguous runs — and skips the same outpatient-blocked days — as the
/// browser paint tool.
enum PaintSelection {
    struct Run: Equatable {
        let start: String
        let end: String
    }

    /// Group selected ISO dates into contiguous runs, one `assign.range` call
    /// per run. Outpatient paints use the next-weekday rule (Sat/Sun break a
    /// run and never join one, so weekend cells never reach the engine as
    /// part of an OP range); inpatient/off/clear use next-calendar-day so a
    /// sweep spans a weekend as a single range.
    static func contiguousRuns(_ dateSet: Set<String>, includeWeekends: Bool) -> [Run] {
        let dates = dateSet.sorted()
        guard let first = dates.first else { return [] }
        let isContiguous = includeWeekends ? isNextCalendarDay : isNextWeekday
        var runs: [Run] = []
        var runStart = first
        var runEnd = first
        for date in dates.dropFirst() {
            if isContiguous(runEnd, date) {
                runEnd = date
            } else {
                runs.append(Run(start: runStart, end: runEnd))
                runStart = date
                runEnd = date
            }
        }
        runs.append(Run(start: runStart, end: runEnd))
        return runs
    }

    /// Days an outpatient paint must not touch: weekends and no-clinic
    /// holidays (parity with the browser's `outpatientBlockedDates`).
    static func outpatientBlockedDates(in dates: Set<String>, noClinicDates: Set<String>) -> Set<String> {
        dates.filter { CalendarUtil.isWeekend($0) || noClinicDates.contains($0) }
    }

    private static func isNextCalendarDay(_ a: String, _ b: String) -> Bool {
        CalendarUtil.addDays(a, 1) == b
    }

    private static func isNextWeekday(_ a: String, _ b: String) -> Bool {
        var cursor = a
        for _ in 0..<4 {
            guard let next = CalendarUtil.addDays(cursor, 1) else { return false }
            cursor = next
            if !CalendarUtil.isWeekend(cursor) {
                return cursor == b
            }
        }
        return false
    }
}
