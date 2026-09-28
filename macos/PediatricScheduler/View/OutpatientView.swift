import SwiftUI

struct OutpatientView: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedRotatorId = ""
    @State private var date = ""
    @State private var period: OutpatientPeriod = .am
    @State private var clinic = "Continuity Clinic"
    @State private var provider = ""
    @State private var detailRows: [OutpatientDetailDraft] = [OutpatientDetailDraft()]
    @State private var editingSessionId: String?
    @State private var isSaving = false
    @State private var removingSessionId: String?
    @State private var outpatientEditProbeStarted = false

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            HStack(spacing: 0) {
                editor(block: block, state: state)
                Divider()
                schedule(block: block, state: state)
            }
            .onAppear {
                syncDefaults(block: block, state: state)
                runOutpatientEditProbeIfRequested(block: block, state: state)
            }
            .onChange(of: block.id) { _ in
                if editingSessionId != nil {
                    cancelEditing(block: block, state: state)
                } else {
                    syncDefaults(block: block, state: state)
                }
            }
            .onChange(of: state.rotators.map(\.id)) { _ in ensureSelection(block: block, state: state) }
            .onChange(of: date) { _ in ensureSelection(block: block, state: state) }
        } else {
            StatusView(icon: "stethoscope", title: "No active block",
                       message: "Create or import a rotation block to view outpatient clinic sessions.")
        }
    }

    private func editor(block: ServiceBlock, state: SchedulerState) -> some View {
        let dateChoices = selectableDates(block: block)
        let rotatorChoices = selectableRotators(block: block, state: state)
        let validationMessage = outpatientValidationMessage(block: block, state: state)

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Outpatient").font(.title2).bold()
                    Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Picker("Rotator", selection: $selectedRotatorId) {
                    ForEach(rotatorChoices) { rotator in
                        Text(rotator.label).tag(rotator.id)
                    }
                }
                .disabled(isSaving || editingSessionId != nil || rotatorChoices.isEmpty)
                .help("Rotator, date, and period identify the session; cancel editing to change them")

                Picker("Date", selection: $date) {
                    ForEach(dateChoices, id: \.self) { day in
                        Text(outpatientDateLabel(day, block: block)).tag(day)
                    }
                }
                .disabled(isSaving || editingSessionId != nil || dateChoices.isEmpty)
                .help("Rotator, date, and period identify the session; cancel editing to change them")

                Picker("Period", selection: $period) {
                    ForEach(OutpatientPeriod.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(isSaving || editingSessionId != nil)
                .help("Rotator, date, and period identify the session; cancel editing to change them")

                if let validationMessage {
                    Label(validationMessage, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }

                TextField("Clinic", text: $clinic)
                    .textFieldStyle(.roundedBorder)

                TextField("Provider", text: $provider)
                    .textFieldStyle(.roundedBorder)

                detailsEditor

                HStack {
                    Button {
                        assignSession()
                    } label: {
                        if isSaving {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Saving")
                            }
                        } else {
                            Label(editingSessionId == nil ? "Assign" : "Save", systemImage: "stethoscope")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || selectedRotatorId.isEmpty || date.isEmpty || validationMessage != nil)

                    if editingSessionId != nil {
                        Button {
                            cancelEditing(block: block, state: state)
                        } label: {
                            Label("Cancel", systemImage: "xmark")
                        }
                        .disabled(isSaving)
                    }
                }

                if let message = store.lastMessage, !message.isEmpty {
                    Label(message, systemImage: "info.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                Spacer(minLength: 0)
            }
            .padding()
            .frame(width: 340, alignment: .topLeading)
        }
        .frame(width: 340, alignment: .topLeading)
    }

    private var detailsEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Details", systemImage: "list.bullet.rectangle")
                    .font(.callout.bold())
                Spacer()
                Button {
                    detailRows.append(OutpatientDetailDraft())
                } label: {
                    Image(systemName: "plus")
                }
                .help("Add detail row")
            }

            ForEach(detailRows.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Detail \(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button(role: .destructive) {
                            removeDetail(at: index)
                        } label: {
                            Image(systemName: "trash")
                                .font(.caption)
                        }
                        .buttonStyle(.borderless)
                        .help("Remove detail row")
                        .disabled(detailRows.count <= 1)
                    }

                    TextField("Clinic", text: $detailRows[index].clinic)
                        .textFieldStyle(.roundedBorder)
                    TextField("Attending", text: $detailRows[index].attending)
                        .textFieldStyle(.roundedBorder)
                    TextField("Task", text: $detailRows[index].task)
                        .textFieldStyle(.roundedBorder)
                    TextField("Notes", text: $detailRows[index].notes)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(8)
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func schedule(block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        ForEach(dates, id: \.self) { day in
                            OutpatientDayRow(
                                date: day,
                                sessions: sessions(on: day, state: state),
                                halfDayFacts: state.halfDayFactsFor(date: day),
                                rotatorLabel: state.rotatorLabel,
                                focus: store.scheduleFocus,
                                removingSessionId: removingSessionId,
                                onEdit: { loadSessionForEditing($0) },
                                onDelete: { deleteSession($0) }
                            )
                            .id(day)
                            Divider()
                        }
                    } header: {
                        OutpatientHeader()
                    }
                }
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

    private func sessions(on day: String, state: SchedulerState) -> [OutpatientSession] {
        state.outpatientSessions
            .filter { $0.date == day }
            .sorted {
                if $0.period != $1.period { return $0.period < $1.period }
                return state.rotatorLabel($0.rotatorId ?? "") < state.rotatorLabel($1.rotatorId ?? "")
            }
    }

    private func syncDefaults(block: ServiceBlock, state: SchedulerState) {
        if !applyFocus(block: block) {
            let dates = clinicOpenDates(block: block)
            if date.isEmpty || !dates.contains(date) {
                date = dates.first ?? ""
            }
        }
        ensureSelection(block: block, state: state)
    }

    private func ensureSelection(block: ServiceBlock, state: SchedulerState) {
        let rotators = selectableRotators(block: block, state: state)
        if selectedRotatorId.isEmpty || !rotators.contains(where: { $0.id == selectedRotatorId }) {
            selectedRotatorId = rotators.first?.id ?? ""
        }
    }

    private func clinicOpenDates(block: ServiceBlock) -> [String] {
        let noClinicDates = Set((block.holidays ?? []).filter { $0.noClinic == true }.map(\.date))
        return CalendarUtil.dateRange(block.startDate, block.endDate).filter { day in
            !CalendarUtil.isWeekend(day) && !noClinicDates.contains(day)
        }
    }

    private func selectableDates(block: ServiceBlock) -> [String] {
        var dates = clinicOpenDates(block: block)
        if !date.isEmpty, !dates.contains(date) {
            dates.append(date)
        }
        return dates.sorted()
    }

    private func outpatientDateLabel(_ day: String, block: ServiceBlock) -> String {
        isClinicOpen(day, block: block) ? CalendarUtil.dayLabel(day) : "\(CalendarUtil.dayLabel(day)) (closed)"
    }

    private func selectableRotators(block: ServiceBlock, state: SchedulerState) -> [Rotator] {
        var rotators = state.rotators
            .filter { isEligibleForOutpatient($0, on: date, block: block) }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        if let selected = state.rotator(selectedRotatorId), !rotators.contains(where: { $0.id == selected.id }) {
            rotators.append(selected)
        }
        return rotators
    }

    private func isEligibleForOutpatient(_ rotator: Rotator, on day: String, block: ServiceBlock) -> Bool {
        guard isClinicOpen(day, block: block), rotator.isActive(on: day) else { return false }
        return unavailableReason(rotator, on: day) == nil
    }

    private func isClinicOpen(_ day: String, block: ServiceBlock) -> Bool {
        guard block.startDate <= day, day <= block.endDate else { return false }
        if CalendarUtil.isWeekend(day) { return false }
        return !(block.holidays ?? []).contains { $0.noClinic == true && $0.date == day }
    }

    private func unavailableReason(_ rotator: Rotator, on day: String) -> String? {
        let weekday = CalendarUtil.weekdayName(day)
        if (rotator.dayOff ?? []).contains(weekday) {
            return weekday
        }
        if let range = (rotator.unavailableRanges ?? []).first(where: { $0.start <= day && day <= $0.end }) {
            return range.label?.isEmpty == false ? range.label : "\(range.start) to \(range.end)"
        }
        return nil
    }

    private func outpatientValidationMessage(block: ServiceBlock, state: SchedulerState) -> String? {
        guard !date.isEmpty else { return "Pick an open clinic date." }
        guard block.startDate <= date, date <= block.endDate else { return "Date is outside the active block." }
        if CalendarUtil.isWeekend(date) {
            return "Outpatient clinics are closed on weekends."
        }
        if let holiday = (block.holidays ?? []).first(where: { $0.noClinic == true && $0.date == date }) {
            return "Outpatient clinics are closed on \(holiday.label ?? date)."
        }
        guard let rotator = state.rotator(selectedRotatorId) else { return "Pick an eligible rotator." }
        guard rotator.isActive(on: date) else { return "\(rotator.label) is not active on this date." }
        if let reason = unavailableReason(rotator, on: date) {
            return "\(rotator.label) is unavailable on this date (\(reason))."
        }
        return nil
    }

    @discardableResult
    private func applyFocus(block: ServiceBlock) -> Bool {
        guard let focus = store.scheduleFocus,
              focus.target == .outpatient,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return false }
        date = focus.date
        if let rotatorId = focus.rotatorId {
            selectedRotatorId = rotatorId
        }
        if let period = focus.period, let focusedPeriod = OutpatientPeriod(rawValue: period) {
            self.period = focusedPeriod
        }
        return true
    }

    private func scrollToFocus(proxy: ScrollViewProxy, block: ServiceBlock) {
        guard let focus = store.scheduleFocus,
              focus.target == .outpatient,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(focus.date, anchor: .center)
        }
    }

    private func assignSession() {
        guard !isSaving else { return }
        isSaving = true
        var input: [String: Any] = [
            "rotatorRef": selectedRotatorId,
            "date": date,
            "period": period.rawValue,
            "clinic": clinic,
            "provider": provider,
            "blockRef": store.state?.activeBlock?.id ?? "",
        ]
        let detailPayload = detailRows.compactMap(\.payload)
        if !detailPayload.isEmpty {
            input["details"] = detailPayload
        }
        Task {
            // Stay in edit mode when the save fails so Cancel and the error
            // banner both remain visible.
            if await store.run("outpatient.assign", input: input) {
                editingSessionId = nil
            }
            isSaving = false
        }
    }

    private func loadSessionForEditing(_ session: OutpatientSession) {
        guard removingSessionId == nil else { return }
        editingSessionId = session.id
        selectedRotatorId = session.rotatorId ?? ""
        date = session.date
        period = OutpatientPeriod(rawValue: session.period) ?? .am
        clinic = session.clinic?.isEmpty == false ? session.clinic! : "Continuity Clinic"
        provider = session.provider ?? ""
        detailRows = OutpatientDetailDraft.rows(from: session)
    }

    private func cancelEditing(block: ServiceBlock, state: SchedulerState) {
        editingSessionId = nil
        detailRows = [OutpatientDetailDraft()]
        // Reset the fields loadSessionForEditing populated so the next "new
        // session" form doesn't show the cancelled session's values.
        clinic = "Continuity Clinic"
        provider = ""
        syncDefaults(block: block, state: state)
    }

    private func removeDetail(at index: Int) {
        guard detailRows.count > 1, detailRows.indices.contains(index) else { return }
        detailRows.remove(at: index)
    }

    private func deleteSession(_ session: OutpatientSession) {
        guard removingSessionId == nil else { return }
        removingSessionId = session.id
        Task {
            await store.run("outpatient.delete", input: ["sessionRef": session.id])
            if editingSessionId == session.id, let state = store.state, let block = state.activeBlock {
                cancelEditing(block: block, state: state)
            }
            removingSessionId = nil
        }
    }

    private func runOutpatientEditProbeIfRequested(block: ServiceBlock, state: SchedulerState) {
        guard OutpatientEditProbe.isRequested, !outpatientEditProbeStarted else { return }
        outpatientEditProbeStarted = true
        Task {
            await runOutpatientEditProbe(block: block, initialState: state)
        }
    }

    private func runOutpatientEditProbe(block: ServiceBlock, initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetDate = "2026-11-03"
        let targetPeriod = "AM"
        let targetRotatorId = "rot-outpatient-edit-1"
        let initialSessionCount = initialState.outpatientSessions.count

        func writeFailure(_ message: String) {
            OutpatientEditProbe.write([
                "ok": false,
                "screen": "Outpatient",
                "blockId": block.id,
                "targetDate": targetDate,
                "targetPeriod": targetPeriod,
                "targetRotatorId": targetRotatorId,
                "message": message,
                "initialSessionCount": initialSessionCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let detailPayload: [[String: String]] = [
            [
                "clinic": "Epilepsy Clinic",
                "attending": "Birch",
                "task": "New visits",
                "notes": "Room 12"
            ],
            [
                "clinic": "Resident Clinic",
                "attending": "Alder",
                "task": "Follow-ups",
                "notes": "Continuity"
            ]
        ]

        let assigned = await store.run("outpatient.assign", input: [
            "rotatorRef": targetRotatorId,
            "date": targetDate,
            "period": targetPeriod,
            "clinic": "Resident Clinic",
            "provider": "Alder",
            "blockRef": block.id,
            "details": detailPayload
        ])
        guard assigned, let assignedState = store.state else {
            writeFailure("Outpatient assign command failed.")
            return
        }
        guard let session = assignedState.outpatientSessions.first(where: {
            $0.date == targetDate && $0.period == targetPeriod && $0.rotatorId == targetRotatorId
        }) else {
            writeFailure("Assigned outpatient session was not found in state.")
            return
        }

        let assignedDetails = (session.details ?? []).map { detail in
            [
                "clinic": detail.clinic ?? "",
                "attending": detail.attending ?? "",
                "task": detail.task ?? "",
                "notes": detail.notes ?? ""
            ]
        }
        let afterAssignCount = assignedState.outpatientSessions.count

        let deleted = await store.run("outpatient.delete", input: ["sessionRef": session.id])
        guard deleted, let finalState = store.state else {
            writeFailure("Outpatient delete command failed.")
            return
        }
        let afterDeleteCount = finalState.outpatientSessions.count
        let sessionStillPresent = finalState.outpatientSessions.contains { $0.id == session.id }

        date = targetDate
        period = .am
        selectedRotatorId = targetRotatorId
        clinic = "Resident Clinic"
        provider = "Alder"
        detailRows = [OutpatientDetailDraft()]

        OutpatientEditProbe.write([
            "ok": assignedState.activeBlockId == block.id
                && finalState.activeBlockId == block.id
                && afterAssignCount == initialSessionCount + 1
                && afterDeleteCount == initialSessionCount
                && !sessionStillPresent
                && session.date == targetDate
                && session.period == targetPeriod
                && session.rotatorId == targetRotatorId
                && session.clinic == "Resident Clinic"
                && session.provider == "Alder"
                && assignedDetails == detailPayload,
            "screen": "Outpatient",
            "blockId": block.id,
            "blockName": block.name,
            "targetDate": targetDate,
            "targetPeriod": targetPeriod,
            "targetRotatorId": targetRotatorId,
            "sessionId": session.id,
            "clinic": session.clinic ?? "",
            "provider": session.provider ?? "",
            "source": session.source ?? "",
            "details": assignedDetails,
            "initialSessionCount": initialSessionCount,
            "afterAssignCount": afterAssignCount,
            "afterDeleteCount": afterDeleteCount,
            "sessionStillPresent": sessionStillPresent,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }
}

private enum OutpatientEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_OUTPATIENT_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-outpatient-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Outpatient edit probe: \(error.localizedDescription)")
        }
    }
}

private enum OutpatientPeriod: String, CaseIterable, Identifiable {
    case am = "AM"
    case pm = "PM"

    var id: String { rawValue }
}

private struct OutpatientDetailDraft: Identifiable {
    let id = UUID()
    var clinic = ""
    var attending = ""
    var task = ""
    var notes = ""

    init() {}

    init(detail: OutpatientDetail) {
        clinic = detail.clinic ?? ""
        attending = detail.attending ?? ""
        task = detail.task ?? ""
        notes = detail.notes ?? ""
    }

    var payload: [String: String]? {
        var value: [String: String] = [:]
        let clinicValue = clinic.trimmingCharacters(in: .whitespacesAndNewlines)
        let attendingValue = attending.trimmingCharacters(in: .whitespacesAndNewlines)
        let taskValue = task.trimmingCharacters(in: .whitespacesAndNewlines)
        let notesValue = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clinicValue.isEmpty {
            value["clinic"] = clinicValue
        }
        if !attendingValue.isEmpty {
            value["attending"] = attendingValue
        }
        if !taskValue.isEmpty {
            value["task"] = taskValue
        }
        if !notesValue.isEmpty {
            value["notes"] = notesValue
        }
        return value.isEmpty ? nil : value
    }

    static func rows(from session: OutpatientSession) -> [OutpatientDetailDraft] {
        let rows = (session.details ?? [])
            .map(OutpatientDetailDraft.init)
            .filter { $0.payload != nil }
        return rows.isEmpty ? [OutpatientDetailDraft()] : rows
    }
}

private struct OutpatientHeader: View {
    var body: some View {
        HStack(spacing: 12) {
            Text("Date").frame(width: 120, alignment: .leading)
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

private struct OutpatientDayRow: View {
    let date: String
    let sessions: [OutpatientSession]
    let halfDayFacts: [HalfDayFact]
    let rotatorLabel: (String) -> String
    let focus: ScheduleFocus?
    let removingSessionId: String?
    let onEdit: (OutpatientSession) -> Void
    let onDelete: (OutpatientSession) -> Void

    private var isFocused: Bool {
        focus?.isFocusedDay(date, on: .outpatient) == true
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
            .frame(width: 120, alignment: .leading)

            sessionColumn(period: "AM")
                .frame(maxWidth: .infinity, alignment: .leading)
            sessionColumn(period: "PM")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(rowBackground)
    }

    private var rowBackground: Color {
        if isFocused {
            return Color.accentColor.opacity(0.12)
        }
        return CalendarUtil.isWeekend(date) ? Color.secondary.opacity(0.06) : Color.clear
    }

    private func sessionColumn(period: String) -> some View {
        let matches = sessions.filter { $0.period == period }
        let periodFacts = halfDayFacts.filter { $0.period == period }
        let matchedRotatorIds = Set(matches.compactMap(\.rotatorId))
        let unmatchedFacts = periodFacts.filter { !matchedRotatorIds.contains($0.rotatorId) }
        return Group {
            if matches.isEmpty {
                if periodFacts.isEmpty {
                    Text("-")
                        .font(.callout)
                        .foregroundStyle(.tertiary)
                        .padding(.vertical, 3)
                } else {
                    HalfDayFactBadges(
                        facts: periodFacts,
                        includeRotator: true,
                        rotatorLabel: rotatorLabel
                    )
                }
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    FlexibleWrap(spacing: 6) {
                        ForEach(matches) { session in
                            OutpatientChip(
                                session: session,
                                facts: periodFacts.filter { $0.rotatorId == session.rotatorId },
                                rotatorLabel: rotatorLabel,
                                isFocused: focus?.matches(outpatient: session) == true,
                                isDeleting: removingSessionId == session.id,
                                actionsDisabled: removingSessionId != nil,
                                onEdit: { onEdit(session) },
                                onDelete: { onDelete(session) }
                            )
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
    }
}

private struct OutpatientChip: View {
    let session: OutpatientSession
    let facts: [HalfDayFact]
    let rotatorLabel: (String) -> String
    let isFocused: Bool
    let isDeleting: Bool
    let actionsDisabled: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(sourceColor).frame(width: 7, height: 7)
                Text(rotatorLabel(session.rotatorId ?? ""))
                    .font(.callout)
                    .lineLimit(1)
                Button {
                    onEdit()
                } label: {
                    Image(systemName: "pencil")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
                .help("Edit session")
                .disabled(actionsDisabled)
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
                .help("Remove session")
                .disabled(actionsDisabled)
            }
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if !facts.isEmpty {
                HalfDayFactBadges(facts: facts)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(isFocused ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(isFocused ? Color.accentColor.opacity(0.55) : Color.clear, lineWidth: 1)
        )
    }

    private var subtitle: String {
        let details = (session.details ?? []).map(detailSummary).filter { !$0.isEmpty }
        if !details.isEmpty {
            return details.joined(separator: "; ")
        }
        let clinic = displayClinicName(session.clinic)
        let provider = session.provider?.isEmpty == false ? " - \(session.provider!)" : ""
        return "\(clinic)\(provider)"
    }

    private func displayClinicName(_ value: String?) -> String {
        let name = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return name == "Outpatient (clinic TBD)" || name.isEmpty ? "Clinic not selected" : name
    }

    private func detailSummary(_ detail: OutpatientDetail) -> String {
        [
            detail.clinic,
            detail.attending,
            detail.task,
            detail.notes,
        ]
        .compactMap { value in
            let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        .joined(separator: " - ")
    }

    private var sourceColor: Color {
        switch session.source {
        case "Manual": return .blue
        case "Auto-Draft": return .green
        case "Auto-Split": return .teal
        case "Auto-Methodist": return .purple
        case "Auto-Preassigned": return .indigo
        case "Range-Assigned": return .orange
        default: return .gray
        }
    }
}
