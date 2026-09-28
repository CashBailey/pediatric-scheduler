import Foundation

/// Shared gating for the Methodist 14/14 setup flow. Mirrors the engine's
/// `methodist-no-start` warning predicate (shared/scheduler/program-rules.js
/// and backend_py/domain/draft.py): methodist classification falls back to
/// the program name when schoolType is absent, and "active" means a segment
/// overlaps the block window.
enum MethodistSetup {
    static func isMethodist(_ rotator: Rotator) -> Bool {
        if let schoolType = rotator.schoolType, !schoolType.isEmpty {
            return schoolType == "methodist"
        }
        return rotator.program == "Methodist"
    }

    /// Methodist rotators active in the block whose 14/14 split can't run
    /// because `rotationStartDate` is missing — the same rotators the draft
    /// report's `methodist-no-start` warning names.
    static func rotatorsMissingStart(block: ServiceBlock, state: SchedulerState) -> [Rotator] {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        return state.rotators
            .filter { rotator in
                isMethodist(rotator)
                    && (rotator.rotationStartDate ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && dates.contains { rotator.isActive(on: $0) }
            }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    /// Suggest a rotation start only when the rotator has exactly one segment
    /// overlapping the block — a clear signal, never a guess. The user still
    /// has to click the suggestion before anything is written.
    static func suggestedRotationStart(rotator: Rotator, block: ServiceBlock) -> String? {
        let overlapping = (rotator.segments ?? []).filter { segment in
            !segment.start.isEmpty && segment.start <= block.endDate && block.startDate <= segment.end
        }
        guard overlapping.count == 1, CalendarUtil.isISODate(overlapping[0].start) else { return nil }
        return overlapping[0].start
    }
}
