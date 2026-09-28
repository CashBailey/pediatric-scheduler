import XCTest
@testable import PediatricScheduler

final class PosterWeeksTests: XCTestCase {
    func testMondayOfWalksBackToMonday() {
        XCTAssertEqual(PosterWeeks.mondayOf("2026-01-01"), "2025-12-29") // Thursday
        XCTAssertEqual(PosterWeeks.mondayOf("2026-05-04"), "2026-05-04") // already Monday
        XCTAssertEqual(PosterWeeks.mondayOf("2026-05-08"), "2026-05-04") // Friday
    }

    func testThursdayStartBlockYieldsPartialFirstWeek() {
        // Mirrors contracts/golden/populated-state.json: block 2026-01-01 (Thu)
        // to 2026-01-28 (Wed), weekday dates only.
        let dates = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07",
                     "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14"]
        let weeks = PosterWeeks.weekBuckets(dates)
        XCTAssertEqual(weeks.count, 3)
        XCTAssertEqual(weeks[0], ["2026-01-01", "2026-01-02"]) // Thu, Fri only
        XCTAssertEqual(weeks[1], ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"])
        XCTAssertEqual(weeks[2], ["2026-01-12", "2026-01-13", "2026-01-14"]) // partial tail
    }

    func testUnsortedInputStillBucketsAndSorts() {
        let weeks = PosterWeeks.weekBuckets(["2026-05-06", "2026-05-04", "2026-05-11"])
        XCTAssertEqual(weeks, [["2026-05-04", "2026-05-06"], ["2026-05-11"]])
    }

    func testEmptyInput() {
        XCTAssertEqual(PosterWeeks.weekBuckets([]), [])
    }
}
