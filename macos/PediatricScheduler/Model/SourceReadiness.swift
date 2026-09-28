import SwiftUI

struct SourceReadiness {
    let expectedPrograms: [SourceProgramReadiness]
    let additionalReviewedSources: Int

    init(state: SchedulerState, activeRotators: [Rotator]) {
        let expected = Self.uniquePrograms(state.expectedSourcePrograms ?? [])
        let reviewedSources = (state.sources ?? []).filter(\.isReviewed)
        let sourcesByProgram = Dictionary(grouping: reviewedSources) { source in
            Self.programKey(source.program)
        }
        let activeProgramCounts = Dictionary(grouping: activeRotators.compactMap(\.program).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            Self.programKey($0)
        }.mapValues(\.count)
        let expectedKeys = Set(expected.map(Self.programKey))

        expectedPrograms = expected.map { program in
            let key = Self.programKey(program)
            let reviewed = (sourcesByProgram[key] ?? []).sorted { left, right in
                left.displayName.localizedCaseInsensitiveCompare(right.displayName) == .orderedAscending
            }
            if let source = reviewed.first {
                return SourceProgramReadiness(
                    program: program,
                    status: .reviewed,
                    detail: "\(source.displayName) reviewed\(source.importedRotatorCount.map { " - \($0) imported" } ?? "")."
                )
            }
            if let count = activeProgramCounts[key], count > 0 {
                return SourceProgramReadiness(
                    program: program,
                    status: .dataPresent,
                    detail: "\(count) active rotator\(count == 1 ? "" : "s") present; source record still needs labeling."
                )
            }
            return SourceProgramReadiness(
                program: program,
                status: .waiting,
                detail: "Waiting for a reviewed source or roster data."
            )
        }
        additionalReviewedSources = reviewedSources.filter { source in
            !expectedKeys.contains(Self.programKey(source.program))
        }.count
    }

    init(state: SchedulerState) {
        let active: [Rotator]
        if let block = state.activeBlock {
            let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
            active = state.rotators.filter { rotator in dates.contains { rotator.isActive(on: $0) } }
        } else {
            active = state.rotators
        }
        self.init(state: state, activeRotators: active)
    }

    var waitingCount: Int {
        expectedPrograms.filter { $0.status == .waiting }.count
    }

    var readyCount: Int {
        expectedPrograms.count - waitingCount
    }

    var allIn: Bool {
        !expectedPrograms.isEmpty && waitingCount == 0
    }

    var metricValue: String {
        expectedPrograms.isEmpty ? "\(additionalReviewedSources)" : "\(readyCount)/\(expectedPrograms.count)"
    }

    var summaryText: String {
        if expectedPrograms.isEmpty {
            return "\(additionalReviewedSources) reviewed source\(additionalReviewedSources == 1 ? "" : "s") on file."
        }
        if allIn {
            return "All expected source programs have reviewed sources or roster data."
        }
        return "\(waitingCount) expected source program\(waitingCount == 1 ? "" : "s") still missing."
    }

    private static func uniquePrograms(_ programs: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in programs {
            let program = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = programKey(program)
            guard !program.isEmpty, !seen.contains(key) else { continue }
            seen.insert(key)
            out.append(program)
        }
        return out.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private static func programKey(_ program: String?) -> String {
        (program ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

struct SourceProgramReadiness: Identifiable {
    enum Status {
        case reviewed
        case dataPresent
        case waiting
    }

    let program: String
    let status: Status
    let detail: String

    var id: String { program.lowercased() }

    var symbol: String {
        switch status {
        case .reviewed:
            return "checkmark.circle.fill"
        case .dataPresent:
            return "circle.lefthalf.filled"
        case .waiting:
            return "clock.badge.exclamationmark"
        }
    }

    var color: Color {
        switch status {
        case .reviewed:
            return .green
        case .dataPresent:
            return .blue
        case .waiting:
            return .orange
        }
    }
}
