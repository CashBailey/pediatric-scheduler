import XCTest
@testable import PediatricScheduler

/// Round-trips the shared cross-language fixture through the Swift decode
/// path. JS (tests/contracts-freeze.test.mjs) and Python
/// (backend_py/tests/test_contracts.py) validate and persist the same file;
/// this test proves the Swift projection decodes every declared field the
/// UI consumes — including the ones the empty initial state never exercises
/// (source-record import metadata, clinicAssignments, posterSettings).
final class StateFixtureDecodeTests: XCTestCase {
    private func fixtureData(_ relativePath: String) throws -> Data {
        // Resolve the repo root from this source file's location so the test
        // works from `swift test` without bundle resources.
        let testsDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PediatricSchedulerTests
            .deletingLastPathComponent() // macos
            .deletingLastPathComponent() // repo root
        return try Data(contentsOf: testsDir.appendingPathComponent(relativePath))
    }

    func testPopulatedStateFixtureDecodes() throws {
        let data = try fixtureData("contracts/golden/populated-state.json")
        let state = try APIClient.decodeState(from: data)

        XCTAssertEqual(state.activeBlockId, state.activeBlock?.id)
        XCTAssertEqual(state.rotators.first?.id, "rotator-populated-1")
        XCTAssertEqual(state.inpatientAssignments.first?.rotatorId, "rotator-populated-1")
        XCTAssertEqual(state.outpatientSessions.first?.period, "AM")

        let source = try XCTUnwrap(state.sources?.first)
        XCTAssertEqual(source.id, "source-roster-populated-1")
        XCTAssertEqual(source.importedRotatorCount, 1)
        XCTAssertEqual(source.importWarningCount, 1)
        XCTAssertEqual(source.importWarnings.count, 1)

        let clinic = try XCTUnwrap(state.clinicAssignments?.first)
        XCTAssertEqual(clinic.clinicOccurrenceId, "occ-1")
        XCTAssertEqual(clinic.session, "PM")

        let poster = try XCTUnwrap(state.posterSettings)
        XCTAssertEqual(poster.chief, "Dr. Chief Example")
        XCTAssertEqual(poster.locations?.first?.address, "123 Example Way")

        let fact = try XCTUnwrap(state.halfDayFacts?.first)
        XCTAssertEqual(fact.period, "PM")
        XCTAssertEqual(fact.rotatorId, "rotator-populated-1")
    }

    func testInitialStateFixtureDecodes() throws {
        let data = try fixtureData("backend_py/tests/fixtures/initial-state.json")
        let state = try APIClient.decodeState(from: data)
        XCTAssertEqual(state.activeBlockId, "block-new")
        XCTAssertNotNil(state.posterSettings)
    }
}
