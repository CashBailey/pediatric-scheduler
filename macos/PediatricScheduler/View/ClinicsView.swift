import SwiftUI
import UniformTypeIdentifiers

private let clinicAssignmentPolicyRoles = ["Resident", "Fellow", "Student"]

struct ClinicsView: View {
    @EnvironmentObject var store: AppStore
    @State private var date = ""
    @State private var period: ClinicPeriod = .am
    @State private var selectedOccurrenceId = ""
    @State private var selectedRotatorId = ""
    @State private var isAssigning = false
    @State private var removingAssignmentId: String?
    @State private var clinicsEditProbeStarted = false
    @AppStorage("clinicsWeekGrid") private var weekGridMode = true

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            HStack(spacing: 0) {
                editor(block: block, state: state)
                Divider()
                schedule(block: block, state: state)
            }
            .onAppear {
                syncDefaults(block: block, state: state)
                runClinicsEditProbeIfRequested(block: block, state: state)
            }
            .onChange(of: block.id) { _ in syncDefaults(block: block, state: state) }
            .onChange(of: date) { _ in syncSelections(block: block, state: state) }
            .onChange(of: period) { _ in syncSelections(block: block, state: state) }
            .onChange(of: state.outpatientSessions.map(\.id)) { _ in syncSelections(block: block, state: state) }
            .onChange(of: (state.clinicAssignments ?? []).map(\.id)) { _ in syncSelections(block: block, state: state) }
            .onChange(of: (state.attendings ?? []).map(\.name)) { _ in syncSelections(block: block, state: state) }
        } else {
            StatusView(icon: "cross.case", title: "No active block",
                       message: "Create or import a rotation block to place outpatient clinic assignments.")
        }
    }

    private func editor(block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = weekdayDates(block: block)
        let occurrences = selectableOccurrences(block: block, state: state)
        let selectedOccurrence = occurrences.first { $0.id == selectedOccurrenceId } ?? occurrences.first
        let eligible = withRotatorKept(
            eligibleRotators(on: date, occurrence: selectedOccurrence, state: state),
            selectedRotatorId: selectedRotatorId,
            state: state
        )
        let assignments = effectiveAssignments(state: state, block: block)
        let uncoveredCount = allOccurrences(block: block, state: state).filter { occurrence in
            assignments.filter { $0.clinicOccurrenceId == occurrence.id }.isEmpty
        }.count
        let validationMessage = clinicValidationMessage(occurrence: selectedOccurrence, assignments: assignments)

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Clinics").font(.title2).bold()
                    Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Picker("Date", selection: $date) {
                    ForEach(dates, id: \.self) { day in
                        Text("\(CalendarUtil.dayLabel(day))  \(day)").tag(day)
                    }
                }

                Picker("Period", selection: $period) {
                    ForEach(ClinicPeriod.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                Picker("Clinic", selection: $selectedOccurrenceId) {
                    ForEach(occurrences) { occurrence in
                        Text(occurrence.menuLabel).tag(occurrence.id)
                    }
                }
                .disabled(occurrences.isEmpty)

                Picker("Rotator", selection: $selectedRotatorId) {
                    ForEach(eligible) { rotator in
                        Text(rotator.label).tag(rotator.id)
                    }
                }
                .disabled(eligible.isEmpty)

                if let validationMessage {
                    Label(validationMessage.text, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }

                Button {
                    assignClinic()
                } label: {
                    if isAssigning {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Assigning")
                        }
                    } else {
                        Label("Assign", systemImage: "cross.case")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    isAssigning || selectedOccurrenceId.isEmpty || selectedRotatorId.isEmpty || date.isEmpty
                        || validationMessage?.blocking == true
                )

                VStack(alignment: .leading, spacing: 8) {
                    Label("\(occurrences.count) clinics", systemImage: "cross.case")
                    Label("\(uncoveredCount) uncovered", systemImage: "exclamationmark.circle")
                }
                .font(.callout)
                .foregroundStyle(.secondary)

                if !eligible.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Outpatient rotators — click to assign")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        ForEach(eligible) { rotator in
                            Button {
                                selectedRotatorId = rotator.id
                                assignClinic()
                            } label: {
                                Label(rotator.label, systemImage: "person.badge.plus")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(
                                isAssigning || selectedOccurrenceId.isEmpty || date.isEmpty
                                    || validationMessage?.blocking == true
                            )
                            .onDrag { NSItemProvider(object: rotator.id as NSString) }
                            .help("Click to assign to the selected clinic, or drag onto a clinic square in the week grid")
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("clinics-rotator-sidelist")
                }

                if let message = store.lastMessage, !message.isEmpty {
                    Label(message, systemImage: "info.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(width: 310, alignment: .topLeading)
    }

    private func schedule(block: ServiceBlock, state: SchedulerState) -> some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Picker("View", selection: $weekGridMode) {
                    Text("Week grid").tag(true)
                    Text("List").tag(false)
                }
                .pickerStyle(.segmented)
                .frame(width: 220)
                .accessibilityIdentifier("clinics-view-mode")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(.bar)
            Divider()
            if weekGridMode {
                weekGrid(block: block, state: state)
            } else {
                scheduleList(block: block, state: state)
            }
        }
    }

    private func weekGrid(block: ServiceBlock, state: SchedulerState) -> some View {
        // Grid dates keep holiday/no-clinic days (rendered as dark cells);
        // occurrences already exclude them, so those cells stay card-free.
        let gridDates = CalendarUtil.dateRange(block.startDate, block.endDate)
            .filter { !CalendarUtil.isWeekend($0) }
        let weeks = PosterWeeks.weekBuckets(gridDates)
        let occurrences = allOccurrences(block: block, state: state)
        let assignments = effectiveAssignments(state: state, block: block)
        let liveOccurrenceIds = Set(occurrences.map(\.id))
        let staleCount = (state.clinicAssignments ?? [])
            .filter { block.startDate <= $0.date && $0.date <= block.endDate }
            .filter { !liveOccurrenceIds.contains($0.clinicOccurrenceId) }
            .count
        let noClinicLabels = Dictionary(
            (block.holidays ?? [])
                .filter { $0.noClinic == true }
                .map { ($0.date, $0.label?.isEmpty == false ? $0.label! : "Holiday") },
            uniquingKeysWith: { first, _ in first }
        )
        return ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 14) {
                if staleCount > 0 {
                    Label(
                        "\(staleCount) assignment(s) point at deleted or renamed clinics — reassign them.",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.callout)
                    .foregroundStyle(.orange)
                }
                ForEach(Array(weeks.enumerated()), id: \.offset) { index, weekDates in
                    ClinicsWeekSection(
                        weekIndex: index,
                        dates: weekDates,
                        occurrences: occurrences,
                        assignments: assignments,
                        noClinicLabels: noClinicLabels,
                        rotatorLabel: state.rotatorLabel,
                        selectedDate: date,
                        selectedPeriod: period.rawValue,
                        onSelect: { cellDate, session, occurrenceId in
                            date = cellDate
                            if let selected = ClinicPeriod(rawValue: session) {
                                period = selected
                            }
                            if let occurrenceId {
                                selectedOccurrenceId = occurrenceId
                            }
                        },
                        onDropRotator: { rotatorId, cellDate, session, occurrenceId in
                            // Sync the editor selection to the drop target, then
                            // assign directly — backend validation is authoritative
                            // (rejections surface via the status message).
                            date = cellDate
                            if let selected = ClinicPeriod(rawValue: session) {
                                period = selected
                            }
                            selectedOccurrenceId = occurrenceId
                            selectedRotatorId = rotatorId
                            assignClinic(rotatorId: rotatorId, date: cellDate, session: session, occurrenceId: occurrenceId)
                        }
                    )
                }
            }
            .padding(16)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("clinics-week-grid")
        .background(Color.secondary.opacity(0.03))
    }

    private func scheduleList(block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = weekdayDates(block: block)
        let occurrences = allOccurrences(block: block, state: state)
        let assignments = effectiveAssignments(state: state, block: block)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        if occurrences.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("No clinic sessions", systemImage: "calendar.badge.exclamationmark")
                                    .font(.headline)
                                Text("No attending clinic slots in this block.")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                        } else {
                            ForEach(dates, id: \.self) { day in
                                ClinicsDayRow(
                                    date: day,
                                    occurrences: occurrences.filter { $0.date == day },
                                    assignments: assignments,
                                    rotatorLabel: state.rotatorLabel,
                                    focus: store.scheduleFocus,
                                    removingAssignmentId: removingAssignmentId,
                                    onDelete: { deleteAssignment($0) }
                                )
                                .id(day)
                                Divider()
                            }
                        }
                    } header: {
                        ClinicsHeader()
                    }
                }
                .frame(minWidth: 900, alignment: .topLeading)
            }
            .onAppear {
                applyFocus(block: block)
                scrollToFocus(proxy: proxy, block: block)
            }
            .onChange(of: store.scheduleFocus) { _ in
                applyFocus(block: block)
                scrollToFocus(proxy: proxy, block: block)
            }
        }
        .background(Color.secondary.opacity(0.03))
    }

    private func syncDefaults(block: ServiceBlock, state: SchedulerState) {
        let dates = weekdayDates(block: block)
        if !applyFocus(block: block) && (date.isEmpty || !dates.contains(date)) {
            date = dates.first ?? block.startDate
        }
        syncSelections(block: block, state: state)
    }

    private func syncSelections(block: ServiceBlock, state: SchedulerState) {
        let occurrences = selectableOccurrences(block: block, state: state)
        if selectedOccurrenceId.isEmpty || !occurrences.contains(where: { $0.id == selectedOccurrenceId }) {
            selectedOccurrenceId = occurrences.first?.id ?? ""
        }
        let selectedOccurrence = occurrences.first { $0.id == selectedOccurrenceId }
        let eligible = withRotatorKept(
            eligibleRotators(on: date, occurrence: selectedOccurrence, state: state),
            selectedRotatorId: selectedRotatorId,
            state: state
        )
        if selectedRotatorId.isEmpty || !eligible.contains(where: { $0.id == selectedRotatorId }) {
            selectedRotatorId = eligible.first?.id ?? ""
        }
    }

    @discardableResult
    private func applyFocus(block: ServiceBlock) -> Bool {
        guard let focus = store.scheduleFocus,
              focus.target == .clinics,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return false }
        date = focus.date
        if let period = focus.period, let focusedPeriod = ClinicPeriod(rawValue: period) {
            self.period = focusedPeriod
        }
        if let rotatorId = focus.rotatorId {
            selectedRotatorId = rotatorId
        }
        return true
    }

    private func scrollToFocus(proxy: ScrollViewProxy, block: ServiceBlock) {
        guard let focus = store.scheduleFocus,
              focus.target == .clinics,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(focus.date, anchor: .center)
        }
    }

    private func assignClinic() {
        assignClinic(
            rotatorId: selectedRotatorId,
            date: date,
            session: period.rawValue,
            occurrenceId: selectedOccurrenceId
        )
    }

    private func assignClinic(rotatorId: String, date: String, session: String, occurrenceId: String) {
        guard !isAssigning, !rotatorId.isEmpty, !date.isEmpty, !occurrenceId.isEmpty else { return }
        isAssigning = true
        let input: [String: Any] = [
            "clinicOccurrenceId": occurrenceId,
            "rotatorRef": rotatorId,
            "date": date,
            "session": session,
        ]
        Task {
            await store.run("clinic.assign", input: input)
            isAssigning = false
        }
    }

    private func deleteAssignment(_ assignment: ClinicAssignment) {
        guard removingAssignmentId == nil else { return }
        removingAssignmentId = assignment.id
        Task {
            await store.run("clinic.delete", input: ["assignmentRef": assignment.id])
            removingAssignmentId = nil
        }
    }

    private func runClinicsEditProbeIfRequested(block: ServiceBlock, state: SchedulerState) {
        guard ClinicsEditProbe.isRequested, !clinicsEditProbeStarted else { return }
        clinicsEditProbeStarted = true
        Task {
            await runClinicsEditProbe(block: block, initialState: state)
        }
    }

    private func runClinicsEditProbe(block: ServiceBlock, initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetDate = "2027-01-04"
        let targetSession = "AM"
        let targetOccurrenceId = "clinic-occurrence::alder::clinic-edit-monday-am::2027-01-04::AM"
        let targetRotatorId = "rot-clinics-edit-1"
        let initialAssignmentCount = initialState.clinicAssignments?.count ?? 0

        func writeFailure(_ message: String) {
            ClinicsEditProbe.write([
                "ok": false,
                "screen": "Clinics",
                "blockId": block.id,
                "targetDate": targetDate,
                "targetSession": targetSession,
                "targetOccurrenceId": targetOccurrenceId,
                "targetRotatorId": targetRotatorId,
                "message": message,
                "initialAssignmentCount": initialAssignmentCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let assigned = await store.run(
            "clinic.assign",
            input: [
                "clinicOccurrenceId": targetOccurrenceId,
                "rotatorRef": targetRotatorId,
                "date": targetDate,
                "session": targetSession,
            ]
        )
        guard assigned, let assignedState = store.state else {
            writeFailure("Clinic assign command failed.")
            return
        }
        guard let assignment = (assignedState.clinicAssignments ?? []).first(where: {
            $0.clinicOccurrenceId == targetOccurrenceId && $0.rotatorId == targetRotatorId
        }) else {
            writeFailure("Assigned clinic assignment was not found in state.")
            return
        }

        let afterAssignCount = assignedState.clinicAssignments?.count ?? 0
        let deleted = await store.run("clinic.delete", input: ["assignmentRef": assignment.id])
        guard deleted, let finalState = store.state else {
            writeFailure("Clinic delete command failed.")
            return
        }
        let afterDeleteCount = finalState.clinicAssignments?.count ?? 0
        let assignmentStillPresent = (finalState.clinicAssignments ?? []).contains { $0.id == assignment.id }

        date = targetDate
        period = .am
        selectedOccurrenceId = targetOccurrenceId
        selectedRotatorId = targetRotatorId

        ClinicsEditProbe.write([
            "ok": assignedState.activeBlockId == block.id
                && finalState.activeBlockId == block.id
                && afterAssignCount == initialAssignmentCount + 1
                && afterDeleteCount == initialAssignmentCount
                && !assignmentStillPresent
                && assignment.date == targetDate
                && assignment.session == targetSession
                && assignment.clinicOccurrenceId == targetOccurrenceId
                && assignment.rotatorId == targetRotatorId
                && assignment.source == "manual",
            "screen": "Clinics",
            "blockId": block.id,
            "blockName": block.name,
            "targetDate": targetDate,
            "targetSession": targetSession,
            "targetOccurrenceId": targetOccurrenceId,
            "targetRotatorId": targetRotatorId,
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

    private func clinicValidationMessage(occurrence: ClinicOccurrence?, assignments: [ClinicAssignment]) -> ClinicValidationMessage? {
        guard let occurrence else { return nil }
        let existing = assignments.filter { $0.clinicOccurrenceId == occurrence.id }
        if existing.contains(where: { $0.rotatorId == selectedRotatorId }) {
            return ClinicValidationMessage(text: "This rotator is already assigned to this clinic.", blocking: true)
        }
        if let capacity = occurrence.capacity, existing.count >= capacity {
            return ClinicValidationMessage(text: "This clinic is already at capacity (\(existing.count)/\(capacity)).", blocking: false)
        }
        return nil
    }

    private func selectableOccurrences(block: ServiceBlock, state: SchedulerState) -> [ClinicOccurrence] {
        allOccurrences(block: block, state: state)
            .filter { $0.date == date && $0.session == period.rawValue }
            .sorted { $0.sortKey < $1.sortKey }
    }

    private func allOccurrences(block: ServiceBlock, state: SchedulerState) -> [ClinicOccurrence] {
        let noClinicDates = Set((block.holidays ?? []).filter { $0.noClinic == true }.map(\.date))
        return expandClinicOccurrences(state: state, startDate: block.startDate, endDate: block.endDate)
            .filter { !CalendarUtil.isWeekend($0.date) && !noClinicDates.contains($0.date) }
            .sorted { $0.sortKey < $1.sortKey }
    }

    private func weekdayDates(block: ServiceBlock) -> [String] {
        let noClinicDates = Set((block.holidays ?? []).filter { $0.noClinic == true }.map(\.date))
        return CalendarUtil.dateRange(block.startDate, block.endDate)
            .filter { !CalendarUtil.isWeekend($0) && !noClinicDates.contains($0) }
    }
}

private struct ClinicValidationMessage {
    let text: String
    let blocking: Bool
}

private enum ClinicsEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_CLINICS_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_CLINICS_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-clinics-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Clinics edit probe: \(error.localizedDescription)")
        }
    }
}

private enum ClinicPeriod: String, CaseIterable, Identifiable {
    case am = "AM"
    case pm = "PM"

    var id: String { rawValue }
}

private struct ClinicsHeader: View {
    var body: some View {
        HStack(spacing: 12) {
            Text("Date").frame(width: 122, alignment: .leading)
            Text("AM").frame(maxWidth: .infinity, alignment: .leading)
            Text("PM").frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.caption.bold())
        .foregroundStyle(.secondary)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct ClinicsDayRow: View {
    let date: String
    let occurrences: [ClinicOccurrence]
    let assignments: [ClinicAssignment]
    let rotatorLabel: (String) -> String
    let focus: ScheduleFocus?
    let removingAssignmentId: String?
    let onDelete: (ClinicAssignment) -> Void

    private var isFocused: Bool {
        focus?.isFocusedDay(date, on: .clinics) == true
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(CalendarUtil.dayLabel(date))
                    .font(.system(.body, design: .rounded)).bold()
                Text(date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(width: 122, alignment: .leading)

            sessionColumn("AM")
                .frame(maxWidth: .infinity, alignment: .topLeading)
            sessionColumn("PM")
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(isFocused ? Color.accentColor.opacity(0.12) : Color.clear)
    }

    private func sessionColumn(_ session: String) -> some View {
        let matches = occurrences.filter { $0.session == session }
        return Group {
            if matches.isEmpty {
                Text("-")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 3)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(matches) { occurrence in
                        ClinicOccurrenceCard(
                            occurrence: occurrence,
                            assignments: assignments.filter { $0.clinicOccurrenceId == occurrence.id },
                            rotatorLabel: rotatorLabel,
                            focus: focus,
                            removingAssignmentId: removingAssignmentId,
                            onDelete: onDelete
                        )
                    }
                }
            }
        }
    }
}

private struct ClinicsWeekSection: View {
    let weekIndex: Int
    let dates: [String]
    let occurrences: [ClinicOccurrence]
    let assignments: [ClinicAssignment]
    let noClinicLabels: [String: String]
    let rotatorLabel: (String) -> String
    let selectedDate: String
    let selectedPeriod: String
    let onSelect: (String, String, String?) -> Void
    let onDropRotator: (String, String, String, String) -> Void

    private static let weekdayColumns = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    private static let bandColors: [Color] = [.blue, .green, .orange, .purple]

    private var band: Color { Self.bandColors[weekIndex % Self.bandColors.count] }

    private func dateFor(_ weekday: String) -> String? {
        dates.first { CalendarUtil.weekdayName($0) == weekday }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Week \(weekIndex + 1)").font(.headline)
                Text("\(dates.first ?? "") to \(dates.last ?? "")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(band.opacity(0.16))

            Grid(alignment: .topLeading, horizontalSpacing: 2, verticalSpacing: 2) {
                GridRow {
                    Text("")
                        .frame(width: 34)
                    ForEach(Self.weekdayColumns, id: \.self) { weekday in
                        VStack(spacing: 1) {
                            Text(weekday.prefix(3).uppercased())
                                .font(.caption2.bold())
                            Text(dateFor(weekday) ?? "-")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                    }
                }
                ForEach(["AM", "PM"], id: \.self) { session in
                    GridRow {
                        Text(session)
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                            .frame(width: 34)
                        ForEach(Self.weekdayColumns, id: \.self) { weekday in
                            cell(weekday: weekday, session: session)
                        }
                    }
                }
            }
            .padding(8)
            .background(band.opacity(0.05))
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(band.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("clinics-week-\(weekIndex + 1)")
    }

    @ViewBuilder
    private func cell(weekday: String, session: String) -> some View {
        if let cellDate = dateFor(weekday) {
            if let holidayLabel = noClinicLabels[cellDate] {
                VStack(spacing: 2) {
                    Text(holidayLabel)
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.85))
                    Text("No Clinic")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .frame(minWidth: 150, maxWidth: .infinity, minHeight: 52, maxHeight: .infinity)
                .background(Color.black.opacity(0.72))
                .accessibilityIdentifier("clinics-cell-\(cellDate)-\(session)")
            } else {
                let cards = occurrences.filter { $0.date == cellDate && $0.session == session }
                let isSelected = cellDate == selectedDate && session == selectedPeriod
                VStack(alignment: .leading, spacing: 4) {
                    if cards.isEmpty {
                        Text("-")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity)
                    } else {
                        ForEach(cards) { occurrence in
                            ClinicsWeekCard(
                                occurrence: occurrence,
                                rotatorNames: assignments
                                    .filter { $0.clinicOccurrenceId == occurrence.id }
                                    .map { rotatorLabel($0.rotatorId) }
                                    .sorted(),
                                onTap: { onSelect(cellDate, session, occurrence.id) },
                                onDropRotator: { rotatorId in
                                    onDropRotator(rotatorId, cellDate, session, occurrence.id)
                                }
                            )
                        }
                    }
                }
                .padding(5)
                .frame(minWidth: 150, maxWidth: .infinity, minHeight: 52, maxHeight: .infinity, alignment: .topLeading)
                .background(isSelected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.05))
                .contentShape(Rectangle())
                .onTapGesture { onSelect(cellDate, session, cards.first?.id) }
                .accessibilityIdentifier("clinics-cell-\(cellDate)-\(session)")
            }
        } else {
            // Weekday column outside this (partial) week's block dates.
            Color.clear
                .frame(minWidth: 150, maxWidth: .infinity, minHeight: 52)
        }
    }
}

private struct ClinicsWeekCard: View {
    let occurrence: ClinicOccurrence
    let rotatorNames: [String]
    let onTap: () -> Void
    let onDropRotator: (String) -> Void

    @State private var isDropTargeted = false

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(headline)
                    .font(.caption.bold())
                    .lineLimit(1)
                if !occurrence.location.isEmpty {
                    Text("at \(occurrence.location)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(rotatorNames.isEmpty ? "No rotators" : rotatorNames.joined(separator: ", "))
                    .font(.caption2)
                    .foregroundStyle(rotatorNames.isEmpty ? Color.secondary : Color.primary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(5)
            .background(
                isDropTargeted ? Color.accentColor.opacity(0.22) : Color.secondary.opacity(0.08),
                in: RoundedRectangle(cornerRadius: 5)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(isDropTargeted ? Color.accentColor : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .help("Drag a rotator name from the side list onto this clinic to assign them")
        .onDrop(of: [.plainText], isTargeted: $isDropTargeted) { providers in
            guard let provider = providers.first else { return false }
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                guard let rotatorId = Self.rotatorId(from: item) else { return }
                DispatchQueue.main.async {
                    onDropRotator(rotatorId)
                }
            }
            return true
        }
    }

    private static func rotatorId(from item: NSSecureCoding?) -> String? {
        if let value = item as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let value = item as? NSString {
            return String(value).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let data = item as? Data {
            return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    private var headline: String {
        let clinic = occurrence.clinicName.isEmpty ? "Clinic" : occurrence.clinicName
        return occurrence.attendingName.isEmpty ? clinic : "\(clinic) (\(occurrence.attendingName))"
    }
}

private struct ClinicOccurrenceCard: View {
    let occurrence: ClinicOccurrence
    let assignments: [ClinicAssignment]
    let rotatorLabel: (String) -> String
    let focus: ScheduleFocus?
    let removingAssignmentId: String?
    let onDelete: (ClinicAssignment) -> Void

    private var isFocused: Bool {
        guard let focus,
              focus.target == .clinics,
              focus.date == occurrence.date
        else { return false }
        if let period = focus.period, occurrence.session != period {
            return false
        }
        if let rotatorId = focus.rotatorId {
            return assignments.contains { $0.rotatorId == rotatorId }
        }
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(occurrence.attendingName.isEmpty ? "Attending" : occurrence.attendingName)
                        .font(.callout.bold())
                        .lineLimit(1)
                    Text(occurrence.clinicName.isEmpty ? "Clinic" : occurrence.clinicName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(capacityLabel)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.secondary.opacity(0.10), in: Capsule())
            }

            if !occurrence.location.isEmpty {
                Label(occurrence.location, systemImage: "mappin.and.ellipse")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if !occurrence.allowedRoles.isEmpty {
                Label(occurrence.allowedRoles.joined(separator: ", "), systemImage: "person.2")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if assignments.isEmpty {
                Text("No rotators")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 2)
            } else {
                FlexibleWrap(spacing: 6) {
                    ForEach(assignments) { assignment in
                        ClinicAssignmentChip(
                            assignment: assignment,
                            label: rotatorLabel(assignment.rotatorId),
                            isFocused: focus?.matches(clinic: assignment) == true,
                            isDeleting: removingAssignmentId == assignment.id,
                            actionsDisabled: removingAssignmentId != nil,
                            onDelete: { onDelete(assignment) }
                        )
                    }
                }
            }
        }
        .padding(10)
        .background(isFocused ? Color.accentColor.opacity(0.10) : cardBackground, in: RoundedRectangle(cornerRadius: 7))
        .overlay(
            RoundedRectangle(cornerRadius: 7)
                .stroke(isFocused ? Color.accentColor.opacity(0.55) : Color.secondary.opacity(0.12), lineWidth: 1)
        )
    }

    private var cardBackground: Color {
        occurrence.source == "legacy" ? Color.orange.opacity(0.08) : Color.secondary.opacity(0.07)
    }

    private var capacityLabel: String {
        guard let capacity = occurrence.capacity else {
            return "\(assignments.count)"
        }
        return "\(assignments.count)/\(capacity)"
    }
}

private struct ClinicAssignmentChip: View {
    let assignment: ClinicAssignment
    let label: String
    let isFocused: Bool
    let isDeleting: Bool
    let actionsDisabled: Bool
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(sourceColor).frame(width: 7, height: 7)
            Text(label)
                .font(.callout)
                .lineLimit(1)
            if assignment.source == "legacy" {
                Image(systemName: "lock")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .help("Legacy clinic assignment")
            } else {
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
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(isFocused ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.1), in: Capsule())
        .overlay(
            Capsule()
                .stroke(isFocused ? Color.accentColor.opacity(0.55) : Color.clear, lineWidth: 1)
        )
    }

    private var sourceColor: Color {
        switch assignment.source {
        case "manual": return .blue
        case "legacy": return .orange
        default: return .gray
        }
    }
}

private struct ClinicOccurrence: Identifiable {
    let id: String
    let date: String
    let session: String
    let attendingName: String
    let clinicName: String
    let location: String
    let capacity: Int?
    let allowedRoles: [String]
    let source: String
    let templateId: String

    var menuLabel: String {
        let clinic = clinicName.isEmpty ? "Clinic" : clinicName
        return "\(attendingName) - \(clinic)"
    }

    var sortKey: String {
        "\(date)|\(session)|\(attendingName.lowercased())|\(clinicName.lowercased())|\(templateId)"
    }
}

private func expandClinicOccurrences(state: SchedulerState, startDate: String, endDate: String) -> [ClinicOccurrence] {
    let dates = CalendarUtil.dateRange(startDate, endDate)
    guard !dates.isEmpty else { return [] }
    let datesByWeekday = Dictionary(grouping: dates, by: CalendarUtil.weekdayName)
    var byId: [String: ClinicOccurrence] = [:]

    func add(_ occurrence: ClinicOccurrence) {
        if byId[occurrence.id] == nil {
            byId[occurrence.id] = occurrence
        }
    }

    for attending in state.attendings ?? [] {
        let recurring = attending.recurringClinics ?? []
        for pair in recurring.enumerated() {
            let slot = pair.element
            guard slot.active != false,
                  let weekday = slot.weekday,
                  let session = slot.session ?? slot.period
            else { continue }
            let clinicName = slot.clinicName ?? ""
            let templateId = slot.id ?? "\(pair.offset)-\(clinicSlug(weekday))-\(session)-\(clinicSlug(clinicName.isEmpty ? "clinic" : clinicName))"
            for date in datesByWeekday[weekday] ?? [] {
                add(
                    ClinicOccurrence(
                        id: clinicOccurrenceId(attendingName: attending.name, templateId: templateId, date: date, session: session),
                        date: date,
                        session: session,
                        attendingName: attending.name,
                        clinicName: clinicName,
                        location: slot.location ?? "",
                        capacity: slot.capacity,
                        allowedRoles: normalizedClinicRoles(slot.allowedRoles),
                        source: "recurring",
                        templateId: templateId
                    )
                )
            }
        }

        let oneOffs = attending.oneOffDates ?? []
        for pair in oneOffs.enumerated() {
            let slot = pair.element
            guard let date = slot.date,
                  startDate <= date,
                  date <= endDate,
                  let session = slot.session ?? slot.period
            else { continue }
            let clinicName = slot.clinicName ?? ""
            let templateId = slot.id ?? "oneoff-\(pair.offset)-\(session)-\(clinicSlug(clinicName.isEmpty ? "clinic" : clinicName))"
            add(
                ClinicOccurrence(
                    id: clinicOccurrenceId(attendingName: attending.name, templateId: templateId, date: date, session: session),
                    date: date,
                    session: session,
                    attendingName: attending.name,
                    clinicName: clinicName,
                    location: slot.location ?? "",
                    capacity: slot.capacity,
                    allowedRoles: normalizedClinicRoles(slot.allowedRoles),
                    source: "one-off",
                    templateId: templateId
                )
            )
        }
    }

    for session in state.outpatientSessions {
        guard let clinic = session.clinic,
              isRealClinicName(clinic),
              startDate <= session.date,
              session.date <= endDate
        else { continue }
        let provider = session.provider ?? ""
        let templateId = "legacy-\(clinicSlug(clinic))-\(clinicSlug(provider))"
        add(
            ClinicOccurrence(
                id: clinicOccurrenceId(attendingName: provider, templateId: templateId, date: session.date, session: session.period),
                date: session.date,
                session: session.period,
                attendingName: provider,
                clinicName: clinic,
                location: "",
                capacity: nil,
                allowedRoles: [],
                source: "legacy",
                templateId: templateId
            )
        )
    }

    return Array(byId.values)
}

private func effectiveAssignments(state: SchedulerState, block: ServiceBlock) -> [ClinicAssignment] {
    var out = (state.clinicAssignments ?? []).filter { block.startDate <= $0.date && $0.date <= block.endDate }
    var seen = Set(out.map { "\($0.clinicOccurrenceId)|\($0.rotatorId)" })
    for session in state.outpatientSessions {
        guard let clinic = session.clinic,
              let rotatorId = session.rotatorId,
              isRealClinicName(clinic),
              block.startDate <= session.date,
              session.date <= block.endDate
        else { continue }
        let provider = session.provider ?? ""
        let templateId = "legacy-\(clinicSlug(clinic))-\(clinicSlug(provider))"
        let occurrenceId = clinicOccurrenceId(attendingName: provider, templateId: templateId, date: session.date, session: session.period)
        let key = "\(occurrenceId)|\(rotatorId)"
        if seen.contains(key) {
            continue
        }
        seen.insert(key)
        out.append(
            ClinicAssignment(
                id: "legacy-clinic-\(clinicSlug(session.id))",
                clinicOccurrenceId: occurrenceId,
                rotatorId: rotatorId,
                date: session.date,
                session: session.period,
                source: "legacy"
            )
        )
    }
    return out
}

private func eligibleRotators(on date: String, occurrence: ClinicOccurrence?, state: SchedulerState) -> [Rotator] {
    let buckets = rotatorServiceBuckets(state: state, date: date)
    return state.rotators
        .filter { serviceTypeForRotatorDate(rotator: $0, date: date, buckets: buckets) == "outpatient" }
        .filter { roleAllowed(rotator: $0, occurrence: occurrence) }
        .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
}

private func withRotatorKept(_ rotators: [Rotator], selectedRotatorId: String, state: SchedulerState) -> [Rotator] {
    var out = rotators
    if let selected = state.rotator(selectedRotatorId), !out.contains(where: { $0.id == selected.id }) {
        out.append(selected)
    }
    return out
}

private func roleAllowed(rotator: Rotator, occurrence: ClinicOccurrence?) -> Bool {
    guard let occurrence, !occurrence.allowedRoles.isEmpty else { return true }
    guard let role = rotator.role else { return false }
    return occurrence.allowedRoles.contains(role)
}

private func rotatorServiceBuckets(
    state: SchedulerState,
    date: String
) -> (ip: [String: [InpatientAssignment]], op: [String: [OutpatientSession]]) {
    let ip = Dictionary(grouping: state.inpatientAssignments.filter { $0.date == date }, by: \.rotatorId)
    let op = Dictionary(
        grouping: state.outpatientSessions.filter { $0.date == date && $0.rotatorId != nil },
        by: { $0.rotatorId! }
    )
    return (ip, op)
}

private func normalizedClinicRoles(_ roles: [String]?) -> [String] {
    guard let roles else { return [] }
    let selected = Set(roles)
    return clinicAssignmentPolicyRoles.filter { selected.contains($0) }
}

private func serviceTypeForRotatorDate(
    rotator: Rotator,
    date: String,
    buckets: (ip: [String: [InpatientAssignment]], op: [String: [OutpatientSession]])
) -> String {
    guard rotator.isActive(on: date) else { return "absent" }
    let ipBucket = buckets.ip[rotator.id] ?? []
    let opBucket = buckets.op[rotator.id] ?? []
    let realIp = ipBucket.filter { !$0.isOff }
    let markedOff = ipBucket.contains { $0.isOff }

    if markedOff && realIp.isEmpty && opBucket.isEmpty {
        return "off"
    }
    if !realIp.isEmpty && !opBucket.isEmpty {
        return "both"
    }
    if !realIp.isEmpty {
        return "inpatient"
    }
    if !opBucket.isEmpty {
        return "outpatient"
    }
    return "unassigned"
}

private let outpatientPlaceholderClinic = "Outpatient (clinic TBD)"
private let methodistOutpatientClinic = "Methodist Outpatient"

private func isRealClinicName(_ clinic: String) -> Bool {
    let trimmed = clinic.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && trimmed != outpatientPlaceholderClinic && trimmed != methodistOutpatientClinic
}

private func clinicOccurrenceId(attendingName: String, templateId: String, date: String, session: String) -> String {
    "clinic-occurrence::\(clinicSlug(attendingName))::\(templateId)::\(date)::\(session)"
}

private func clinicSlug(_ value: String) -> String {
    let lower = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let replaced = lower.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    let trimmed = replaced.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return trimmed.isEmpty ? "x" : trimmed
}
