import SwiftUI

struct RotatorsView: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedRotatorId = ""
    @State private var selectedRotatorIds: Set<String> = []
    @State private var draft = RotatorDraft()
    @State private var isSaving = false
    @State private var isDeduping = false
    @State private var isBulkDeleting = false
    @State private var confirmDelete = false
    @State private var confirmBulkDelete = false
    @State private var activeBlockOnly = true
    @State private var isCreatingNew = false
    @State private var rotatorsEditProbeStarted = false

    var body: some View {
        if let state = store.state {
            HStack(spacing: 0) {
                rosterList(state: state)
                Divider()
                editor(state: state)
            }
            .onAppear {
                syncSelection(state: state)
                runRotatorsEditProbeIfRequested(state: state)
            }
            .onChange(of: state.rotators.map(\.id)) { _ in syncSelection(state: state) }
            .onChange(of: state.activeBlockId) { _ in syncSelection(state: state) }
            .onChange(of: activeBlockOnly) { _ in syncSelection(state: state) }
            .onChange(of: selectedRotatorId) { _ in loadDraft(from: selectedRotator) }
            .onChange(of: selectedRotatorIds) { _ in syncPrimarySelection(state: state) }
            .onChange(of: store.scheduleFocus) { focus in
                guard let focus, focus.target == .rotators, let rotatorId = focus.rotatorId else { return }
                selectedRotatorId = rotatorId
                selectedRotatorIds = [rotatorId]
            }
        } else {
            StatusView(icon: "person.3", title: "No roster loaded",
                       message: "The backend is ready, but no scheduler state was returned.")
        }
    }

    private func rosterList(state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Rotators").font(.title2).bold()
                    Spacer()
                    Button {
                        dedupeRoster()
                    } label: {
                        if isDeduping {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.triangle.merge")
                        }
                    }
                    .help("Merge duplicate rotators")
                    .accessibilityLabel("Merge duplicate rotators")
                    .disabled(isSaving || isDeduping || isBulkDeleting || state.rotators.count < 2)

                    Button(role: .destructive) {
                        confirmBulkDelete = true
                    } label: {
                        if isBulkDeleting {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "trash")
                        }
                    }
                    .help(bulkDeleteHelp)
                    .accessibilityLabel(bulkDeleteHelp)
                    .disabled(isSaving || isDeduping || isBulkDeleting || selectedRotatorIds.isEmpty)

                    Button {
                        isCreatingNew = true
                        selectedRotatorId = ""
                        selectedRotatorIds.removeAll()
                        draft = RotatorDraft()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .help("Add rotator")
                    .accessibilityLabel("Add rotator")
                }

                activeBlockFilterBar(state)
            }
            .padding()

            Divider()

            if !selectedRotatorIds.isEmpty {
                Text("\(selectedRotatorIds.count) selected")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    .padding(.vertical, 6)
            }

            if visibleRotators(state).isEmpty {
                emptyRotatorsMessage(state)
            } else {
                List(selection: $selectedRotatorIds) {
                    ForEach(visibleRotators(state)) { rotator in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(rotator.label)
                                .font(.body)
                            Text(rowDetail(rotator))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                        .tag(rotator.id)
                    }
                }
            }
        }
        .frame(width: 300)
        .confirmationDialog("Delete selected rotators?", isPresented: $confirmBulkDelete) {
            Button("Delete \(selectedRotatorIds.count) Rotators", role: .destructive) { deleteSelectedRotators() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Assignments for the selected rotators will be removed too.")
        }
    }

    private func emptyRotatorsMessage(_ state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(emptyRotatorsText(state), systemImage: "checkmark.circle")
                .font(.callout)
                .foregroundStyle(.secondary)
            if activeBlockOnly, hiddenRotatorCount(state) > 0 {
                Button {
                    activeBlockOnly = false
                } label: {
                    Label("Show All Rotators", systemImage: "eye")
                }
            }
        }
        .padding()
    }

    private func emptyRotatorsText(_ state: SchedulerState) -> String {
        if activeBlockOnly, hiddenRotatorCount(state) > 0 {
            return "No rotators active in this block."
        }
        return "No rotators in the roster."
    }

    private func editor(state: SchedulerState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text(selectedRotator == nil ? "New Rotator" : draft.fullName)
                        .font(.title2)
                        .bold()
                        .lineLimit(1)
                    Spacer()
                    if selectedRotator != nil {
                        Button(role: .destructive) {
                            confirmDelete = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .disabled(isSaving || selectedRotatorIds.count > 1)
                        .help(selectedRotatorIds.count > 1
                              ? "Use the trash button to delete multiple selected rotators"
                              : "Delete this rotator")
                    }
                }

                formGrid
                if draft.isMethodist {
                    methodistEditor
                }
                segmentsEditor
                availabilityEditor

                HStack {
                    Button {
                        save()
                    } label: {
                        if isSaving {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Saving")
                            }
                        } else {
                            Label(selectedRotator == nil ? "Add" : "Save", systemImage: "checkmark")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || !draft.isComplete)
                    .help(!draft.hasValidSegments
                          ? "Fix the rotation segment dates first: dates must be YYYY-MM-DD and start on or before end."
                          : !draft.hasValidUnavailableRanges
                          ? "Fix the unavailable date ranges first: dates must be YYYY-MM-DD and start on or before end."
                          : "Save requires a name, program, level, and at least one valid rotation segment.")

                    Button {
                        loadDraft(from: selectedRotator)
                    } label: {
                        Label("Revert", systemImage: "arrow.uturn.backward")
                    }
                    .disabled(selectedRotator == nil || isSaving)
                }

                if let message = store.lastMessage, !message.isEmpty {
                    Label(message, systemImage: "info.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                rosterSummary(state)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .confirmationDialog("Delete rotator?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { deleteSelected() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Assignments for this rotator will be removed too.")
        }
    }

    private var formGrid: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 10) {
            GridRow {
                Text("Name").foregroundStyle(.secondary)
                TextField("Full name", text: $draft.fullName)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 360)
            }
            GridRow {
                Text("Program").foregroundStyle(.secondary)
                Picker("Program", selection: $draft.program) {
                    ForEach(programs, id: \.self) { program in
                        Text(program).tag(program)
                    }
                }
                .labelsHidden()
                .frame(width: 240)
            }
            GridRow {
                Text("Level").foregroundStyle(.secondary)
                TextField("PGY-2", text: $draft.level)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 140)
            }
            GridRow {
                Text("Continuity").foregroundStyle(.secondary)
                TextField("Tuesday PM", text: $draft.continuityClinic)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
            }
        }
    }

    private var segmentsEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Rotation Segments", systemImage: "calendar.badge.clock")
                    .font(.callout.bold())
                Spacer()
                Button {
                    draft.segments.append(RotatorSegmentDraft())
                } label: {
                    Image(systemName: "plus")
                }
                .help("Add segment")
            }

            ScrollView(.horizontal) {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 8) {
                    GridRow {
                        Text("Start")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("End")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Template")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("")
                    }

                    ForEach(draft.segments.indices, id: \.self) { index in
                        GridRow {
                            TextField("YYYY-MM-DD", text: $draft.segments[index].startDate)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 118)

                            TextField("YYYY-MM-DD", text: $draft.segments[index].endDate)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 118)

                            Picker("Template", selection: $draft.segments[index].defaultPhase) {
                                ForEach(SegmentDefaultPhase.allCases) { phase in
                                    Text(phase.title).tag(phase)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 132)

                            Button(role: .destructive) {
                                removeSegment(at: index)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove segment")
                            .disabled(draft.segments.count <= 1)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
    }

    private var methodistEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Methodist 14/14", systemImage: "building.2")
                .font(.callout.bold())

            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    Text("Rotation start").foregroundStyle(.secondary)
                    TextField("YYYY-MM-DD", text: $draft.rotationStartDate)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 140)
                        .help("True Methodist 28-day rotation start date")
                }
                GridRow {
                    Text("Start side").foregroundStyle(.secondary)
                    Picker("Start side", selection: $draft.methodistStartSide) {
                        ForEach(MethodistStartSide.allCases) { side in
                            Text(side.title).tag(side)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 180)
                    .help("Auto lets the scheduler choose the inpatient fortnight from block coverage.")
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
    }

    private var availabilityEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Availability", systemImage: "calendar.badge.exclamationmark")
                .font(.callout.bold())

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(rotatorWeekdays, id: \.self) { weekday in
                    Toggle(String(weekday.prefix(3)), isOn: Binding(
                        get: { draft.dayOff.contains(weekday) },
                        set: { isOn in draft.setDayOff(weekday, isOn: isOn) }
                    ))
                    .toggleStyle(.checkbox)
                }
            }

            HStack {
                Text("Unavailable Ranges")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    draft.unavailableRanges.append(UnavailableRangeDraft())
                } label: {
                    Image(systemName: "plus")
                }
                .help("Add unavailable range")
            }

            ScrollView(.horizontal) {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 8) {
                    GridRow {
                        Text("Start")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("End")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Label")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("")
                    }

                    ForEach(draft.unavailableRanges.indices, id: \.self) { index in
                        GridRow {
                            TextField("YYYY-MM-DD", text: $draft.unavailableRanges[index].startDate)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 118)

                            TextField("YYYY-MM-DD", text: $draft.unavailableRanges[index].endDate)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 118)

                            TextField("Label", text: $draft.unavailableRanges[index].label)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 150)

                            Button(role: .destructive) {
                                removeUnavailableRange(at: index)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove unavailable range")
                        }
                    }
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
    }

    private func rosterSummary(_ state: SchedulerState) -> some View {
        let rotators = visibleRotators(state)
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: 8) {
            Label("\(rotators.count) rotators", systemImage: "person.3")
            Label("\(rotators.filter(\.isPediatricNeurologyFellow).count) fellows", systemImage: "staroflife")
            Label("\(rotators.filter { $0.schoolType == "methodist" }.count) Methodist", systemImage: "building.2")
            if activeBlockOnly, hiddenRotatorCount(state) > 0 {
                Label("\(hiddenRotatorCount(state)) hidden", systemImage: "eye.slash")
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func activeBlockFilterBar(_ state: SchedulerState) -> some View {
        if let block = state.activeBlock {
            HStack(spacing: 8) {
                Toggle("Active block only", isOn: $activeBlockOnly)
                    .toggleStyle(.checkbox)
                Text(block.name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if activeBlockOnly, hiddenRotatorCount(state) > 0 {
                    Label("\(hiddenRotatorCount(state)) outside block hidden", systemImage: "eye.slash")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var selectedRotator: Rotator? {
        store.state?.rotator(selectedRotatorId)
    }

    private var bulkDeleteHelp: String {
        selectedRotatorIds.isEmpty ? "Delete selected rotators" : "Delete \(selectedRotatorIds.count) selected rotators"
    }

    private func sortedRotators(_ state: SchedulerState) -> [Rotator] {
        state.rotators.sorted {
            $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }

    private func visibleRotators(_ state: SchedulerState) -> [Rotator] {
        let rotators = sortedRotators(state)
        guard activeBlockOnly, let block = state.activeBlock else { return rotators }
        return rotators.filter { isActive($0, during: block) }
    }

    private func hiddenRotatorCount(_ state: SchedulerState) -> Int {
        guard activeBlockOnly, state.activeBlock != nil else { return 0 }
        return max(0, sortedRotators(state).count - visibleRotators(state).count)
    }

    private func isActive(_ rotator: Rotator, during block: ServiceBlock) -> Bool {
        (rotator.segments ?? []).contains { segment in
            segment.start <= block.endDate && block.startDate <= segment.end
        }
    }

    private func syncSelection(state: SchedulerState) {
        let rotators = visibleRotators(state)
        let availableIds = Set(rotators.map(\.id))
        selectedRotatorIds = selectedRotatorIds.intersection(availableIds)
        if !isCreatingNew, selectedRotatorId.isEmpty || !availableIds.contains(selectedRotatorId) {
            selectedRotatorId = rotators.first { selectedRotatorIds.contains($0.id) }?.id ?? rotators.first?.id ?? ""
        }
        if selectedRotatorIds.isEmpty, !selectedRotatorId.isEmpty {
            selectedRotatorIds = [selectedRotatorId]
        }
        if !isCreatingNew {
            loadDraft(from: selectedRotator)
        }
    }

    private func syncPrimarySelection(state: SchedulerState) {
        if !selectedRotatorIds.isEmpty {
            isCreatingNew = false
        }
        let rotators = visibleRotators(state)
        let availableIds = Set(rotators.map(\.id))
        let cleanedSelection = selectedRotatorIds.intersection(availableIds)
        if cleanedSelection != selectedRotatorIds {
            selectedRotatorIds = cleanedSelection
            return
        }
        if selectedRotatorId.isEmpty || !selectedRotatorIds.contains(selectedRotatorId) {
            selectedRotatorId = rotators.first { selectedRotatorIds.contains($0.id) }?.id ?? ""
        }
        if selectedRotatorIds.isEmpty {
            loadDraft(from: nil)
        }
    }

    private func loadDraft(from rotator: Rotator?) {
        if let rotator {
            draft = RotatorDraft(rotator: rotator)
        } else {
            draft = RotatorDraft()
        }
    }

    private func save() {
        guard !isSaving, draft.isComplete else { return }
        isSaving = true
        let command = selectedRotator == nil ? "rotator.add" : "rotator.update"
        var input: [String: Any] = selectedRotator == nil ? draft.addInput : ["rotatorId": selectedRotatorId, "patch": draft.patch]
        if selectedRotator != nil {
            input["rotatorRef"] = selectedRotatorId
        }
        Task {
            // Only resync (which reloads the draft from server state) when
            // the save succeeded — a rejected save must not wipe the form.
            if await store.run(command, input: input), let state = store.state {
                isCreatingNew = false
                if selectedRotatorId.isEmpty {
                    selectedRotatorId = state.rotators.first { $0.fullName == draft.fullName || $0.displayName == draft.fullName }?.id ?? ""
                }
                syncSelection(state: state)
            }
            isSaving = false
        }
    }

    private func deleteSelected() {
        guard !isSaving, !selectedRotatorId.isEmpty else { return }
        isSaving = true
        let id = selectedRotatorId
        Task {
            await store.run("rotator.delete", input: ["rotatorId": id, "rotatorRef": id])
            if let state = store.state {
                syncSelection(state: state)
            }
            isSaving = false
        }
    }

    private func deleteSelectedRotators() {
        guard !selectedRotatorIds.isEmpty, !isBulkDeleting, let state = store.state else { return }
        let ids = visibleRotators(state)
            .map(\.id)
            .filter { selectedRotatorIds.contains($0) }
        guard !ids.isEmpty else { return }
        isBulkDeleting = true
        Task {
            await store.run("rotators.delete", input: ["rotatorIds": ids])
            selectedRotatorId = ""
            selectedRotatorIds.removeAll()
            if let state = store.state {
                syncSelection(state: state)
            }
            isBulkDeleting = false
        }
    }

    private func dedupeRoster() {
        guard !isDeduping else { return }
        isDeduping = true
        Task {
            await store.run("roster.dedupe")
            if let state = store.state {
                syncSelection(state: state)
            }
            isDeduping = false
        }
    }

    private func runRotatorsEditProbeIfRequested(state: SchedulerState) {
        guard RotatorsEditProbe.isRequested, !rotatorsEditProbeStarted else { return }
        rotatorsEditProbeStarted = true
        Task {
            await runRotatorsEditProbe(initialState: state)
        }
    }

    private func runRotatorsEditProbe(initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let initialRotatorCount = initialState.rotators.count
        let targetName = "Maya Lopez"
        let bulkDeleteName = "Taylor Stone"
        let duplicateName = "Drew Quinn"

        func writeFailure(_ message: String) {
            RotatorsEditProbe.write([
                "ok": false,
                "screen": "Rotators",
                "blockId": initialState.activeBlockId,
                "message": message,
                "initialRotatorCount": initialRotatorCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let addMethodistOk = await store.run("rotator.add", input: [
            "fullName": targetName,
            "program": "Methodist",
            "level": "PGY-3",
            "segments": [
                ["start": "2026-10-05", "end": "2026-10-30", "defaultPhase": "inpatient"]
            ],
            "continuityClinic": "Monday AM",
            "rotationStartDate": "2026-10-05",
            "methodistStartSide": "inpatient",
            "dayOff": ["Tuesday"],
            "unavailableRanges": [
                ["start": "2026-10-12", "end": "2026-10-12", "label": "Conference"]
            ]
        ])
        guard addMethodistOk, let methodistId = store.state?.rotators.first(where: { $0.fullName == targetName })?.id else {
            writeFailure("Methodist rotator add command failed.")
            return
        }

        let addBulkDeleteTargetOk = await store.run("rotator.add", input: [
            "fullName": bulkDeleteName,
            "program": "UT Pediatrics",
            "level": "PGY-2",
            "segments": [
                ["start": "2026-10-05", "end": "2026-10-09"]
            ],
            "continuityClinic": "Wednesday PM"
        ])
        guard addBulkDeleteTargetOk, let bulkDeleteId = store.state?.rotators.first(where: { $0.fullName == bulkDeleteName })?.id else {
            writeFailure("Bulk-delete target rotator add command failed.")
            return
        }

        let updateOk = await store.run("rotator.update", input: [
            "rotatorId": methodistId,
            "rotatorRef": methodistId,
            "patch": [
                "displayName": "Maya L.",
                "program": "Methodist",
                "level": "PGY-4",
                "role": "Resident",
                "schoolType": "methodist",
                "segments": [
                    ["start": "2026-10-05", "end": "2026-10-16", "defaultPhase": "inpatient"],
                    ["start": "2026-10-19", "end": "2026-10-30", "defaultPhase": "outpatient"]
                ],
                "continuityClinic": "Thursday AM",
                "rotationStartDate": "2026-10-06",
                "methodistStartSide": "outpatient",
                "dayOff": ["Monday", "Friday"],
                "unavailableRanges": [
                    ["start": "2026-10-20", "end": "2026-10-21", "label": "Vacation"]
                ]
            ]
        ])
        guard updateOk else {
            writeFailure("Methodist rotator update command failed.")
            return
        }

        let bulkDeleteOk = await store.run("rotators.delete", input: ["rotatorIds": [bulkDeleteId]])
        guard bulkDeleteOk else {
            writeFailure("Bulk rotator delete command failed.")
            return
        }

        let addDuplicateKeeperOk = await store.run("rotator.add", input: [
            "fullName": duplicateName,
            "program": "UT Pediatrics",
            "level": "PGY-2",
            "segments": [
                ["start": "2026-10-07", "end": "2026-10-07", "defaultPhase": "inpatient"]
            ],
            "continuityClinic": "Tuesday PM"
        ])
        guard addDuplicateKeeperOk, let duplicateKeeperId = store.state?.rotators.first(where: { $0.fullName == duplicateName })?.id else {
            writeFailure("Duplicate keeper rotator add command failed.")
            return
        }
        try? await Task.sleep(nanoseconds: 2_000_000)

        let addDuplicateTargetOk = await store.run("rotator.add", input: [
            "fullName": duplicateName,
            "program": "UT Pediatrics",
            "level": "PGY-2",
            "segments": [
                ["start": "2026-10-07", "end": "2026-10-07", "defaultPhase": "inpatient"],
                ["start": "2026-10-08", "end": "2026-10-08", "defaultPhase": "outpatient"]
            ],
            "continuityClinic": "Tuesday PM"
        ])
        let duplicateIds = store.state?.rotators.filter { $0.fullName == duplicateName }.map(\.id) ?? []
        guard addDuplicateTargetOk,
              duplicateIds.count == 2,
              let duplicateTargetId = duplicateIds.last,
              duplicateTargetId != duplicateKeeperId else {
            writeFailure("Duplicate target rotator add command failed.")
            return
        }

        let duplicateInpatientOk = await store.run("inpatient.assign", input: [
            "rotatorId": duplicateTargetId,
            "rotatorRef": duplicateTargetId,
            "date": "2026-10-07",
            "role": "Resident"
        ])
        guard duplicateInpatientOk else {
            writeFailure("Duplicate inpatient assignment seeding command failed.")
            return
        }
        let duplicateOutpatientOk = await store.run("outpatient.assign", input: [
            "rotatorId": duplicateTargetId,
            "rotatorRef": duplicateTargetId,
            "date": "2026-10-08",
            "period": "AM",
            "clinic": "QRS",
            "provider": "Alder"
        ])
        guard duplicateOutpatientOk else {
            writeFailure("Duplicate outpatient assignment seeding command failed.")
            return
        }

        let beforeDedupeRotatorCount = store.state?.rotators.count ?? -1
        let dedupeOk = await store.run("roster.dedupe")
        guard dedupeOk, let state = store.state else {
            writeFailure("Roster dedupe command failed.")
            return
        }

        let methodist = state.rotators.first { $0.id == methodistId }
        let dedupedDuplicate = state.rotators.first { $0.fullName == duplicateName }
        selectedRotatorId = methodist?.id ?? ""
        selectedRotatorIds = methodist.map { Set([$0.id]) } ?? []
        loadDraft(from: methodist)

        let segmentSummaries = (methodist?.segments ?? []).map { segment in
            [
                "start": segment.start,
                "end": segment.end,
                "defaultPhase": segment.defaultPhase ?? ""
            ]
        }
        let unavailableSummaries = (methodist?.unavailableRanges ?? []).map { range in
            [
                "start": range.start,
                "end": range.end,
                "label": range.label ?? ""
            ]
        }
        let dayOff = methodist?.dayOff ?? []
        let bulkDeleteTargetStillPresent = state.rotators.contains { $0.id == bulkDeleteId || $0.fullName == bulkDeleteName }
        let duplicateStillPresent = state.rotators.filter { $0.fullName == duplicateName }.count > 1
        let dedupeRemovedCount = beforeDedupeRotatorCount - state.rotators.count
        let dedupedSegments = (dedupedDuplicate?.segments ?? []).map { segment in
            [
                "start": segment.start,
                "end": segment.end,
                "defaultPhase": segment.defaultPhase ?? ""
            ]
        }
        let duplicateInpatientRepointed = state.inpatientAssignments.contains {
            $0.date == "2026-10-07" && $0.rotatorId == duplicateKeeperId
        }
        let duplicateOutpatientRepointed = state.outpatientSessions.contains {
            $0.date == "2026-10-08" && $0.period == "AM" && $0.rotatorId == duplicateKeeperId
        }

        RotatorsEditProbe.write([
            "ok": state.activeBlockId == initialState.activeBlockId
                && methodist != nil
                && !bulkDeleteTargetStillPresent
                && !duplicateStillPresent
                && dedupeRemovedCount == 1
                && duplicateInpatientRepointed
                && duplicateOutpatientRepointed
                && dedupedSegments == [
                    ["start": "2026-10-07", "end": "2026-10-07", "defaultPhase": "inpatient"],
                    ["start": "2026-10-08", "end": "2026-10-08", "defaultPhase": "outpatient"]
                ]
                && state.rotators.count == initialRotatorCount + 2
                && methodist?.fullName == targetName
                && methodist?.displayName == "Maya L."
                && methodist?.program == "Methodist"
                && methodist?.level == "PGY-4"
                && methodist?.schoolType == "methodist"
                && methodist?.role == "Resident"
                && methodist?.continuityClinic == "Thursday AM"
                && methodist?.rotationStartDate == "2026-10-06"
                && methodist?.methodistStartSide == "outpatient"
                && segmentSummaries == [
                    ["start": "2026-10-05", "end": "2026-10-16", "defaultPhase": "inpatient"],
                    ["start": "2026-10-19", "end": "2026-10-30", "defaultPhase": "outpatient"]
                ]
                && dayOff == ["Monday", "Friday"]
                && unavailableSummaries == [
                    ["start": "2026-10-20", "end": "2026-10-21", "label": "Vacation"]
                ],
            "screen": "Rotators",
            "blockId": state.activeBlockId,
            "blockName": state.activeBlock?.name ?? "",
            "initialRotatorCount": initialRotatorCount,
            "afterRotatorCount": state.rotators.count,
            "addedRotatorId": methodistId,
            "bulkDeletedRotatorId": bulkDeleteId,
            "bulkDeleteTargetStillPresent": bulkDeleteTargetStillPresent,
            "dedupeRemovedCount": dedupeRemovedCount,
            "duplicateName": duplicateName,
            "duplicateKeeperId": duplicateKeeperId,
            "duplicateRemovedId": duplicateTargetId,
            "duplicateStillPresent": duplicateStillPresent,
            "duplicateInpatientRepointed": duplicateInpatientRepointed,
            "duplicateOutpatientRepointed": duplicateOutpatientRepointed,
            "dedupedSegments": dedupedSegments,
            "fullName": methodist?.fullName ?? "",
            "displayName": methodist?.displayName ?? "",
            "program": methodist?.program ?? "",
            "level": methodist?.level ?? "",
            "role": methodist?.role ?? "",
            "schoolType": methodist?.schoolType ?? "",
            "continuityClinic": methodist?.continuityClinic ?? "",
            "rotationStartDate": methodist?.rotationStartDate ?? "",
            "methodistStartSide": methodist?.methodistStartSide ?? "",
            "segments": segmentSummaries,
            "dayOff": dayOff,
            "unavailableRanges": unavailableSummaries,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }

    private func removeSegment(at index: Int) {
        guard draft.segments.indices.contains(index), draft.segments.count > 1 else { return }
        draft.segments.remove(at: index)
    }

    private func removeUnavailableRange(at index: Int) {
        guard draft.unavailableRanges.indices.contains(index) else { return }
        draft.unavailableRanges.remove(at: index)
    }

    private func rowDetail(_ rotator: Rotator) -> String {
        let program = rotator.program ?? "Program"
        let level = rotator.level ?? "Level"
        let dates = segmentSummary(rotator)
        return "\(program) - \(level) - \(dates)"
    }

    private func segmentSummary(_ rotator: Rotator) -> String {
        let segments = rotator.segments ?? []
        guard !segments.isEmpty else { return "No dates" }
        if segments.count == 1, let segment = segments.first {
            return segment.label
        }
        return "\(segments.count) segments"
    }

    private let programs = [
        "Methodist",
        "UT Adult Neuro",
        "UT Pediatrics",
        "UT Pediatric Neurology Fellow",
        "UT Med Student",
        "UT Psychiatry",
        "Other",
    ]
}

private enum RotatorsEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_ROTATORS_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-rotators-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Rotators edit probe: \(error.localizedDescription)")
        }
    }
}

private struct RotatorDraft {
    var fullName = ""
    var program = "UT Pediatrics"
    var level = "PGY-2"
    var segments: [RotatorSegmentDraft] = [RotatorSegmentDraft()]
    var continuityClinic = ""
    var rotationStartDate = ""
    var methodistStartSide: MethodistStartSide = .auto
    var dayOff: [String] = []
    var unavailableRanges: [UnavailableRangeDraft] = []

    // Originals from the loaded rotator, so patch can send role/displayName
    // only when the edit actually implies a change instead of clobbering
    // backend values (e.g. a curated role="Fellow" on a PGY-4, or a custom
    // short displayName).
    private var originalLevel = ""
    private var originalDisplayName = ""
    private var originalFullName = ""
    private var originalProgram = ""

    init() {}

    init(rotator: Rotator) {
        fullName = rotator.fullName ?? rotator.displayName ?? ""
        program = rotator.program ?? "Other"
        originalProgram = program
        level = rotator.level ?? "PGY-2"
        let decodedSegments = (rotator.segments ?? []).map(RotatorSegmentDraft.init(segment:))
        segments = decodedSegments.isEmpty ? [RotatorSegmentDraft()] : decodedSegments
        continuityClinic = rotator.continuityClinic ?? ""
        rotationStartDate = rotator.rotationStartDate ?? ""
        methodistStartSide = MethodistStartSide(rawValue: rotator.methodistStartSide ?? "") ?? .auto
        dayOff = rotatorWeekdays.filter { (rotator.dayOff ?? []).contains($0) }
        unavailableRanges = (rotator.unavailableRanges ?? []).map(UnavailableRangeDraft.init(range:))
        originalLevel = level
        originalDisplayName = rotator.displayName ?? ""
        originalFullName = rotator.fullName ?? ""
    }

    var isComplete: Bool {
        !fullName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !program.isEmpty &&
        !level.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !segmentsPayload.isEmpty &&
        hasValidSegments &&
        hasValidUnavailableRanges
    }

    /// Every non-blank segment row must parse to a valid start<=end ISO
    /// range, otherwise a typo like "10/5/2026" would silently vanish from
    /// segmentsPayload and misclassify the rotator as inactive.
    var hasValidSegments: Bool {
        segments.allSatisfy { $0.isBlank || $0.payload != nil }
    }

    /// Fully blank rows are ignorable (the + button adds one); anything
    /// partially filled must parse, otherwise Save would silently discard
    /// the range the user believes was saved.
    var hasValidUnavailableRanges: Bool {
        unavailableRanges.allSatisfy { $0.isBlank || $0.payload != nil }
    }

    var addInput: [String: Any] {
        [
            "fullName": fullName,
            "program": program,
            "level": level,
            "segments": segmentsPayload,
            "continuityClinic": continuityClinic,
            "rotationStartDate": methodistRotationStartDatePayload,
            "methodistStartSide": methodistStartSidePayload,
            "dayOff": dayOff,
            "unavailableRanges": unavailableRangesPayload,
        ]
    }

    var patch: [String: Any] {
        var out: [String: Any] = [
            "fullName": fullName,
            "program": program,
            "level": level,
            "schoolType": inferredSchoolType,
            "segments": segmentsPayload,
            "continuityClinic": continuityClinic,
            "rotationStartDate": methodistRotationStartDatePayload,
            "methodistStartSide": methodistStartSidePayload,
            "dayOff": dayOff,
            "unavailableRanges": unavailableRangesPayload,
        ]
        // Re-derive role only when the Level or Program actually changed;
        // otherwise omit it so a curated role (e.g. Fellow at PGY-4)
        // survives unrelated edits.
        if level != originalLevel || program != originalProgram {
            out["role"] = inferredRole
        }
        // Sync displayName with fullName only when it was auto-derived;
        // a custom short name must survive edits to other fields.
        if originalDisplayName.isEmpty || originalDisplayName == originalFullName {
            out["displayName"] = fullName
        }
        return out
    }

    var isMethodist: Bool {
        program == "Methodist"
    }

    private var methodistRotationStartDatePayload: String {
        isMethodist ? rotationStartDate.trimmingCharacters(in: .whitespacesAndNewlines) : ""
    }

    private var methodistStartSidePayload: String {
        isMethodist ? methodistStartSide.payloadValue : ""
    }

    private var segmentsPayload: [[String: Any]] {
        segments.compactMap(\.payload)
    }

    private var unavailableRangesPayload: [[String: Any]] {
        unavailableRanges.compactMap(\.payload)
    }

    mutating func setDayOff(_ weekday: String, isOn: Bool) {
        if isOn {
            if !dayOff.contains(weekday) {
                dayOff = rotatorWeekdays.filter { dayOff.contains($0) || $0 == weekday }
            }
        } else {
            dayOff.removeAll { $0 == weekday }
        }
    }

    private var inferredRole: String {
        if level == "Fellow" || program == "UT Pediatric Neurology Fellow" { return "Fellow" }
        if level.hasPrefix("MS") { return "Student" }
        return "Resident"
    }

    private var inferredSchoolType: String {
        switch program {
        case "Methodist": return "methodist"
        case "UT Adult Neuro": return "ut-adult"
        case "UT Pediatrics": return "ut-peds"
        case "UT Pediatric Neurology Fellow": return "ut-peds"
        case "UT Med Student": return "ut-student"
        case "UT Psychiatry": return "ut-psychiatry"
        default: return "other"
        }
    }
}

private struct UnavailableRangeDraft: Identifiable, Equatable {
    var id = UUID().uuidString
    var startDate = ""
    var endDate = ""
    var label = ""

    init() {}

    init(range: UnavailableRange) {
        startDate = range.start
        endDate = range.end
        label = range.label ?? ""
    }

    var isBlank: Bool {
        startDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        endDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var payload: [String: Any]? {
        let start = startDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let end = endDate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isISODate(start), Self.isISODate(end), start <= end else { return nil }
        var out: [String: Any] = ["start": start, "end": end]
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLabel.isEmpty {
            out["label"] = trimmedLabel
        }
        return out
    }

    private static func isISODate(_ value: String) -> Bool {
        value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }
}

private enum SegmentDefaultPhase: String, CaseIterable, Identifiable {
    case none
    case inpatient
    case outpatient

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "None"
        case .inpatient: return "IP first"
        case .outpatient: return "OP first"
        }
    }
}

private enum MethodistStartSide: String, CaseIterable, Identifiable {
    case auto = ""
    case inpatient
    case outpatient

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto: return "Auto"
        case .inpatient: return "IP first"
        case .outpatient: return "OP first"
        }
    }

    var payloadValue: String { rawValue }
}

private struct RotatorSegmentDraft: Identifiable, Equatable {
    var id = UUID().uuidString
    var startDate = ""
    var endDate = ""
    var defaultPhase: SegmentDefaultPhase = .none

    init() {}

    init(segment: RotatorSegment) {
        startDate = segment.start
        endDate = segment.end
        switch segment.defaultPhase {
        case "inpatient":
            defaultPhase = .inpatient
        case "outpatient":
            defaultPhase = .outpatient
        default:
            defaultPhase = .none
        }
    }

    var isBlank: Bool {
        startDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        endDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var payload: [String: Any]? {
        let start = startDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let end = endDate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard CalendarUtil.isISODate(start), CalendarUtil.isISODate(end), start <= end else { return nil }
        var out: [String: Any] = ["start": start, "end": end]
        if defaultPhase != .none {
            out["defaultPhase"] = defaultPhase.rawValue
        }
        return out
    }
}

private extension RotatorSegment {
    var label: String {
        let phase: String
        switch defaultPhase {
        case "inpatient":
            phase = " IP"
        case "outpatient":
            phase = " OP"
        default:
            phase = ""
        }
        return "\(start) to \(end)\(phase)"
    }
}

private let rotatorWeekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
