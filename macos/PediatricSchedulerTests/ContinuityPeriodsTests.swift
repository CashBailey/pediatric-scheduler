import XCTest
@testable import PediatricScheduler

/// Grammar-parity checks for CalendarUtil.continuityPeriods against
/// backend_py/domain/draft.py::continuity_periods_for_weekday — the planning
/// grid badge must agree with the backend's continuity-conflict detection.
final class ContinuityPeriodsTests: XCTestCase {
    func testSingleAMSlot() {
        XCTAssertEqual(CalendarUtil.continuityPeriods("Thursday AM", onWeekday: "Thursday"), ["AM"])
        XCTAssertEqual(CalendarUtil.continuityPeriods("Thursday AM", onWeekday: "Tuesday"), [])
    }

    func testSinglePMSlotWithAbbreviationsAndSeparators() {
        XCTAssertEqual(CalendarUtil.continuityPeriods("Tue PM", onWeekday: "Tuesday"), ["PM"])
        XCTAssertEqual(CalendarUtil.continuityPeriods("tuesday/afternoon", onWeekday: "Tuesday"), ["PM"])
        XCTAssertEqual(CalendarUtil.continuityPeriods("Tuesday - morning", onWeekday: "Tuesday"), ["AM"])
    }

    func testBothPeriodsSameWeekday() {
        XCTAssertEqual(
            CalendarUtil.continuityPeriods("Tuesday AM, Tuesday PM", onWeekday: "Tuesday").sorted(),
            ["AM", "PM"]
        )
        XCTAssertEqual(
            CalendarUtil.continuityPeriods("Tuesday AM and Tuesday PM", onWeekday: "Tuesday").sorted(),
            ["AM", "PM"]
        )
    }

    func testMultiSlotOnlyMatchingWeekday() {
        XCTAssertEqual(CalendarUtil.continuityPeriods("Tuesday PM, Thursday AM", onWeekday: "Thursday"), ["AM"])
        XCTAssertEqual(CalendarUtil.continuityPeriods("Tuesday PM, Thursday AM", onWeekday: "Tuesday"), ["PM"])
    }

    func testUnparsableAndEmpty() {
        XCTAssertEqual(CalendarUtil.continuityPeriods("", onWeekday: "Monday"), [])
        XCTAssertEqual(CalendarUtil.continuityPeriods(nil, onWeekday: "Monday"), [])
        XCTAssertEqual(CalendarUtil.continuityPeriods("no clinic listed", onWeekday: "Monday"), [])
    }
}
