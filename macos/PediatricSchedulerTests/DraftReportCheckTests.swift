import XCTest
@testable import PediatricScheduler

/// DraftReportCheck.init(raw:index:) decodes the optional rotatorId the
/// methodist-no-start check emits (JS shared/scheduler/program-rules.js,
/// Python backend_py/domain/draft.py) without disturbing any other field.
final class DraftReportCheckTests: XCTestCase {
    func testDecodesRotatorIdWhenPresent() {
        let raw: [String: Any] = [
            "id": "methodist-no-start",
            "message": "No Methodist rotation start date set.",
            "severity": "warning",
            "rotatorId": "rotator-1"
        ]
        let check = DraftReportCheck(raw: raw, index: 0)
        XCTAssertEqual(check.rotatorId, "rotator-1")
        XCTAssertEqual(check.checkId, "methodist-no-start")
        XCTAssertEqual(check.severity, "warning")
        XCTAssertEqual(check.message, "No Methodist rotation start date set.")
    }

    func testRotatorIdNilWhenAbsent() {
        let raw: [String: Any] = [
            "id": "other-check",
            "message": "Some other issue.",
            "severity": "error"
        ]
        let check = DraftReportCheck(raw: raw, index: 1)
        XCTAssertNil(check.rotatorId)
        XCTAssertTrue(check.isError)
    }

    func testOtherFieldsUnaffected() {
        let raw: [String: Any] = [
            "id": "check-x",
            "message": "Check message",
            "severity": "warning",
            "date": "2026-01-05",
            "dates": ["2026-01-05", "2026-01-06"],
            "candidates": ["rotator-a", "rotator-b"]
        ]
        let check = DraftReportCheck(raw: raw, index: 2)
        XCTAssertNil(check.rotatorId)
        XCTAssertEqual(check.date, "2026-01-05")
        XCTAssertEqual(check.dates, ["2026-01-05", "2026-01-06"])
        XCTAssertEqual(check.candidates, ["rotator-a", "rotator-b"])
    }
}
