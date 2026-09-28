import SwiftUI

struct InpatientView: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedDate = ""
    @State private var selectedRotatorId = ""
    @State private var selectedRole: InpatientRoleOption = .resident
    @State private var customRole = ""
    @State private var isAssigning = false
    @State private var isDrafting = false
    @State private var isRunningMethodistAuto = false
    @State private var removingAssignmentId: String?
    @State private var inpatientEditProbeStarted = false
    @State private var methodistAutoProbeStarted = false

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            HStack(spacing: 0) {
                editor(block: block, state: state)
                Divider()
                VStack(alignment: .leading, spacing: 0) {
                    header(block, state: state)
                    Divider()
                    if let report = store.lastDraftReport {
                        DraftReportPanel(report: report, onSetRotationStart: { check in
                            guard let rotatorId = check.rotatorId else { return }
                            store.scheduleFocus = ScheduleFocus(rotatorId: rotatorId, title: "Set rotation start")
                        }) {
                            store.clearDraftReport()
                        }
                        .padding()
                        Divider()
                    }
                    dayList(block, state: state)
                }
            }
            .onAppear {
                syncDefaults(block: block, state: state)
                runInpatientEditProbeIfRequested(block: block, state: state)
                runMethodistAutoProbeIfRequested(block: block, state: state)
            }
            .onChange(of: block.id) { _ in syncDefaults(block: block, state: state) }
            .onChange(of: state.rotators.map(\.id)) { _ in ensureSelection(state: state) }
        } else {
            StatusView(icon: "bed.double", title: "No active block",
                       message: "Create or import a rotation block to see the inpatient schedule.")
        }
    }

    private func editor(block: ServiceBlock, state: SchedulerState) -> some View {
        let currentAssignments = assignments(on: selectedDate, state: state)
        let target = selectedDate.isEmpty ? 0 : block.inpatientCoverageTarget(on: selectedDate)
        let rotatorChoices = assignableRotators(on: selectedDate, state: state)
        let validationMessage = inpatientValidationMessage(block: block, state: state)
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Inpatient").font(.title2).bold()
                    Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Picker("Date", selection: $selectedDate) {
                    ForEach(CalendarUtil.dateRange(block.startDate, block.endDate), id: \.self) { day in
                        Text(CalendarUtil.dayLabel(day)).tag(day)
                    }
                }
                .onChange(of: selectedDate) { _ in ensureSelection(state: state) }

                HStack(spacing: 8) {
                    Label("\(currentAssignments.count)/\(target)", systemImage: currentAssignments.count < target ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(currentAssignments.count < target ? .orange : .green)
                    Text("coverage")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)

                Picker("Rotator", selection: $selectedRotatorId) {
                    ForEach(rotatorChoices) { rotator in
                        Text(rotator.label).tag(rotator.id)
                    }
                }
                .onChange(of: selectedRotatorId) { _ in syncRoleFromSelection(state: state) }
                if rotatorChoices.isEmpty {
                    Label("No active rotators on this date.", systemImage: "person.crop.circle.badge.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                Picker("Role", selection: $selectedRole) {
                    ForEach(InpatientRoleOption.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }

                if selectedRole == .custom {
                    TextField("Custom role", text: $customRole)
                        .textFieldStyle(.roundedBorder)
                }

                selectedRotatorContext(state: state)
                if let validationMessage {
                    Label(validationMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                Button {
                    assignInpatient()
                } label: {
                    if isAssigning {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Assigning")
                        }
                    } else {
                        Label("Assign", systemImage: "bed.double")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isAssigning || validationMessage != nil)

                if let message = store.lastMessage, !message.isEmpty {
                    Label(message, systemImage: "info.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                Spacer(minLength: 0)
            }
            .padding()
            .frame(width: 320, alignment: .topLeading)
        }
        .frame(width: 320, alignment: .topLeading)
    }

    private func header(_ block: ServiceBlock, state: SchedulerState) -> some View {
        let ipDays = Set(state.inpatientAssignments.filter { !$0.isOff }.map { $0.date })
        let methodistCount = state.rotators.filter { $0.schoolType == "methodist" }.count
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(block.name).font(.title2).bold()
                Spacer(minLength: 12)
                if methodistCount > 0 {
                    Button {
                        generateMethodist()
                    } label: {
                        if isRunningMethodistAuto {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Generating")
                            }
                        } else {
                            Label("Methodist 14/14", systemImage: "building.2")
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isRunningMethodistAuto || isDrafting)
                    .help("Generate Methodist 14/14 assignments")
                }
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
                .disabled(isDrafting)
            }
            HStack(spacing: 16) {
                Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                Label("\(state.rotators.count) rotators", systemImage: "person.3")
                Label("\(ipDays.count) staffed days", systemImage: "bed.double")
                if let maxc = state.rules?.maxConsecutiveInpatientDays {
                    Label("max \(maxc) consecutive", systemImage: "gauge.with.needle")
                }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            if let message = store.lastMessage, !message.isEmpty {
                Label(message, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func dayList(_ block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        let assignmentsByDate = Dictionary(grouping: state.inpatientAssignments.filter { !$0.isOff }, by: \.date)
            .mapValues { $0.sorted { $0.rotatorId < $1.rotatorId } }
        let factsByDate = Dictionary(grouping: state.halfDayFacts ?? [], by: \.date)
            .mapValues { facts in
                facts.sorted {
                    if $0.period != $1.period { return $0.period < $1.period }
                    if $0.rotatorId != $1.rotatorId { return $0.rotatorId < $1.rotatorId }
                    return $0.displayLabel < $1.displayLabel
                }
            }
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(dates, id: \.self) { date in
                        DayRow(
                            date: date,
                            assignments: assignmentsByDate[date] ?? [],
                            halfDayFacts: factsByDate[date] ?? [],
                            target: block.inpatientCoverageTarget(on: date),
                            rotatorLabel: state.rotatorLabel,
                            focus: store.scheduleFocus,
                            isSelected: selectedDate == date,
                            removingAssignmentId: removingAssignmentId,
                            onSelect: { selectedDate = date },
                            onDelete: { deleteAssignment($0) }
                        )
                        .id(date)
                        Divider()
                    }
                }
                .padding(.vertical, 4)
            }
            .onAppear {
                applyFocus(block: block)
                ensureSelection(state: state)
                scrollToFocus(proxy: proxy, block: block)
            }
            .onChange(of: store.scheduleFocus) { _ in
                applyFocus(block: block)
                ensureSelection(state: state)
                scrollToFocus(proxy: proxy, block: block)
            }
        }
    }

    private func syncDefaults(block: ServiceBlock, state: SchedulerState) {
        if !applyFocus(block: block) && (selectedDate.isEmpty || selectedDate < block.startDate || selectedDate > block.endDate) {
            selectedDate = block.startDate
        }
        ensureSelection(state: state)
        syncRoleFromSelection(state: state)
    }

    private func ensureSelection(state: SchedulerState) {
        let choices = assignableRotators(on: selectedDate, state: state)
        if selectedRotatorId.isEmpty || !choices.contains(where: { $0.id == selectedRotatorId }) {
            selectedRotatorId = choices.first?.id ?? ""
        }
    }

    @discardableResult
    private func applyFocus(block: ServiceBlock) -> Bool {
        guard let focus = store.scheduleFocus,
              focus.target == .inpatient,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return false }
        selectedDate = focus.date
        if let rotatorId = focus.rotatorId {
            selectedRotatorId = rotatorId
        }
        return true
    }

    private func scrollToFocus(proxy: ScrollViewProxy, block: ServiceBlock) {
        guard let focus = store.scheduleFocus,
              focus.target == .inpatient,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(focus.date, anchor: .center)
        }
    }

    private func assignments(on date: String, state: SchedulerState) -> [InpatientAssignment] {
        state.inpatientAssignments
            .filter { $0.date == date && !$0.isOff }
            .sorted { $0.rotatorId < $1.rotatorId }
    }

    private func assignableRotators(on date: String, state: SchedulerState) -> [Rotator] {
        let sorted = state.rotators.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        guard !date.isEmpty else { return [] }
        return sorted.filter { $0.isActive(on: date) }
    }

    private func inpatientValidationMessage(block: ServiceBlock, state: SchedulerState) -> String? {
        guard !selectedDate.isEmpty else { return "Pick a date." }
        guard block.startDate <= selectedDate, selectedDate <= block.endDate else {
            return "Pick a date in the active block."
        }
        let choices = assignableRotators(on: selectedDate, state: state)
        guard !choices.isEmpty else { return "No active rotators on this date." }
        guard let rotator = state.rotator(selectedRotatorId) else { return "Pick an active rotator." }
        guard choices.contains(where: { $0.id == rotator.id }) else {
            return "\(rotator.label) is not active on \(selectedDate)."
        }
        if availabilityWarning(rotator: rotator) {
            return "\(rotator.label) is unavailable on \(selectedDate)."
        }
        guard !roleText.isEmpty else { return "Enter a role." }
        return nil
    }

    private var roleText: String {
        selectedRole == .custom
            ? customRole.trimmingCharacters(in: .whitespacesAndNewlines)
            : selectedRole.title
    }

    private func syncRoleFromSelection(state: SchedulerState) {
        guard let rotator = state.rotator(selectedRotatorId) else { return }
        if rotator.isPediatricNeurologyFellow {
            selectedRole = .fellow
        } else if (rotator.role ?? "").localizedCaseInsensitiveContains("student") {
            selectedRole = .student
        } else if selectedRole != .custom {
            selectedRole = .resident
        }
    }

    @ViewBuilder
    private func selectedRotatorContext(state: SchedulerState) -> some View {
        if let rotator = state.rotator(selectedRotatorId) {
            VStack(alignment: .leading, spacing: 6) {
                Label(rotator.label, systemImage: rotator.isPediatricNeurologyFellow ? "star.fill" : "person")
                    .font(.callout.bold())
                Text("\(rotator.program ?? "Program") - \(rotator.level ?? "Level")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let continuity = rotator.continuityClinic, !continuity.isEmpty {
                    Label(continuity, systemImage: "stethoscope")
                        .font(.caption)
                        .foregroundStyle(continuityWarning(rotator: rotator) ? .orange : .secondary)
                }
                if availabilityWarning(rotator: rotator) {
                    Label("Unavailable on selected date", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
            .padding(8)
            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func continuityWarning(rotator: Rotator) -> Bool {
        guard let continuity = rotator.continuityClinic, !continuity.isEmpty else { return false }
        return continuity.localizedCaseInsensitiveContains(CalendarUtil.weekdayName(selectedDate))
    }

    private func availabilityWarning(rotator: Rotator) -> Bool {
        let weekday = CalendarUtil.weekdayName(selectedDate)
        if rotator.dayOff?.contains(weekday) == true {
            return true
        }
        return (rotator.unavailableRanges ?? []).contains { range in
            range.start <= selectedDate && selectedDate <= range.end
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

    private func generateMethodist() {
        guard !isRunningMethodistAuto else { return }
        isRunningMethodistAuto = true
        Task {
            await store.run("methodist.auto")
            isRunningMethodistAuto = false
        }
    }

    private func assignInpatient() {
        guard !isAssigning, !selectedRotatorId.isEmpty, !selectedDate.isEmpty, !roleText.isEmpty else { return }
        isAssigning = true
        Task {
            await store.run(
                "inpatient.assign",
                input: [
                    "blockRef": store.state?.activeBlock?.id ?? "",
                    "rotatorRef": selectedRotatorId,
                    "date": selectedDate,
                    "role": roleText,
                ]
            )
            isAssigning = false
        }
    }

    private func deleteAssignment(_ assignment: InpatientAssignment) {
        guard removingAssignmentId == nil else { return }
        removingAssignmentId = assignment.id
        Task {
            await store.run("inpatient.delete", input: ["assignmentRef": assignment.id])
            removingAssignmentId = nil
        }
    }

    private func runInpatientEditProbeIfRequested(block: ServiceBlock, state: SchedulerState) {
        guard InpatientEditProbe.isRequested, !inpatientEditProbeStarted else { return }
        inpatientEditProbeStarted = true
        Task {
            await runInpatientEditProbe(block: block, initialState: state)
        }
    }

    private func runInpatientEditProbe(block: ServiceBlock, initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetDate = "2026-12-08"
        let targetRotatorId = "rot-inpatient-edit-1"
        let targetRole = "Team senior"
        let initialAssignmentCount = initialState.inpatientAssignments.count

        func writeFailure(_ message: String) {
            InpatientEditProbe.write([
                "ok": false,
                "screen": "Inpatient",
                "blockId": block.id,
                "targetDate": targetDate,
                "targetRotatorId": targetRotatorId,
                "targetRole": targetRole,
                "message": message,
                "initialAssignmentCount": initialAssignmentCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let assigned = await store.run(
            "inpatient.assign",
            input: [
                "blockRef": block.id,
                "rotatorRef": targetRotatorId,
                "date": targetDate,
                "role": targetRole,
            ]
        )
        guard assigned, let assignedState = store.state else {
            writeFailure("Inpatient assign command failed.")
            return
        }
        guard let assignment = assignedState.inpatientAssignments.first(where: {
            $0.date == targetDate && $0.rotatorId == targetRotatorId && $0.role == targetRole
        }) else {
            writeFailure("Assigned inpatient assignment was not found in state.")
            return
        }

        let afterAssignCount = assignedState.inpatientAssignments.count
        let deleted = await store.run("inpatient.delete", input: ["assignmentRef": assignment.id])
        guard deleted, let finalState = store.state else {
            writeFailure("Inpatient delete command failed.")
            return
        }
        let afterDeleteCount = finalState.inpatientAssignments.count
        let assignmentStillPresent = finalState.inpatientAssignments.contains { $0.id == assignment.id }

        selectedDate = targetDate
        selectedRotatorId = targetRotatorId
        selectedRole = .teamSenior
        customRole = ""

        InpatientEditProbe.write([
            "ok": assignedState.activeBlockId == block.id
                && finalState.activeBlockId == block.id
                && afterAssignCount == initialAssignmentCount + 1
                && afterDeleteCount == initialAssignmentCount
                && !assignmentStillPresent
                && assignment.date == targetDate
                && assignment.rotatorId == targetRotatorId
                && assignment.role == targetRole
                && assignment.source == "Manual",
            "screen": "Inpatient",
            "blockId": block.id,
            "blockName": block.name,
            "targetDate": targetDate,
            "targetRotatorId": targetRotatorId,
            "targetRole": targetRole,
            "assignmentId": assignment.id,
            "source": assignment.source ?? "",
            "initialAssignmentCount": initialAssignmentCount,
            "afterAssignCount": afterAssignCount,
            "afterDeleteCount": afterDeleteCount,
            "assignmentStillPresent": assignmentStillPresent,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }

    private func runMethodistAutoProbeIfRequested(block: ServiceBlock, state: SchedulerState) {
        guard MethodistAutoProbe.isRequested, !methodistAutoProbeStarted else { return }
        methodistAutoProbeStarted = true
        Task {
            await runMethodistAutoProbe(block: block, initialState: state)
        }
    }

    private func runMethodistAutoProbe(block: ServiceBlock, initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetRotatorId = "rot-methodist-auto-1"
        let initialInpatientCount = methodistInpatientCount(initialState, rotatorId: targetRotatorId)
        let initialOutpatientCount = methodistOutpatientCount(initialState, rotatorId: targetRotatorId)

        func writeFailure(_ message: String) {
            MethodistAutoProbe.write([
                "ok": false,
                "screen": "Inpatient",
                "blockId": block.id,
                "targetRotatorId": targetRotatorId,
                "message": message,
                "initialInpatientCount": initialInpatientCount,
                "initialOutpatientCount": initialOutpatientCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let generated = await store.run("methodist.auto", input: ["blockRef": block.id])
        guard generated, let generatedState = store.state else {
            writeFailure("Methodist auto command failed.")
            return
        }
        let afterGenerateInpatientCount = methodistInpatientCount(generatedState, rotatorId: targetRotatorId)
        let afterGenerateOutpatientCount = methodistOutpatientCount(generatedState, rotatorId: targetRotatorId)
        let generatedStartSide = generatedState.rotators.first { $0.id == targetRotatorId }?.methodistStartSide ?? ""

        let rerun = await store.run("methodist.auto", input: ["blockRef": block.id])
        guard rerun, let rerunState = store.state else {
            writeFailure("Methodist auto idempotency command failed.")
            return
        }
        let afterRerunInpatientCount = methodistInpatientCount(rerunState, rotatorId: targetRotatorId)
        let afterRerunOutpatientCount = methodistOutpatientCount(rerunState, rotatorId: targetRotatorId)
        let message = store.lastMessage ?? ""

        selectedDate = block.startDate
        selectedRotatorId = targetRotatorId
        selectedRole = .resident
        customRole = ""

        MethodistAutoProbe.write([
            "ok": generatedState.activeBlockId == block.id
                && rerunState.activeBlockId == block.id
                && initialInpatientCount == 0
                && initialOutpatientCount == 0
                && afterGenerateInpatientCount == 14
                && afterGenerateOutpatientCount == 18
                && afterRerunInpatientCount == afterGenerateInpatientCount
                && afterRerunOutpatientCount == afterGenerateOutpatientCount
                && generatedStartSide == "outpatient",
            "screen": "Inpatient",
            "blockId": block.id,
            "blockName": block.name,
            "targetRotatorId": targetRotatorId,
            "methodistStartSide": generatedStartSide,
            "initialInpatientCount": initialInpatientCount,
            "initialOutpatientCount": initialOutpatientCount,
            "afterGenerateInpatientCount": afterGenerateInpatientCount,
            "afterGenerateOutpatientCount": afterGenerateOutpatientCount,
            "afterRerunInpatientCount": afterRerunInpatientCount,
            "afterRerunOutpatientCount": afterRerunOutpatientCount,
            "idempotentMessage": message,
            "lastMessage": message,
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }

    private func methodistInpatientCount(_ state: SchedulerState, rotatorId: String) -> Int {
        state.inpatientAssignments.filter {
            $0.rotatorId == rotatorId && $0.source == "Auto-Methodist"
        }.count
    }

    private func methodistOutpatientCount(_ state: SchedulerState, rotatorId: String) -> Int {
        state.outpatientSessions.filter {
            $0.rotatorId == rotatorId && $0.source == "Auto-Methodist"
        }.count
    }
}

private enum InpatientEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_INPATIENT_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-inpatient-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Inpatient edit probe: \(error.localizedDescription)")
        }
    }
}

private enum MethodistAutoProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_METHODIST_AUTO_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_METHODIST_AUTO_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-methodist-auto.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Methodist auto probe: \(error.localizedDescription)")
        }
    }
}

private struct DayRow: View {
    let date: String
    let assignments: [InpatientAssignment]
    let halfDayFacts: [HalfDayFact]
    let target: Int
    let rotatorLabel: (String) -> String
    let focus: ScheduleFocus?
    let isSelected: Bool
    let removingAssignmentId: String?
    let onSelect: () -> Void
    let onDelete: (InpatientAssignment) -> Void

    private var isWeekend: Bool { CalendarUtil.isWeekend(date) }
    private var below: Bool { assignments.count < target }
    private var isFocused: Bool { focus?.isFocusedDay(date, on: .inpatient) == true }

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(CalendarUtil.dayLabel(date))
                        .font(.system(.body, design: .rounded)).bold()
                        .foregroundStyle(isWeekend ? .secondary : .primary)
                    HStack(spacing: 4) {
                        Image(systemName: below ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(below ? .orange : .green)
                            .font(.caption2)
                        Text("\(assignments.count)/\(target)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 120, alignment: .leading)

                if assignments.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        EmptyStateLine(text: "No inpatient coverage", color: .orange)
                            .padding(.top, 2)
                        if !halfDayFacts.isEmpty {
                            HalfDayFactBadges(
                                facts: halfDayFacts,
                                includeRotator: true,
                                rotatorLabel: rotatorLabel
                            )
                        }
                    }
                } else {
                    FlowChips(
                        assignments: assignments,
                        halfDayFacts: halfDayFacts,
                        rotatorLabel: rotatorLabel,
                        focus: focus,
                        removingAssignmentId: removingAssignmentId,
                        onDelete: onDelete
                    )
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var rowBackground: Color {
        if isFocused {
            return Color.accentColor.opacity(0.12)
        }
        if isSelected {
            return Color.accentColor.opacity(0.08)
        }
        return isWeekend ? Color.secondary.opacity(0.06) : Color.clear
    }
}

/// Simple wrapping row of assignee chips.
private struct FlowChips: View {
    let assignments: [InpatientAssignment]
    let halfDayFacts: [HalfDayFact]
    let rotatorLabel: (String) -> String
    let focus: ScheduleFocus?
    let removingAssignmentId: String?
    let onDelete: (InpatientAssignment) -> Void

    var body: some View {
        let assignedRotatorIds = Set(assignments.map(\.rotatorId))
        let unmatchedFacts = halfDayFacts.filter { !assignedRotatorIds.contains($0.rotatorId) }
        return VStack(alignment: .leading, spacing: 6) {
            FlexibleWrap(spacing: 6) {
                ForEach(assignments) { a in
                    AssigneeChip(
                        name: rotatorLabel(a.rotatorId),
                        role: a.role,
                        source: a.source,
                        facts: halfDayFacts.filter { $0.rotatorId == a.rotatorId },
                        isUnsafeWholeDayMapping: a.unsafeWholeDayMapping == true,
                        isFocused: focus?.matches(inpatient: a) == true,
                        isDeleting: removingAssignmentId == a.id,
                        actionsDisabled: removingAssignmentId != nil
                    ) {
                        onDelete(a)
                    }
                }
            }
            if !unmatchedFacts.isEmpty {
                HalfDayFactBadges(
                    facts: unmatchedFacts,
                    includeRotator: true,
                    rotatorLabel: rotatorLabel
                )
            }
        }
    }
}

private enum InpatientRoleOption: String, CaseIterable, Identifiable {
    case resident
    case teamSenior
    case fellow
    case amClinicPullOut
    case pmClinicPullOut
    case academicHalfDay
    case off
    case student
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .resident: return "Resident"
        case .teamSenior: return "Team senior"
        case .fellow: return "Fellow"
        case .amClinicPullOut: return "AM clinic pull-out"
        case .pmClinicPullOut: return "PM clinic pull-out"
        case .academicHalfDay: return "Academic half-day"
        case .off: return "Off"
        case .student: return "Medical Student"
        case .custom: return "Custom"
        }
    }
}

private struct AssigneeChip: View {
    let name: String
    let role: String?
    let source: String?
    let facts: [HalfDayFact]
    let isUnsafeWholeDayMapping: Bool
    let isFocused: Bool
    let isDeleting: Bool
    let actionsDisabled: Bool
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(Color.assignmentSource(source)).frame(width: 7, height: 7)
                Text(name).font(.callout)
                if let role, role != "Resident" {
                    Text(role).font(.caption2).foregroundStyle(.secondary)
                }
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    if isDeleting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "trash")
                            .font(.caption)
                    }
                }
                .buttonStyle(.borderless)
                .help("Remove assignment")
                .disabled(actionsDisabled)
            }

            if isUnsafeWholeDayMapping {
                Label("Partial-day source", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.orange)
                    .help("Imported partial-day source kept a legacy whole-day inpatient row.")
            }

            if !facts.isEmpty {
                HalfDayFactBadges(facts: facts)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(isFocused ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(isFocused ? Color.accentColor.opacity(0.55) : Color.clear, lineWidth: 1)
        )
    }
}

/// Minimal flow layout (wraps chips to available width). Uses SwiftUI's Layout
/// protocol — no third-party dependency.
struct FlexibleWrap: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth, rowWidth > 0 {
                totalHeight += rowHeight + spacing
                totalWidth = max(totalWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        totalWidth = max(totalWidth, rowWidth - spacing)
        return CGSize(width: min(totalWidth, maxWidth), height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
