import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var store: AppStore
    let onOpenSources: () -> Void
    let onOpenRotators: () -> Void
    let onOpenReports: () -> Void

    @State private var isDrafting = false
    @State private var dashboardDraftProbeStarted = false

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            let summary = DashboardSummary(state: state, block: block)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(block: block, summary: summary)
                    workflowOverview(summary: summary)
                    if let report = store.lastDraftReport {
                        DraftReportPanel(report: report, onSetRotationStart: { check in
                            guard let rotatorId = check.rotatorId else { return }
                            store.scheduleFocus = ScheduleFocus(rotatorId: rotatorId, title: "Set rotation start")
                        }) {
                            store.clearDraftReport()
                        }
                    }
                    metrics(summary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 18)], spacing: 18) {
                        sourceReadiness(summary)
                        upcoming(summary)
                        attention(summary)
                    }
                    roster(summary)
                }
                .padding()
            }
            .onAppear {
                runDashboardDraftProbeIfRequested(block: block)
            }
            .onChange(of: block.id) { _ in
                runDashboardDraftProbeIfRequested(block: block)
            }
        } else {
            StatusView(icon: "gauge.with.dots.needle.33percent", title: "No active block",
                       message: "Create or import a rotation block to view dashboard metrics.")
        }
    }

    private func header(block: ServiceBlock, summary: DashboardSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(block.name)
                        .font(.title2)
                        .bold()
                    HStack(spacing: 14) {
                        Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        Label("\(summary.totalDays) days", systemImage: "number")
                        if let status = block.status, !status.isEmpty {
                            Label(status, systemImage: "circle.dotted")
                        }
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                Button {
                    generateDraft()
                } label: {
                    if isDrafting {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Generating")
                        }
                    } else {
                        Label("Generate Draft", systemImage: "wand.and.stars")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isDrafting || summary.activeRotators == 0)
                .help(summary.activeRotators == 0
                      ? "Add or import rotators before generating a draft."
                      : "Generate a draft schedule for the active block.")
            }

            if let message = store.lastMessage, !message.isEmpty {
                Label(message, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .help(message)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func workflowOverview(summary: DashboardSummary) -> some View {
        DashboardSection(title: "Workflow Overview", symbol: "list.number") {
            VStack(alignment: .leading, spacing: 12) {
                WorkflowStepRow(
                    number: 1,
                    title: "First, import the schedule data.",
                    detail: "Review uploaded source records and bring in the latest Master, inpatient, outpatient, fellow, or roster files.",
                    actionTitle: "Open Sources",
                    systemImage: "tray.and.arrow.down",
                    action: onOpenSources
                )
                WorkflowStepRow(
                    number: 2,
                    title: "Next, enter any requested days off or other constraints.",
                    detail: "Update rotator profiles, continuity clinic details, day-off weekdays, unavailable ranges, and IP/OP templates.",
                    actionTitle: "Open Rotators",
                    systemImage: "person.3",
                    action: onOpenRotators
                )
                WorkflowStepRow(
                    number: 3,
                    title: "Then, the system generates a draft schedule.",
                    detail: "Generate a draft for the active block, then review what still needs attention.",
                    actionTitle: isDrafting ? "Generating" : "Generate Draft",
                    systemImage: "wand.and.stars",
                    disabled: isDrafting || summary.activeRotators == 0,
                    showProgress: isDrafting,
                    help: summary.activeRotators == 0
                        ? "Add or import rotators before generating a draft."
                        : nil,
                    action: generateDraft
                )
                WorkflowStepRow(
                    number: 4,
                    title: "Finally, review the draft, resolve any flagged conflicts, and finalize the schedule.",
                    detail: "Use Reports for conflicts and daily review, then export the finished packet when the schedule is ready.",
                    actionTitle: "Open Reports",
                    systemImage: "doc.text.magnifyingglass",
                    action: onOpenReports
                )
            }
        }
    }

    private func metrics(_ summary: DashboardSummary) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 165), spacing: 12)], spacing: 12) {
            MetricTile(title: "Active rotators", value: "\(summary.activeRotators)", symbol: "person.3")
            MetricTile(title: "Staffed days", value: "\(summary.staffedDays)/\(summary.requiredDays)", symbol: "bed.double")
            MetricTile(title: "Open IP slots", value: "\(summary.openSlots)", symbol: "exclamationmark.triangle")
            MetricTile(title: "Outpatient", value: "\(summary.outpatientSessions)", symbol: "stethoscope")
            MetricTile(title: "Half-day facts", value: "\(summary.halfDayFacts)", symbol: "circle.lefthalf.filled")
            MetricTile(title: "Sources ready", value: summary.sourceReadiness.metricValue, symbol: "tray.and.arrow.down")
            MetricTile(title: "Fellows", value: "\(summary.fellows)", symbol: "staroflife")
            MetricTile(title: "Issues", value: "\(summary.totalIssueCount)", symbol: "flag")
        }
    }

    private func sourceReadiness(_ summary: DashboardSummary) -> some View {
        DashboardSection(title: "Source Readiness", symbol: "tray.and.arrow.down") {
            if summary.sourceReadiness.expectedPrograms.isEmpty {
                EmptyStateLine(text: "No expected source programs configured.")
            } else {
                HStack(spacing: 8) {
                    CountBadge(
                        text: summary.sourceReadiness.allIn ? "All in" : "\(summary.sourceReadiness.waitingCount) waiting",
                        color: summary.sourceReadiness.allIn ? .green : .orange
                    )
                    Text(summary.sourceReadiness.summaryText)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                }

                ForEach(summary.sourceReadiness.expectedPrograms) { item in
                    if item.status != .reviewed {
                        SourceReadinessLine(item: item, actionTitle: "Open Sources", action: { store.screenSelection = .sources })
                    } else {
                        SourceReadinessLine(item: item)
                    }
                    if item.id != summary.sourceReadiness.expectedPrograms.last?.id {
                        Divider()
                    }
                }

                if summary.sourceReadiness.additionalReviewedSources > 0 {
                    Text("\(summary.sourceReadiness.additionalReviewedSources) additional reviewed source\(summary.sourceReadiness.additionalReviewedSources == 1 ? "" : "s") outside the expected program list.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func upcoming(_ summary: DashboardSummary) -> some View {
        DashboardSection(title: "Upcoming Days", symbol: "calendar.day.timeline.left") {
            if summary.upcomingDays.isEmpty {
                EmptyStateLine(text: "No days in the active block.")
            } else {
                ForEach(summary.upcomingDays) { day in
                    DashboardDayLine(day: day)
                    if day.id != summary.upcomingDays.last?.id {
                        Divider()
                    }
                }
            }
        }
    }

    private func attention(_ summary: DashboardSummary) -> some View {
        DashboardSection(title: "Attention", symbol: "flag") {
            if summary.issues.isEmpty {
                EmptyStateLine(text: "No dashboard issues detected.")
            } else {
                ForEach(summary.issues) { issue in
                    IssueLine(issue: issue)
                    if issue.id != summary.issues.last?.id {
                        Divider()
                    }
                }
                if summary.totalIssueCount > summary.issues.count {
                    Text("+\(summary.totalIssueCount - summary.issues.count) more issue\(summary.totalIssueCount - summary.issues.count == 1 ? "" : "s") — see Reports for the full conflict list.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !summary.stateNotes.isEmpty {
                Divider()
                ForEach(summary.stateNotes, id: \.self) { note in
                    Label(note, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func roster(_ summary: DashboardSummary) -> some View {
        DashboardSection(title: "Roster Mix", symbol: "person.text.rectangle") {
            if summary.rosterGroups.isEmpty {
                EmptyStateLine(text: "No rotators in this block.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                    ForEach(summary.rosterGroups) { group in
                        HStack {
                            Text(group.name)
                                .font(.callout)
                                .lineLimit(1)
                            Spacer()
                            Text("\(group.count)")
                                .font(.callout.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
    }

    private func generateDraft() {
        guard !isDrafting else { return }
        isDrafting = true
        Task {
            await store.run("draft.generate")
            isDrafting = false
        }
    }

    private func runDashboardDraftProbeIfRequested(block: ServiceBlock) {
        guard DashboardDraftProbe.isRequested, !dashboardDraftProbeStarted else { return }
        dashboardDraftProbeStarted = true
        Task {
            await runDashboardDraftProbe(blockId: block.id)
        }
    }

    private func runDashboardDraftProbe(blockId: String) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let before = store.state
        let beforeInpatientCount = before?.inpatientAssignments.count ?? 0
        let beforeOutpatientCount = before?.outpatientSessions.count ?? 0

        let ok = await store.run("draft.generate")
        guard ok, let state = store.state else {
            DashboardDraftProbe.write([
                "ok": false,
                "screen": "Dashboard",
                "blockId": blockId,
                "startedAt": startedAt,
                "message": "Dashboard draft command failed.",
                "lastMessage": store.lastMessage ?? ""
            ])
            return
        }

        let autoDraftInpatient = state.inpatientAssignments.filter {
            ($0.source ?? "").localizedCaseInsensitiveCompare("Auto-Draft") == .orderedSame
        }
        let report = store.lastDraftReport
        DashboardDraftProbe.write([
            "ok": state.activeBlockId == blockId
                && autoDraftInpatient.count >= 5
                && report?.summary.inpatientAdded == 5
                && report?.summary.errorCount == 0,
            "screen": "Dashboard",
            "blockId": blockId,
            "blockName": state.activeBlock?.name ?? "",
            "activeBlockId": state.activeBlockId,
            "beforeInpatientCount": beforeInpatientCount,
            "afterInpatientCount": state.inpatientAssignments.count,
            "beforeOutpatientCount": beforeOutpatientCount,
            "afterOutpatientCount": state.outpatientSessions.count,
            "autoDraftInpatientCount": autoDraftInpatient.count,
            "draftReportBlockName": report?.summary.blockName ?? "",
            "draftReportInpatientAdded": report?.summary.inpatientAdded ?? 0,
            "draftReportOutpatientAdded": report?.summary.outpatientAdded ?? 0,
            "draftReportErrorCount": report?.summary.errorCount ?? 0,
            "draftReportWarningCount": report?.summary.warningCount ?? 0,
            "draftReportUnmetCount": report?.unmetCount ?? 0,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }
}

private enum DashboardDraftProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_DASHBOARD_DRAFT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-dashboard-draft.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Dashboard draft probe: \(error.localizedDescription)")
        }
    }
}

private struct WorkflowStepRow: View {
    let number: Int
    let title: String
    let detail: String
    let actionTitle: String
    let systemImage: String
    var disabled = false
    var showProgress = false
    var help: String?
    let action: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption.bold().monospacedDigit())
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.accentColor))
                .accessibilityLabel("Step \(number)")

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.callout.bold())
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            Button {
                action()
            } label: {
                if showProgress {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text(actionTitle)
                    }
                } else {
                    Label(actionTitle, systemImage: systemImage)
                }
            }
            .disabled(disabled)
            .help(help ?? "")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Dashboard's section wrapper — same visual convention as Fellows'
/// FellowsSection, extracted to SharedComponents.swift as SectionContainer.
/// Kept as a thin wrapper (rather than a bare typealias) so call sites can
/// keep using `DashboardSection(title:symbol:) { ... }` unchanged.
private struct DashboardSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        SectionContainer(title: title, symbol: symbol, innerSpacing: 8, outerVerticalPadding: 4, content: content)
    }
}

private struct MetricTile: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.title3.monospacedDigit())
                    .bold()
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding()
        .frame(minHeight: 78)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct DashboardDayLine: View {
    let day: DashboardDay

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(CalendarUtil.dayLabel(day.date))
                    .font(.callout.bold())
                Text(day.date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(width: 105, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    CountBadge(text: "\(day.inpatientCount)/\(day.target)", color: day.inpatientCount < day.target ? .orange : .green)
                    CountBadge(text: "\(day.outpatientCount) OP", color: .blue)
                    if day.halfDayFactCount > 0 {
                        CountBadge(text: "\(day.halfDayFactCount) half-day", color: .purple)
                    }
                }
                Text(day.names.isEmpty ? "No inpatient coverage" : day.names.joined(separator: ", "))
                    .font(.callout)
                    .foregroundStyle(day.names.isEmpty ? .orange : .primary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .help(day.names.joined(separator: ", "))
            }

            Spacer(minLength: 0)
        }
    }
}

private struct IssueLine: View {
    let issue: DashboardIssue

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: issue.severity == .critical ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(issue.severity == .critical ? .orange : .blue)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(issue.title)
                    .font(.callout.bold())
                    .lineLimit(2)
                Text(issue.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct DashboardSummary {
    let totalDays: Int
    let activeRotators: Int
    let fellows: Int
    let requiredDays: Int
    let staffedDays: Int
    let openSlots: Int
    let outpatientSessions: Int
    let halfDayFacts: Int
    let upcomingDays: [DashboardDay]
    let issues: [DashboardIssue]
    /// Uncapped count — `issues` holds only the first 8 for display.
    let totalIssueCount: Int
    /// State-level import caveats (e.g. Coordinator placeholder warnings) that
    /// previously had no surface anywhere in the native app.
    let stateNotes: [String]
    let rosterGroups: [RosterGroup]
    let sourceReadiness: SourceReadiness

    init(state: SchedulerState, block: ServiceBlock) {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        let active = state.rotators.filter { rotator in
            dates.contains { rotator.isActive(on: $0) }
        }
        let inpatientByDate = Dictionary(grouping: state.inpatientAssignments.filter { !$0.isOff }, by: \.date)
        let outpatientByDate = Dictionary(grouping: state.outpatientSessions, by: \.date)

        totalDays = dates.count
        activeRotators = active.count
        fellows = active.filter(\.isPediatricNeurologyFellow).count
        outpatientSessions = state.outpatientSessions.filter { $0.date >= block.startDate && $0.date <= block.endDate }.count
        halfDayFacts = (state.halfDayFacts ?? []).filter { $0.date >= block.startDate && $0.date <= block.endDate }.count

        var required = 0
        var staffed = 0
        var open = 0
        var days: [DashboardDay] = []

        for date in dates {
            let target = block.inpatientCoverageTarget(on: date)
            let inpatient = inpatientByDate[date] ?? []
            let outpatient = outpatientByDate[date] ?? []
            if target > 0 {
                required += 1
            }
            if target > 0 && inpatient.count >= target {
                staffed += 1
            }
            open += max(0, target - inpatient.count)
            days.append(
                DashboardDay(
                    date: date,
                    target: target,
                    inpatientCount: inpatient.count,
                    outpatientCount: outpatient.count,
                    halfDayFactCount: state.halfDayFactsFor(date: date).count,
                    names: inpatient.map { state.rotatorLabel($0.rotatorId) }.sorted()
                )
            )
        }

        requiredDays = required
        staffedDays = staffed
        openSlots = open
        // Show days from today forward; fall back to the block's last week
        // once it is over. Lexicographic compare is correct for yyyy-MM-dd.
        let today = CalendarUtil.todayISO()
        let futureDays = days.filter { $0.date >= today }
        upcomingDays = futureDays.isEmpty ? Array(days.suffix(7)) : Array(futureDays.prefix(7))
        let allIssues = DashboardSummary.makeIssues(
            dates: dates,
            block: block,
            state: state,
            inpatientByDate: inpatientByDate,
            outpatientByDate: outpatientByDate
        )
        totalIssueCount = allIssues.count
        issues = Array(allIssues.prefix(8))
        stateNotes = state.notes ?? []
        rosterGroups = DashboardSummary.makeRosterGroups(active)
        sourceReadiness = SourceReadiness(state: state, activeRotators: active)
    }

    private static func makeIssues(
        dates: [String],
        block: ServiceBlock,
        state: SchedulerState,
        inpatientByDate: [String: [InpatientAssignment]],
        outpatientByDate: [String: [OutpatientSession]]
    ) -> [DashboardIssue] {
        var out: [DashboardIssue] = []
        let noClinicDates = Set((block.holidays ?? []).filter { $0.noClinic == true }.map(\.date))

        for date in dates {
            let inpatient = inpatientByDate[date] ?? []
            let outpatient = outpatientByDate[date] ?? []
            let target = block.inpatientCoverageTarget(on: date)
            if target > 0 && inpatient.count < target {
                out.append(
                    DashboardIssue(
                        id: "coverage-\(date)",
                        severity: .critical,
                        title: inpatient.isEmpty ? "No inpatient coverage" : "Understaffed inpatient",
                        detail: "\(CalendarUtil.dayLabel(date)): \(inpatient.count) of \(target) assigned"
                    )
                )
            }

            let inpatientIds = Set(inpatient.map(\.rotatorId))
            let doubleBooked = outpatient.compactMap { session -> String? in
                guard let rotatorId = session.rotatorId, inpatientIds.contains(rotatorId) else { return nil }
                return state.rotatorLabel(rotatorId)
            }
            for name in Set(doubleBooked).sorted() {
                out.append(
                    DashboardIssue(
                        id: "double-\(date)-\(name)",
                        severity: .critical,
                        title: "\(name) is double-booked",
                        detail: "\(CalendarUtil.dayLabel(date)): inpatient and outpatient"
                    )
                )
            }

            if noClinicDates.contains(date), !outpatient.isEmpty {
                out.append(
                    DashboardIssue(
                        id: "closed-clinic-\(date)",
                        severity: .warning,
                        title: "Clinic scheduled on no-clinic day",
                        detail: "\(CalendarUtil.dayLabel(date)): \(outpatient.count) outpatient session\(outpatient.count == 1 ? "" : "s")"
                    )
                )
            }
        }

        return out
    }

    private static func makeRosterGroups(_ rotators: [Rotator]) -> [RosterGroup] {
        let grouped = Dictionary(grouping: rotators) { rotator in
            rotator.program?.isEmpty == false ? rotator.program! : "Unknown"
        }
        return grouped
            .map { RosterGroup(name: $0.key, count: $0.value.count) }
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
    }
}

private struct DashboardDay: Identifiable {
    let date: String
    let target: Int
    let inpatientCount: Int
    let outpatientCount: Int
    let halfDayFactCount: Int
    let names: [String]

    var id: String { date }
}

private struct DashboardIssue: Identifiable {
    enum Severity {
        case critical
        case warning
    }

    let id: String
    let severity: Severity
    let title: String
    let detail: String
}

private struct RosterGroup: Identifiable {
    let name: String
    let count: Int

    var id: String { name }
}
