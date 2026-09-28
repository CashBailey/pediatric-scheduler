import XCTest
@testable import PediatricScheduler

/// Covers SourceReadiness's per-program status classification: a reviewed
/// source for a program wins over roster data, active-roster-only programs
/// are "data present but unlabeled", and programs with neither are waiting.
/// Also covers the case/whitespace-insensitive program matching and the
/// additional-reviewed-sources count used outside the expected list.
final class SourceReadinessTests: XCTestCase {
    private func state(_ json: String) throws -> SchedulerState {
        try APIClient.decodeState(from: Data(json.utf8))
    }

    private static let block = """
    {
      "id": "block-1",
      "name": "Block",
      "startDate": "2026-01-01",
      "endDate": "2026-01-31"
    }
    """

    func testReviewedSourceMatchesToReviewed() throws {
        let state = try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [],
          "inpatientAssignments": [],
          "outpatientSessions": [],
          "expectedSourcePrograms": ["Neurology"],
          "sources": [
            {"id": "s1", "program": "Neurology", "status": "Reviewed", "fileName": "roster.csv", "importedRotatorCount": 3}
          ]
        }
        """)
        let readiness = SourceReadiness(state: state)
        XCTAssertEqual(readiness.expectedPrograms.first?.status, .reviewed)
        XCTAssertTrue(readiness.allIn)
        XCTAssertEqual(readiness.waitingCount, 0)
    }

    func testActiveRotatorNoSourceIsDataPresent() throws {
        let state = try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [
            {"id": "r1", "program": "Neurology", "segments": [{"start": "2026-01-05", "end": "2026-01-20"}]}
          ],
          "inpatientAssignments": [],
          "outpatientSessions": [],
          "expectedSourcePrograms": ["Neurology"]
        }
        """)
        let readiness = SourceReadiness(state: state)
        XCTAssertEqual(readiness.expectedPrograms.first?.status, .dataPresent)
    }

    func testNeitherSourceNorRotatorIsWaiting() throws {
        let state = try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [],
          "inpatientAssignments": [],
          "outpatientSessions": [],
          "expectedSourcePrograms": ["Neurology"]
        }
        """)
        let readiness = SourceReadiness(state: state)
        XCTAssertEqual(readiness.expectedPrograms.first?.status, .waiting)
        XCTAssertFalse(readiness.allIn)
        XCTAssertEqual(readiness.waitingCount, 1)
    }

    func testMatchingIsCaseAndWhitespaceInsensitive() throws {
        let state = try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [],
          "inpatientAssignments": [],
          "outpatientSessions": [],
          "expectedSourcePrograms": ["  Neurology  "],
          "sources": [
            {"id": "s1", "program": "NEUROLOGY", "status": "Reviewed", "fileName": "roster.csv"}
          ]
        }
        """)
        let readiness = SourceReadiness(state: state)
        XCTAssertEqual(readiness.expectedPrograms.first?.status, .reviewed)
    }

    func testAdditionalReviewedSourcesCountsOutsideExpectedList() throws {
        let state = try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [],
          "inpatientAssignments": [],
          "outpatientSessions": [],
          "expectedSourcePrograms": ["Neurology"],
          "sources": [
            {"id": "s1", "program": "Neurology", "status": "Reviewed", "fileName": "roster.csv"},
            {"id": "s2", "program": "Cardiology", "status": "Reviewed", "fileName": "extra.csv"}
          ]
        }
        """)
        let readiness = SourceReadiness(state: state)
        XCTAssertEqual(readiness.additionalReviewedSources, 1)
    }
}
