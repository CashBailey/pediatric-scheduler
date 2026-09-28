import SwiftUI

struct FellowsView: View {
    @EnvironmentObject var store: AppStore
    let onOpenSources: () -> Void
    let onOpenRotators: () -> Void

    @State private var selectedFellowByCheck: [String: String] = [:]
    @State private var resolvingCheckId: String?
    @State private var activeBlockOnly = true
    @State private var fellowsResolveProbeStarted = false

    var body: some View {
        if let state = store.state {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(state: state)
                    resolutionQueue(state: state)
                    fellowProfiles(state: state)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .onAppear {
                runFellowsResolveProbeIfRequested(state: state)
            }
        } else {
            StatusView(icon: "star.fill", title: "No roster loaded",
                       message: "The backend is ready, but no scheduler state was returned.")
        }
    }

    private func header(state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Fellows")
                        .font(.title2)
                        .bold()
                    HStack(spacing: 12) {
                        Label("\(fellows(in: state).count) fellows", systemImage: "star.fill")
                        Label("\(pendingChecks.count) pending picks", systemImage: "checklist")
                        if activeBlockOnly, hiddenFellowCount(state) > 0 {
                            Label("\(hiddenFellowCount(state)) outside block hidden", systemImage: "eye.slash")
                        }
                        if let block = state.activeBlock {
                            Label(block.name, systemImage: "calendar")
                        }
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                Toggle("Active block only", isOn: $activeBlockOnly)
                    .toggleStyle(.checkbox)
                    .disabled(state.activeBlock == nil)

                Button {
                    onOpenSources()
                } label: {
                    Label("Import Fellow Source", systemImage: "tray.and.arrow.down")
                }

                Button {
                    onOpenRotators()
                } label: {
                    Label("Edit Profiles", systemImage: "slider.horizontal.3")
                }
            }

            if let message = store.lastMessage, !message.isEmpty {
                Label(message, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func resolutionQueue(state: SchedulerState) -> some View {
        FellowsSection(title: "Draft Picks", symbol: "checklist") {
            if pendingChecks.isEmpty {
                EmptyStateLine(text: "No fellow picks pending.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(pendingChecks) { check in
                        FellowResolutionRow(
                            check: check,
                            candidates: candidateFellows(for: check, state: state),
                            selectedFellowId: binding(for: check, state: state),
                            isResolving: resolvingCheckId == check.id,
                            isAnyResolving: resolvingCheckId != nil,
                            onResolve: { resolve(check: check, rotatorId: $0) }
                        )
                    }
                }
            }
        }
    }

    private func fellowProfiles(state: SchedulerState) -> some View {
        FellowsSection(title: "Fellow Profiles", symbol: "person.text.rectangle") {
            let visibleFellows = fellows(in: state)
            if visibleFellows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    EmptyStateLine(text: emptyFellowsMessage(in: state))
                    HStack {
                        if activeBlockOnly, hiddenFellowCount(state) > 0 {
                            Button {
                                activeBlockOnly = false
                            } label: {
                                Label("Show All Fellows", systemImage: "eye")
                            }
                        }
                        Button {
                            onOpenSources()
                        } label: {
                            Label("Import Fellow Source", systemImage: "tray.and.arrow.down")
                        }
                        Button {
                            onOpenRotators()
                        } label: {
                            Label("Add Fellow", systemImage: "plus")
                        }
                    }
                }
            } else {
                let inpatientDayCounts = inpatientDayCountsByRotator(state: state)
                let outpatientDayCounts = outpatientDayCountsByRotator(state: state)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12)], spacing: 12) {
                    ForEach(visibleFellows) { fellow in
                        FellowProfileCard(
                            fellow: fellow,
                            inpatientDays: inpatientDayCounts[fellow.id] ?? 0,
                            outpatientDays: outpatientDayCounts[fellow.id] ?? 0,
                            onEdit: onOpenRotators
                        )
                    }
                }
            }
        }
    }

    private var pendingChecks: [DraftReportCheck] {
        store.lastDraftReport?.checks.filter { $0.checkId == "fellow-blank-candidates" } ?? []
    }

    private func fellows(in state: SchedulerState) -> [Rotator] {
        let allFellows = sortedFellows(state)
        guard activeBlockOnly, let block = state.activeBlock else { return allFellows }
        return allFellows.filter { isActive($0, during: block) }
    }

    private func sortedFellows(_ state: SchedulerState) -> [Rotator] {
        state.rotators
            .filter(\.isPediatricNeurologyFellow)
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    private func candidateFellows(for check: DraftReportCheck, state: SchedulerState) -> [Rotator] {
        let fellowPool = fellows(in: state)
        guard !check.candidates.isEmpty else { return fellowPool }
        let candidateNames = Set(check.candidates.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        let matched = fellowPool.filter { fellow in
            let labels = [
                fellow.label,
                fellow.fullName ?? "",
                fellow.displayName ?? "",
            ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            return labels.contains { candidateNames.contains($0) }
        }
        return matched.isEmpty ? fellowPool : matched
    }

    private func binding(for check: DraftReportCheck, state: SchedulerState) -> Binding<String> {
        Binding(
            get: {
                let candidates = candidateFellows(for: check, state: state)
                if let selected = selectedFellowByCheck[check.id],
                   candidates.contains(where: { $0.id == selected }) {
                    return selected
                }
                return candidates.first?.id ?? ""
            },
            set: { selectedFellowByCheck[check.id] = $0 }
        )
    }

    private func isActive(_ fellow: Rotator, during block: ServiceBlock) -> Bool {
        (fellow.segments ?? []).contains { segment in
            segment.start <= block.endDate && block.startDate <= segment.end
        }
    }

    private func hiddenFellowCount(_ state: SchedulerState) -> Int {
        guard activeBlockOnly, state.activeBlock != nil else { return 0 }
        return max(0, sortedFellows(state).count - fellows(in: state).count)
    }

    private func emptyFellowsMessage(in state: SchedulerState) -> String {
        if activeBlockOnly, hiddenFellowCount(state) > 0 {
            return "No fellows active in this block."
        }
        return "No fellows in the roster."
    }

    /// Precomputed once per render (not per fellow card) so the profiles grid
    /// doesn't rescan the full inpatient assignment list once per fellow.
    private func inpatientDayCountsByRotator(state: SchedulerState) -> [String: Int] {
        guard let block = state.activeBlock else { return [:] }
        let grouped = Dictionary(grouping: state.inpatientAssignments.filter {
            $0.role != "Off" && block.startDate <= $0.date && $0.date <= block.endDate
        }, by: \.rotatorId)
        return grouped.mapValues { Set($0.map(\.date)).count }
    }

    /// Precomputed once per render (not per fellow card) so the profiles grid
    /// doesn't rescan the full outpatient session list once per fellow.
    private func outpatientDayCountsByRotator(state: SchedulerState) -> [String: Int] {
        guard let block = state.activeBlock else { return [:] }
        let grouped = Dictionary(grouping: state.outpatientSessions.filter {
            $0.rotatorId != nil && block.startDate <= $0.date && $0.date <= block.endDate
        }, by: { $0.rotatorId! })
        return grouped.mapValues { Set($0.map(\.date)).count }
    }

    private func resolve(check: DraftReportCheck, rotatorId: String) {
        guard !rotatorId.isEmpty, resolvingCheckId == nil else { return }
        let dates = check.dates
        guard !dates.isEmpty else { return }
        resolvingCheckId = check.id
        Task {
            let ok = await store.run(
                "inpatient.fellow.resolve",
                input: [
                    "rotatorRef": rotatorId,
                    "dates": dates,
                    "role": "Fellow",
                ]
            )
            if ok {
                // Drop only the resolved check — other pending fellow picks
                // must stay visible.
                store.removeDraftCheck(id: check.id)
            }
            resolvingCheckId = nil
        }
    }

    private func runFellowsResolveProbeIfRequested(state: SchedulerState) {
        guard FellowsResolveProbe.isRequested, !fellowsResolveProbeStarted else { return }
        fellowsResolveProbeStarted = true
        Task {
            await runFellowsResolveProbe(initialState: state)
        }
    }

    private func runFellowsResolveProbe(initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetBlockId = "block-fellows-resolve-2027"
        let targetRotatorId = "rot-fellows-resolve-1"
        let expectedCandidates = ["Coordinator", "Eden"]
        let initialAssignmentCount = initialState.inpatientAssignments.count

        func writeFailure(_ message: String, draftCheck: DraftReportCheck? = nil) {
            FellowsResolveProbe.write([
                "ok": false,
                "screen": "Fellows",
                "blockId": initialState.activeBlockId,
                "targetBlockId": targetBlockId,
                "targetRotatorId": targetRotatorId,
                "message": message,
                "candidateNames": draftCheck?.candidates ?? [],
                "dates": draftCheck?.dates ?? [],
                "initialAssignmentCount": initialAssignmentCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let generated = await store.run("draft.generate")
        guard generated, let report = store.lastDraftReport, let draftedState = store.state else {
            writeFailure("Draft generation did not produce a decoded draft report.")
            return
        }
        guard let check = report.checks.first(where: { $0.checkId == "fellow-blank-candidates" }) else {
            writeFailure("Draft report did not include a fellow candidate check.")
            return
        }
        let candidateNames = check.candidates
        let dates = check.dates
        guard !dates.isEmpty else {
            writeFailure("Fellow candidate check did not include dates.", draftCheck: check)
            return
        }

        selectedFellowByCheck[check.id] = targetRotatorId
        resolvingCheckId = check.id
        let resolved = await store.run(
            "inpatient.fellow.resolve",
            input: [
                "rotatorRef": targetRotatorId,
                "dates": dates,
                "role": "Fellow",
            ]
        )
        if resolved {
            store.clearDraftReport()
        }
        resolvingCheckId = nil

        guard resolved, let finalState = store.state else {
            writeFailure("Fellow resolve command failed.", draftCheck: check)
            return
        }

        let assignments = finalState.inpatientAssignments.filter {
            $0.rotatorId == targetRotatorId && $0.role == "Fellow" && dates.contains($0.date)
        }
        let assignmentDates = assignments.map(\.date).sorted()
        let sourceValues = Array(Set(assignments.compactMap(\.source))).sorted()
        let afterDraftAssignmentCount = draftedState.inpatientAssignments.count
        let afterResolveAssignmentCount = finalState.inpatientAssignments.count
        let draftReportCleared = store.lastDraftReport == nil

        FellowsResolveProbe.write([
            "ok": draftedState.activeBlockId == targetBlockId
                && finalState.activeBlockId == targetBlockId
                && Set(candidateNames) == Set(expectedCandidates)
                && assignmentDates == dates.sorted()
                && sourceValues == ["Manual"]
                && afterDraftAssignmentCount == initialAssignmentCount
                && afterResolveAssignmentCount == initialAssignmentCount + dates.count
                && draftReportCleared,
            "screen": "Fellows",
            "blockId": finalState.activeBlockId,
            "blockName": finalState.activeBlock?.name ?? "",
            "targetRotatorId": targetRotatorId,
            "candidateNames": candidateNames,
            "dates": dates,
            "assignmentDates": assignmentDates,
            "sourceValues": sourceValues,
            "initialAssignmentCount": initialAssignmentCount,
            "afterDraftAssignmentCount": afterDraftAssignmentCount,
            "afterResolveAssignmentCount": afterResolveAssignmentCount,
            "resolvedAssignmentCount": assignments.count,
            "draftReportCleared": draftReportCleared,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }
}

private enum FellowsResolveProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_FELLOWS_RESOLVE_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-fellows-resolve.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Fellows resolve probe: \(error.localizedDescription)")
        }
    }
}

/// Fellows' section wrapper — same visual convention as Dashboard's
/// DashboardSection, extracted to SharedComponents.swift as SectionContainer.
private struct FellowsSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        SectionContainer(title: title, symbol: symbol, content: content)
    }
}

private struct FellowResolutionRow: View {
    let check: DraftReportCheck
    let candidates: [Rotator]
    @Binding var selectedFellowId: String
    let isResolving: Bool
    let isAnyResolving: Bool
    let onResolve: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "star.circle.fill")
                    .foregroundStyle(.yellow)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 4) {
                    Text(check.message)
                        .font(.callout.bold())
                        .lineLimit(3)
                    FlexibleWrap(spacing: 6) {
                        ForEach(check.dates, id: \.self) { date in
                            Text(date)
                                .font(.caption.monospacedDigit())
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(Color.secondary.opacity(0.1), in: Capsule())
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                Picker("Fellow", selection: $selectedFellowId) {
                    ForEach(candidates) { fellow in
                        Text(fellow.label).tag(fellow.id)
                    }
                }
                .frame(maxWidth: 260)
                .disabled(candidates.isEmpty || isAnyResolving)

                Button {
                    onResolve(selectedFellowId)
                } label: {
                    if isResolving {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Assigning")
                        }
                    } else {
                        Label("Assign Fellow", systemImage: "checkmark.circle")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(candidates.isEmpty || selectedFellowId.isEmpty || isAnyResolving)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct FellowProfileCard: View {
    let fellow: Rotator
    let inpatientDays: Int
    let outpatientDays: Int
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(fellow.label, systemImage: "star.fill")
                    .font(.headline)
                Spacer()
                Button {
                    onEdit()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .buttonStyle(.borderless)
            }

            Text(fellow.level?.lowercased() == "fellow"
                 ? "Fellow · \(fellow.program ?? "Program")"
                 : "Fellow · \(fellow.program ?? "Program") · \(fellow.level ?? "Level")")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                CountBadge(text: "\(inpatientDays) IP", color: .blue)
                CountBadge(text: "\(outpatientDays) OP", color: .green)
            }

            if let continuity = fellow.continuityClinic, !continuity.isEmpty {
                Label(continuity, systemImage: "stethoscope")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let dayOff = fellow.dayOff, !dayOff.isEmpty {
                Label(dayOff.joined(separator: ", "), systemImage: "calendar.badge.minus")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let ranges = fellow.unavailableRanges, !ranges.isEmpty {
                ForEach(Array(ranges.enumerated()), id: \.offset) { _, range in
                    Label(range.summary, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }

            if let segments = fellow.segments, !segments.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                        Text(segment.summary)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}

private extension RotatorSegment {
    var summary: String {
        "\(start) to \(end) - \(defaultPhaseTitle)"
    }

    var defaultPhaseTitle: String {
        switch defaultPhase {
        case "inpatient":
            return "IP first"
        case "outpatient":
            return "OP first"
        default:
            return "No template"
        }
    }
}

private extension UnavailableRange {
    var summary: String {
        if let label, !label.isEmpty {
            return "\(start) to \(end) - \(label)"
        }
        return "\(start) to \(end)"
    }
}
