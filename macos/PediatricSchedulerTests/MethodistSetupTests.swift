import XCTest
@testable import PediatricScheduler

/// Covers the Methodist 14/14 setup panel's gating: which rotators count as
/// Methodist (schoolType, with program fallback — the engine's
/// methodist-no-start predicate), which of them are flagged as missing a
/// rotation start, and when a segment start may be offered as a suggestion.
final class MethodistSetupTests: XCTestCase {
    private func state(_ json: String) throws -> SchedulerState {
        try APIClient.decodeState(from: Data(json.utf8))
    }

    private static let block = """
    {
      "id": "block-1",
      "name": "Block",
      "startDate": "2026-07-01",
      "endDate": "2026-07-28"
    }
    """

    private func makeState(rotators: String) throws -> SchedulerState {
        try state("""
        {
          "version": 1,
          "activeBlockId": "block-1",
          "serviceBlocks": [\(Self.block)],
          "rotators": [\(rotators)],
          "inpatientAssignments": [],
          "outpatientSessions": []
        }
        """)
    }

    func testMethodistBySchoolTypeMissingStartIsFlagged() throws {
        let state = try makeState(rotators: """
        {"id": "m1", "fullName": "Noah Patel", "schoolType": "methodist",
         "segments": [{"start": "2026-07-01", "end": "2026-07-28"}]}
        """)
        let block = try XCTUnwrap(state.activeBlock)
        let missing = MethodistSetup.rotatorsMissingStart(block: block, state: state)
        XCTAssertEqual(missing.map(\.id), ["m1"])
    }

    func testProgramFallbackClassifiesMethodistWhenSchoolTypeAbsent() throws {
        let state = try makeState(rotators: """
        {"id": "m2", "fullName": "Maya L.", "program": "Methodist",
         "segments": [{"start": "2026-07-05", "end": "2026-07-20"}]}
        """)
        let block = try XCTUnwrap(state.activeBlock)
        XCTAssertEqual(MethodistSetup.rotatorsMissingStart(block: block, state: state).map(\.id), ["m2"])
    }

    func testRotationStartSetIsNotFlagged() throws {
        let state = try makeState(rotators: """
        {"id": "m3", "fullName": "Set Start", "schoolType": "methodist",
         "rotationStartDate": "2026-07-01",
         "segments": [{"start": "2026-07-01", "end": "2026-07-28"}]}
        """)
        let block = try XCTUnwrap(state.activeBlock)
        XCTAssertTrue(MethodistSetup.rotatorsMissingStart(block: block, state: state).isEmpty)
    }

    func testNonMethodistAndInactiveRotatorsAreIgnored() throws {
        let state = try makeState(rotators: """
        {"id": "p1", "fullName": "Peds", "program": "UT Pediatrics",
         "segments": [{"start": "2026-07-01", "end": "2026-07-28"}]},
        {"id": "m4", "fullName": "Off Block", "schoolType": "methodist",
         "segments": [{"start": "2026-09-01", "end": "2026-09-28"}]}
        """)
        let block = try XCTUnwrap(state.activeBlock)
        XCTAssertTrue(MethodistSetup.rotatorsMissingStart(block: block, state: state).isEmpty)
    }

    func testSuggestionRequiresExactlyOneOverlappingSegment() throws {
        let state = try makeState(rotators: """
        {"id": "one", "fullName": "One Segment", "schoolType": "methodist",
         "segments": [{"start": "2026-07-05", "end": "2026-07-20"}]},
        {"id": "two", "fullName": "Two Segments", "schoolType": "methodist",
         "segments": [{"start": "2026-07-01", "end": "2026-07-10"}, {"start": "2026-07-15", "end": "2026-07-28"}]},
        {"id": "none", "fullName": "No Segments", "schoolType": "methodist"}
        """)
        let block = try XCTUnwrap(state.activeBlock)
        let byId = Dictionary(uniqueKeysWithValues: state.rotators.map { ($0.id, $0) })
        XCTAssertEqual(MethodistSetup.suggestedRotationStart(rotator: byId["one"]!, block: block), "2026-07-05")
        XCTAssertNil(MethodistSetup.suggestedRotationStart(rotator: byId["two"]!, block: block))
        XCTAssertNil(MethodistSetup.suggestedRotationStart(rotator: byId["none"]!, block: block))
    }
}
