import XCTest
@testable import PediatricScheduler

/// Mirrors shared/scheduler/paint-selection.test.js so the native paint
/// sweep groups drag selections into the same contiguous runs the browser
/// paint tool commits.
final class PaintSelectionTests: XCTestCase {
    func testEmptySelectionYieldsNoRuns() {
        XCTAssertEqual(PaintSelection.contiguousRuns([], includeWeekends: false), [])
        XCTAssertEqual(PaintSelection.contiguousRuns([], includeWeekends: true), [])
    }

    func testSingleContiguousWeekdayRun() {
        let dates: Set<String> = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: false),
            [PaintSelection.Run(start: "2026-05-04", end: "2026-05-08")]
        )
    }

    func testFridayToMondayIsContiguousUnderWeekdayRule() {
        let dates: Set<String> = ["2026-05-08", "2026-05-11"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: false),
            [PaintSelection.Run(start: "2026-05-08", end: "2026-05-11")]
        )
    }

    func testMissingWeekdayBreaksRun() {
        let dates: Set<String> = ["2026-05-04", "2026-05-05", "2026-05-07"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: false),
            [
                PaintSelection.Run(start: "2026-05-04", end: "2026-05-05"),
                PaintSelection.Run(start: "2026-05-07", end: "2026-05-07"),
            ]
        )
    }

    func testSingleDaySelection() {
        XCTAssertEqual(
            PaintSelection.contiguousRuns(["2026-05-04"], includeWeekends: false),
            [PaintSelection.Run(start: "2026-05-04", end: "2026-05-04")]
        )
    }

    func testWeekdayRuleBreaksOnIncludedWeekendDays() {
        // Fri, Sat, Sun, Mon — weekday rule leaves Sat and Sun as their own
        // single-day runs (OP paints filter them out before grouping, but the
        // grouping contract is documented for the raw set too).
        let dates: Set<String> = ["2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: false),
            [
                PaintSelection.Run(start: "2026-05-08", end: "2026-05-08"),
                PaintSelection.Run(start: "2026-05-09", end: "2026-05-09"),
                PaintSelection.Run(start: "2026-05-10", end: "2026-05-11"),
            ]
        )
    }

    func testIncludeWeekendsSpansSaturdayAndSunday() {
        let dates: Set<String> = ["2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: true),
            [PaintSelection.Run(start: "2026-05-08", end: "2026-05-11")]
        )
    }

    func testIncludeWeekendsStillBreaksOnTrueCalendarGap() {
        let dates: Set<String> = ["2026-05-09", "2026-05-10", "2026-05-12"]
        XCTAssertEqual(
            PaintSelection.contiguousRuns(dates, includeWeekends: true),
            [
                PaintSelection.Run(start: "2026-05-09", end: "2026-05-10"),
                PaintSelection.Run(start: "2026-05-12", end: "2026-05-12"),
            ]
        )
    }

    func testOutpatientBlockedDatesFlagsWeekendsAndNoClinicHolidays() {
        let dates: Set<String> = ["2026-05-08", "2026-05-09", "2026-05-10", "2026-05-11", "2026-05-25"]
        let blocked = PaintSelection.outpatientBlockedDates(in: dates, noClinicDates: ["2026-05-25"])
        XCTAssertEqual(blocked, ["2026-05-09", "2026-05-10", "2026-05-25"])
    }
}
