import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Live settings — and the Phase-1 proof that a native control drives the
/// Python engine: changing "max consecutive inpatient days" issues a
/// `rules.patch` command, the backend applies + persists it, and the returned
/// state re-renders here. This is the full native → engine → state loop with
/// no WebView anywhere in it.
struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var isImporting = false
    @State private var blockAction: BlockAction?
    @State private var confirmingBlockDelete = false
    @State private var blockName = ""
    @State private var blockStartDate = ""
    @State private var blockEndDate = ""
    @State private var blockStatus = ""
    @State private var weekdayCoverage = 2
    @State private var saturdayCoverage = 2
    @State private var sundayCoverage = 2
    @State private var holidayCoverage = 2
    @State private var holidayDrafts: [HolidayDraft] = []
    @State private var newHolidayDate = ""
    @State private var newHolidayLabel = ""
    @State private var newHolidayNoClinic = true
    @State private var isSavingCoverage = false
    @State private var rulesAction = false
    @State private var pendingRulesPatch: [String: Any]?
    @State private var holidayAction = ""
    @State private var posterProgramName = ""
    @State private var posterChief = ""
    @State private var posterTagline = ""
    @State private var posterLocations: [PosterLocationDraft] = []
    @State private var posterNotes = ""
    @State private var isSavingPoster = false
    @State private var newAttendingName = ""
    @State private var attendingAction = ""
    @State private var newExpectedSource = ""
    @State private var expectedSourceAction = ""
    @State private var rosterImportMode: RosterImportMode = .merge
    @State private var pendingRosterImport: RosterImportResult?
    @State private var isApplyingRosterImport = false
    @State private var pendingCoordinatorImport: CoordinatorImportResult?
    @State private var isApplyingCoordinatorImport = false
    // Rendered inside the review sheets; store.lastMessage is occluded while
    // a sheet is up, so commit failures need their own surface.
    @State private var importApplyErrorMessage: String?
    @State private var backupAction: BackupAction?
    @State private var settingsEditProbeStarted = false

    var body: some View {
        VStack(spacing: 0) {
            settingsForm
            if let message = store.lastMessage, !message.isEmpty {
                Divider()
                Label(message, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            syncBlockDraft()
            syncPosterDraft()
            runSettingsEditProbeIfRequested()
        }
        .onChange(of: store.state?.activeBlockId) { _ in syncBlockDraft() }
        .onChange(of: store.state?.posterSettings) { _ in syncPosterDraft() }
        .sheet(item: $pendingRosterImport) { result in
            RosterImportReviewSheet(
                result: result,
                isApplying: isApplyingRosterImport,
                errorMessage: importApplyErrorMessage,
                onCancel: {
                    if !isApplyingRosterImport {
                        pendingRosterImport = nil
                    }
                },
                onConfirm: { columnMapping, matrixBangBehavior in
                    applyRosterImport(result, columnMapping: columnMapping, matrixBangBehavior: matrixBangBehavior)
                },
                onRemap: { columnMapping, matrixBangBehavior in
                    await remapRosterImport(result, columnMapping: columnMapping, matrixBangBehavior: matrixBangBehavior)
                }
            )
        }
        .sheet(item: $pendingCoordinatorImport) { result in
            CoordinatorImportReviewSheet(
                result: result,
                isApplying: isApplyingCoordinatorImport,
                errorMessage: importApplyErrorMessage,
                onCancel: {
                    if !isApplyingCoordinatorImport {
                        pendingCoordinatorImport = nil
                    }
                },
                onConfirm: {
                    applyCoordinatorImport(result)
                }
            )
        }
        .confirmationDialog("Delete active block?", isPresented: $confirmingBlockDelete) {
            Button("Delete Block", role: .destructive) {
                deleteActiveBlock()
            }
        }
    }

    private var settingsForm: some View {
        Form {
            Section("Service Blocks") {
                if let state = store.state {
                    Picker(
                        "Active block",
                        selection: Binding(
                            get: { state.activeBlockId },
                            set: { switchBlock($0) }
                        )
                    ) {
                        ForEach(state.serviceBlocks.sorted { $0.startDate < $1.startDate }) { block in
                            Text(block.name).tag(block.id)
                        }
                    }

                    if let block = state.activeBlock {
                        TextField("Name", text: $blockName)
                            .textFieldStyle(.roundedBorder)

                        TextField("Status", text: $blockStatus)
                            .textFieldStyle(.roundedBorder)

                        HStack(spacing: 10) {
                            TextField("Start date", text: $blockStartDate)
                                .textFieldStyle(.roundedBorder)
                            TextField("End date", text: $blockEndDate)
                                .textFieldStyle(.roundedBorder)
                        }
                        if !blockDatesAreValid {
                            Label("Dates must be YYYY-MM-DD, with start on or before end.", systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }

                        Button {
                            updateBlock(block)
                        } label: {
                            if blockAction == .update {
                                HStack(spacing: 7) {
                                    ProgressView().controlSize(.small)
                                    Text("Saving")
                                }
                            } else {
                                Label("Save Block", systemImage: "checkmark")
                            }
                        }
                        .disabled(blockAction != nil || !canSaveBlock(block))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Coverage Demand", systemImage: "person.2")
                            .font(.callout.bold())
                        CoverageStepper(title: "Weekday", value: $weekdayCoverage, isDisabled: isSavingCoverage) {
                            saveCoverage()
                        }
                        CoverageStepper(title: "Saturday", value: $saturdayCoverage, isDisabled: isSavingCoverage) {
                            saveCoverage()
                        }
                        CoverageStepper(title: "Sunday", value: $sundayCoverage, isDisabled: isSavingCoverage) {
                            saveCoverage()
                        }
                        CoverageStepper(title: "Holiday", value: $holidayCoverage, isDisabled: isSavingCoverage) {
                            saveCoverage()
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Holidays", systemImage: "calendar.badge.exclamationmark")
                            .font(.callout.bold())
                        if holidayDrafts.isEmpty {
                            Text("No holidays for this block.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(holidayDrafts) { holiday in
                                HolidayDraftRow(
                                    holiday: holiday,
                                    isBusy: holidayAction == holiday.id,
                                    actionsDisabled: holidayAction != "",
                                    onDateChange: { editHoliday(holiday, date: $0) },
                                    onLabelChange: { editHoliday(holiday, label: $0) },
                                    onNoClinicChange: { editHoliday(holiday, noClinic: $0) },
                                    onSave: { saveHoliday(holiday) },
                                    onRemove: { removeHoliday(holiday) }
                                )
                            }
                        }

                        HStack(spacing: 8) {
                            TextField("YYYY-MM-DD", text: $newHolidayDate)
                                .textFieldStyle(.roundedBorder)
                            TextField("Label", text: $newHolidayLabel)
                                .textFieldStyle(.roundedBorder)
                            Toggle("No clinic", isOn: $newHolidayNoClinic)
                                .toggleStyle(.checkbox)
                            Button {
                                addHoliday()
                            } label: {
                                if holidayAction == "__add" {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "plus")
                                }
                            }
                            .help("Add holiday")
                            .disabled(holidayAction != "" || !hasValidHolidayDate)
                        }
                        if !newHolidayDate.isEmpty && !hasValidHolidayDate {
                            Label("Holiday date must be YYYY-MM-DD.", systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }

                    HStack(spacing: 10) {
                        Button {
                            addBlock()
                        } label: {
                            if blockAction == .add {
                                HStack(spacing: 7) {
                                    ProgressView().controlSize(.small)
                                    Text("Adding")
                                }
                            } else {
                                Label("Add Block", systemImage: "plus")
                            }
                        }
                        .disabled(blockAction != nil)

                        Button(role: .destructive) {
                            confirmingBlockDelete = true
                        } label: {
                            if blockAction == .delete {
                                HStack(spacing: 7) {
                                    ProgressView().controlSize(.small)
                                    Text("Deleting")
                                }
                            } else {
                                Label("Delete Block", systemImage: "trash")
                            }
                        }
                        .disabled(blockAction != nil || state.serviceBlocks.count <= 1)
                    }
                } else {
                    Text("Loading blocks…").foregroundStyle(.secondary)
                }
            }

            Section("Scheduling rules (live)") {
                if let rules = store.state?.rules {
                    Stepper(
                        "Max consecutive inpatient days: \(rules.maxConsecutiveInpatientDays ?? 6)",
                        value: Binding(
                            get: { rules.maxConsecutiveInpatientDays ?? 6 },
                            set: { newValue in
                                patchRules(["maxConsecutiveInpatientDays": newValue])
                            }
                        ),
                        in: 1...14
                    )
                    .disabled(rulesAction)

                    Toggle(
                        "Honor no-clinic holidays",
                        isOn: Binding(
                            get: { rules.honorNoClinicHolidays ?? true },
                            set: { newValue in
                                patchRules(["honorNoClinicHolidays": newValue])
                            }
                        )
                    )
                    .disabled(rulesAction)
                } else {
                    Text("Loading rules…").foregroundStyle(.secondary)
                }
            }

            Section("Clinic Attendings") {
                if let state = store.state {
                    HStack(spacing: 8) {
                        TextField("Name", text: $newAttendingName)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            addAttending()
                        } label: {
                            if attendingAction == "__add" {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: "plus")
                            }
                        }
                        .help("Add attending")
                        .disabled(attendingAction != "" || newAttendingName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    ForEach((state.attendings ?? []).sorted { $0.name < $1.name }, id: \.name) { attending in
                        AttendingProfileSettings(
                            attending: attending,
                            isBusy: attendingAction == attending.name,
                            actionsDisabled: attendingAction != "",
                            onSaveProfile: { recurring, oneOffs in
                                saveAttendingProfile(attending: attending, recurring: recurring, oneOffs: oneOffs)
                            },
                            onRemove: {
                                removeAttending(attending.name)
                            }
                        )
                    }
                } else {
                    Text("Loading attendings…").foregroundStyle(.secondary)
                }
            }

            Section("Expected Sources") {
                if let state = store.state {
                    let readiness = SourceReadiness(state: state)
                    let readinessByProgram = Dictionary(
                        uniqueKeysWithValues: readiness.expectedPrograms.map { ($0.program.lowercased(), $0) }
                    )

                    HStack(spacing: 8) {
                        CountBadge(
                            text: readiness.allIn ? "All in" : "\(readiness.waitingCount) waiting",
                            color: readiness.allIn ? .green : .orange
                        )
                        Text(readiness.summaryText)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }

                    HStack(spacing: 8) {
                        TextField("Program", text: $newExpectedSource)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            addExpectedSource()
                        } label: {
                            if expectedSourceAction == "__add" {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: "plus")
                            }
                        }
                        .help("Add expected source")
                        .disabled(expectedSourceAction != "" || newExpectedSource.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    ForEach((state.expectedSourcePrograms ?? []).sorted(), id: \.self) { program in
                        HStack {
                            if let item = readinessByProgram[program.lowercased()] {
                                Image(systemName: item.symbol)
                                    .foregroundStyle(item.color)
                                    .accessibilityIdentifier("settings-expected-source-status-\(program)")
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(program)
                                    Text(item.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer()
                                if item.status != .reviewed {
                                    Button("Open Sources") {
                                        store.screenSelection = .sources
                                    }
                                    .buttonStyle(.link)
                                    .font(.caption)
                                }
                            } else {
                                Text(program)
                                Spacer()
                            }
                            Button(role: .destructive) {
                                removeExpectedSource(program)
                            } label: {
                                if expectedSourceAction == program {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "minus.circle")
                                }
                            }
                            .buttonStyle(.borderless)
                            .help("Remove from expected sources (mark as not expected)")
                            .disabled(expectedSourceAction != "")
                        }
                    }
                } else {
                    Text("Loading sources…").foregroundStyle(.secondary)
                }
            }

            Section("Poster") {
                TextField("Program name", text: $posterProgramName)
                    .textFieldStyle(.roundedBorder)
                TextField("Chief", text: $posterChief)
                    .textFieldStyle(.roundedBorder)
                TextField("Tagline", text: $posterTagline)
                    .textFieldStyle(.roundedBorder)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("Locations", systemImage: "mappin.and.ellipse")
                            .font(.callout.bold())
                        Spacer()
                        Button {
                            addPosterLocation()
                        } label: {
                            Image(systemName: "plus")
                        }
                        .buttonStyle(.borderless)
                        .help("Add location")
                        .disabled(isSavingPoster)
                    }

                    if posterLocations.isEmpty {
                        Text("No locations yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach($posterLocations) { $location in
                            PosterLocationDraftRow(
                                location: $location,
                                isDisabled: isSavingPoster,
                                onRemove: { removePosterLocation(location.id) }
                            )
                        }
                    }
                }
                TextEditor(text: $posterNotes)
                    .font(.body)
                    .frame(height: 92)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.secondary.opacity(0.2))
                    )

                Button {
                    savePosterSettings()
                } label: {
                    if isSavingPoster {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Saving")
                        }
                    } else {
                        Label("Save Poster", systemImage: "checkmark")
                    }
                }
                .disabled(isSavingPoster || !canSavePoster)
            }

            Section("Import") {
                Picker("Roster mode", selection: $rosterImportMode) {
                    ForEach(RosterImportMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                Text(rosterImportMode.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button {
                    chooseRosterFile()
                } label: {
                    if isImporting {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Importing")
                        }
                    } else {
                        Label("Choose Roster File", systemImage: "person.crop.rectangle.stack")
                    }
                }
                .disabled(isImporting)

                Button {
                    chooseCoordinatorBundle()
                } label: {
                    if isImporting {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Importing")
                        }
                    } else {
                        Label("Choose DOCX Files", systemImage: "folder")
                    }
                }
                .disabled(isImporting)

                Button {
                    importDefaultCoordinatorBundle()
                } label: {
                    if isImporting {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Importing")
                        }
                    } else {
                        Label("Import Coordinator DOCX", systemImage: "square.and.arrow.down")
                    }
                }
                .disabled(isImporting)

                LabeledContent("Quick import", value: "Known DOCX bundle in Downloads")
            }

            Section("Backup") {
                Button {
                    chooseBackupDestination()
                } label: {
                    if backupAction == .export {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Saving")
                        }
                    } else {
                        Label("Save JSON Backup", systemImage: "square.and.arrow.up")
                    }
                }
                .disabled(backupAction != nil || store.state == nil)

                Button {
                    chooseBackupToRestore()
                } label: {
                    if backupAction == .restore {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Restoring")
                        }
                    } else {
                        Label("Restore JSON Backup", systemImage: "arrow.down.doc")
                    }
                }
                .disabled(backupAction != nil)
            }

            Section("Local Engine") {
                LabeledContent("Mode", value: "Runs only on this Mac")
                LabeledContent("Privacy", value: "Nothing leaves this machine")
                Button("Reload schedule data") {
                    Task { await store.reload() }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func syncBlockDraft() {
        guard let block = store.state?.activeBlock else {
            blockName = ""
            blockStartDate = ""
            blockEndDate = ""
            blockStatus = ""
            holidayDrafts = []
            return
        }
        blockName = block.name
        blockStartDate = block.startDate
        blockEndDate = block.endDate
        blockStatus = block.status ?? "Draft"
        weekdayCoverage = block.coverageCount(for: .weekday)
        saturdayCoverage = block.coverageCount(for: .saturday)
        sundayCoverage = block.coverageCount(for: .sunday)
        holidayCoverage = block.coverageCount(for: .holiday)
        holidayDrafts = (block.holidays ?? []).map { HolidayDraft(holiday: $0) }.sorted { $0.date < $1.date }
    }

    private var blockDatesAreValid: Bool {
        CalendarUtil.isISODate(blockStartDate) && CalendarUtil.isISODate(blockEndDate) && blockStartDate <= blockEndDate
    }

    private func canSaveBlock(_ block: ServiceBlock) -> Bool {
        blockAction == nil
            && !blockName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && blockDatesAreValid
            && (
                blockName != block.name
                    || blockStartDate != block.startDate
                    || blockEndDate != block.endDate
                    || blockStatus != (block.status ?? "Draft")
        )
    }

    private func syncPosterDraft() {
        let settings = store.state?.posterSettings ?? .fallback
        posterProgramName = settings.programName ?? PosterSettings.fallback.programName ?? ""
        posterChief = settings.chief ?? ""
        posterTagline = settings.tagline ?? PosterSettings.fallback.tagline ?? ""
        posterLocations = (settings.locations ?? PosterSettings.fallback.locations ?? []).map(PosterLocationDraft.init)
        posterNotes = (settings.notes ?? PosterSettings.fallback.notes ?? []).joined(separator: "\n")
    }

    private var canSavePoster: Bool {
        guard !posterProgramName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let current = store.state?.posterSettings ?? .fallback
        let currentLocations = (current.locations ?? PosterSettings.fallback.locations ?? [])
            .map(PosterLocationDraft.init)
            .map(\.payload)
        return posterProgramName != (current.programName ?? PosterSettings.fallback.programName ?? "")
            || posterChief != (current.chief ?? "")
            || posterTagline != (current.tagline ?? PosterSettings.fallback.tagline ?? "")
            || posterLocations.map(\.payload) != currentLocations
            || posterNotes != (current.notes ?? PosterSettings.fallback.notes ?? []).joined(separator: "\n")
    }

    private func addPosterLocation() {
        posterLocations.append(PosterLocationDraft())
    }

    private func removePosterLocation(_ id: String) {
        posterLocations.removeAll { $0.id == id }
    }

    private func switchBlock(_ id: String) {
        guard blockAction == nil, store.state?.activeBlockId != id else { return }
        blockAction = .use
        Task {
            await store.run("block.use", input: ["blockRef": id])
            blockAction = nil
        }
    }

    private func addBlock() {
        guard blockAction == nil else { return }
        blockAction = .add
        Task {
            await store.run("block.add")
            blockAction = nil
        }
    }

    private func updateBlock(_ block: ServiceBlock) {
        guard blockAction == nil else { return }
        blockAction = .update
        let patch: [String: Any] = [
            "name": blockName.trimmingCharacters(in: .whitespacesAndNewlines),
            "startDate": blockStartDate,
            "endDate": blockEndDate,
            "status": blockStatus.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        Task {
            await store.run("block.update", input: ["blockRef": block.id, "patch": patch])
            blockAction = nil
        }
    }

    private func saveCoverage() {
        guard !isSavingCoverage, let block = store.state?.activeBlock else { return }
        isSavingCoverage = true
        let patch: [String: Any] = ["coverage": coveragePayload()]
        Task {
            await store.run("block.update", input: ["blockRef": block.id, "patch": patch])
            isSavingCoverage = false
        }
    }

    /// Single-flight `rules.patch`: a Stepper tick or Toggle flip while a
    /// patch is already in flight just replaces the pending value instead of
    /// firing another concurrent command (which let out-of-order responses
    /// make the displayed value bounce backward).
    private func patchRules(_ patch: [String: Any]) {
        guard !rulesAction else {
            pendingRulesPatch = patch
            return
        }
        rulesAction = true
        Task {
            var next = patch
            while true {
                await store.run("rules.patch", input: ["patch": next])
                guard let queued = pendingRulesPatch else { break }
                pendingRulesPatch = nil
                next = queued
            }
            rulesAction = false
        }
    }

    private func coveragePayload() -> [String: Any] {
        // block.update replaces coverage wholesale, so echo back the fields
        // this form doesn't edit (per-role minimums set via CLI/browser)
        // instead of dropping them.
        let existing = store.state?.activeBlock?.coverage
        func ip(_ count: Int, _ day: CoverageDay?) -> [String: Any] {
            var out: [String: Any] = ["count": count]
            if let byRole = day?.ip?.byRole, !byRole.isEmpty {
                out["byRole"] = byRole
            }
            return out
        }
        return [
            "weekday": ["ip": ip(weekdayCoverage, existing?.weekday)],
            "saturday": ["ip": ip(saturdayCoverage, existing?.saturday)],
            "sunday": ["ip": ip(sundayCoverage, existing?.sunday)],
            "holiday": ["ip": ip(holidayCoverage, existing?.holiday)],
        ]
    }

    private var hasValidHolidayDate: Bool {
        CalendarUtil.isISODate(newHolidayDate.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func addHoliday() {
        guard holidayAction == "", hasValidHolidayDate, let block = store.state?.activeBlock else { return }
        let date = newHolidayDate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !date.isEmpty else { return }
        holidayAction = "__add"
        let label = newHolidayLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        var next = holidayDrafts.filter { $0.date != date }
        next.append(HolidayDraft(date: date, label: label.isEmpty ? "Holiday" : label, noClinic: newHolidayNoClinic))
        next.sort { $0.date < $1.date }
        holidayDrafts = next
        Task {
            let ok = await store.run("block.update", input: ["blockRef": block.id, "patch": ["holidays": next.map(\.payload)]])
            if ok {
                newHolidayDate = ""
                newHolidayLabel = ""
                newHolidayNoClinic = true
            } else {
                syncBlockDraft()
            }
            holidayAction = ""
        }
    }

    private func editHoliday(_ holiday: HolidayDraft, date: String? = nil, label: String? = nil, noClinic: Bool? = nil) {
        var next = holidayDrafts
        guard let index = next.firstIndex(where: { $0.id == holiday.id }) else { return }
        next[index] = HolidayDraft(
            id: holiday.id,
            date: date ?? holiday.date,
            label: label ?? holiday.label,
            noClinic: noClinic ?? holiday.noClinic
        )
        holidayDrafts = next
    }

    private func saveHoliday(_ holiday: HolidayDraft) {
        guard holidayAction == "", let block = store.state?.activeBlock else { return }
        holidayAction = holiday.id
        let next = holidayDrafts.sorted { $0.date < $1.date }
        holidayDrafts = next
        Task {
            let ok = await store.run("block.update", input: ["blockRef": block.id, "patch": ["holidays": next.map(\.payload)]])
            if !ok {
                syncBlockDraft()
            }
            holidayAction = ""
        }
    }

    private func removeHoliday(_ holiday: HolidayDraft) {
        guard holidayAction == "", let block = store.state?.activeBlock else { return }
        holidayAction = holiday.id
        let next = holidayDrafts.filter { $0.id != holiday.id }
        holidayDrafts = next
        Task {
            let ok = await store.run("block.update", input: ["blockRef": block.id, "patch": ["holidays": next.map(\.payload)]])
            if !ok {
                syncBlockDraft()
            }
            holidayAction = ""
        }
    }

    private func savePosterSettings() {
        guard !isSavingPoster, canSavePoster else { return }
        isSavingPoster = true
        let notes = posterNotes
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let patch: [String: Any] = [
            "programName": posterProgramName.trimmingCharacters(in: .whitespacesAndNewlines),
            "chief": posterChief.trimmingCharacters(in: .whitespacesAndNewlines),
            "tagline": posterTagline.trimmingCharacters(in: .whitespacesAndNewlines),
            "notes": notes,
            "locations": posterLocations.map(\.payload),
        ]
        Task {
            await store.run("posterSettings.patch", input: ["patch": patch])
            isSavingPoster = false
        }
    }

    private func addAttending() {
        let name = newAttendingName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard attendingAction == "", !name.isEmpty else { return }
        attendingAction = "__add"
        Task {
            await store.run("attending.add", input: ["name": name])
            newAttendingName = ""
            attendingAction = ""
        }
    }

    private func removeAttending(_ name: String) {
        guard attendingAction == "" else { return }
        attendingAction = name
        Task {
            await store.run("attending.remove", input: ["name": name])
            attendingAction = ""
        }
    }

    private func saveAttendingProfile(attending: Attending, recurring: [RecurringClinic], oneOffs: [OneOffClinic]) {
        updateAttending(
            attending.name,
            patch: [
                "recurringClinics": recurring.map(recurringPayload),
                "oneOffDates": oneOffs.map(oneOffPayload),
            ]
        )
    }

    private func updateAttending(_ name: String, patch: [String: Any]) {
        guard attendingAction == "" else { return }
        attendingAction = name
        Task {
            await store.run("attending.update", input: ["name": name, "patch": patch])
            attendingAction = ""
        }
    }

    private func recurringPayload(_ clinic: RecurringClinic) -> [String: Any] {
        var payload: [String: Any] = [
            "weekday": clinic.weekday ?? "",
            "period": clinic.effectivePeriod,
        ]
        if let id = clinic.id, !id.isEmpty {
            payload["id"] = id
        }
        if let clinicName = clinic.clinicName, !clinicName.isEmpty {
            payload["clinicName"] = clinicName
        }
        if let location = clinic.location, !location.isEmpty {
            payload["location"] = location
        }
        if let capacity = clinic.capacity {
            payload["capacity"] = capacity
        }
        if let allowedRoles = normalizedClinicRoles(clinic.allowedRoles), !allowedRoles.isEmpty {
            payload["allowedRoles"] = allowedRoles
        }
        if let active = clinic.active {
            payload["active"] = active
        }
        return payload
    }

    private func oneOffPayload(_ slot: OneOffClinic) -> [String: Any] {
        var payload: [String: Any] = [
            "date": slot.date ?? "",
            "period": slot.effectivePeriod,
        ]
        if let id = slot.id, !id.isEmpty {
            payload["id"] = id
        }
        if let clinicName = slot.clinicName, !clinicName.isEmpty {
            payload["clinicName"] = clinicName
        }
        if let location = slot.location, !location.isEmpty {
            payload["location"] = location
        }
        if let capacity = slot.capacity {
            payload["capacity"] = capacity
        }
        if let allowedRoles = normalizedClinicRoles(slot.allowedRoles), !allowedRoles.isEmpty {
            payload["allowedRoles"] = allowedRoles
        }
        return payload
    }

    private func normalizedClinicRoles(_ roles: [String]?) -> [String]? {
        guard let roles else { return nil }
        let selected = Set(roles)
        return clinicPolicyRoles.filter { selected.contains($0) }
    }

    private func parseCapacity(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let capacity = Int(trimmed) else { return nil }
        return max(0, capacity)
    }

    private func addExpectedSource() {
        let program = newExpectedSource.trimmingCharacters(in: .whitespacesAndNewlines)
        guard expectedSourceAction == "", !program.isEmpty else { return }
        expectedSourceAction = "__add"
        Task {
            await store.run("expectedSource.add", input: ["program": program])
            newExpectedSource = ""
            expectedSourceAction = ""
        }
    }

    private func removeExpectedSource(_ program: String) {
        guard expectedSourceAction == "" else { return }
        expectedSourceAction = program
        Task {
            await store.run("expectedSource.remove", input: ["program": program])
            expectedSourceAction = ""
        }
    }

    private func deleteActiveBlock() {
        guard blockAction == nil, let id = store.state?.activeBlockId else { return }
        blockAction = .delete
        Task {
            await store.run("block.delete", input: ["blockRef": id])
            blockAction = nil
        }
    }

    private func chooseCoordinatorBundle() {
        guard !isImporting else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [UTType(filenameExtension: "docx") ?? .data]
        panel.prompt = "Import"
        panel.message = "Choose the Master Schedule, Inpatient Roster, and Outpatient Assignments DOCX files."
        guard panel.runModal() == .OK else { return }
        importCoordinatorBundle(urls: panel.urls)
    }

    private func chooseRosterFile() {
        guard !isImporting else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = rosterContentTypes
        panel.prompt = "Import"
        panel.message = "Choose a template roster or week-grid Excel roster with B/!B marks."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isImporting = true
        Task {
            do {
                importApplyErrorMessage = nil
                pendingRosterImport = try await store.previewRosterFile(url, mode: rosterImportMode)
            } catch {
                store.lastMessage = error.localizedDescription
            }
            isImporting = false
        }
    }

    private func applyRosterImport(
        _ result: RosterImportResult,
        columnMapping: [String: Int],
        matrixBangBehavior: String?
    ) {
        guard !isApplyingRosterImport else { return }
        isApplyingRosterImport = true
        importApplyErrorMessage = nil
        Task {
            let ok = await store.commitRosterImportResult(
                result,
                columnMapping: columnMapping,
                matrixBangBehavior: matrixBangBehavior
            )
            if ok {
                pendingRosterImport = nil
            } else {
                importApplyErrorMessage = store.lastMessage ?? "The import could not be applied."
            }
            isApplyingRosterImport = false
        }
    }

    /// Re-previews with the sheet's edited mapping/!B behavior so the shown
    /// counts stay accurate while the user is still adjusting them. Falls
    /// back to the original preview on failure so the sheet stays usable.
    private func remapRosterImport(
        _ result: RosterImportResult,
        columnMapping: [String: Int],
        matrixBangBehavior: String?
    ) async -> RosterImportResult {
        do {
            return try await store.previewRosterFile(
                URL(fileURLWithPath: result.sourceFile),
                mode: result.mode,
                replaceSourceId: result.replaceSourceId,
                columnMapping: result.importMeta.isMatrix ? nil : columnMapping,
                matrixBangBehavior: matrixBangBehavior ?? result.importMeta.matrixBangBehavior
            )
        } catch {
            store.lastMessage = error.localizedDescription
            return result
        }
    }

    private func importDefaultCoordinatorBundle() {
        guard !isImporting else { return }
        isImporting = true
        Task {
            do {
                importApplyErrorMessage = nil
                pendingCoordinatorImport = try await store.previewDefaultCoordinatorDocx()
            } catch {
                store.lastMessage = error.localizedDescription
            }
            isImporting = false
        }
    }

    private func importCoordinatorBundle(urls: [URL]) {
        guard !isImporting else { return }
        guard let bundle = CoordinatorBundleSelection(urls: urls) else {
            store.lastMessage = "Choose one Master Schedule, one Inpatient Roster, and one Outpatient Assignments DOCX file."
            return
        }
        isImporting = true
        Task {
            do {
                importApplyErrorMessage = nil
                pendingCoordinatorImport = try await store.previewCoordinatorDocx(
                    master: bundle.master,
                    inpatient: bundle.inpatient,
                    outpatient: bundle.outpatient
                )
            } catch {
                store.lastMessage = error.localizedDescription
            }
            isImporting = false
        }
    }

    private func applyCoordinatorImport(_ result: CoordinatorImportResult) {
        guard !isApplyingCoordinatorImport else { return }
        isApplyingCoordinatorImport = true
        importApplyErrorMessage = nil
        Task {
            let ok = await store.commitCoordinatorImportResult(result)
            if ok {
                pendingCoordinatorImport = nil
            } else {
                importApplyErrorMessage = store.lastMessage ?? "The import could not be applied."
            }
            isApplyingCoordinatorImport = false
        }
    }

    private func chooseBackupDestination() {
        guard backupAction == nil else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = backupFileName()
        panel.prompt = "Save"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        backupAction = .export
        Task {
            await store.exportStateBackup(to: url)
            backupAction = nil
        }
    }

    private func chooseBackupToRestore() {
        guard backupAction == nil else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json]
        panel.prompt = "Restore"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        backupAction = .restore
        Task {
            await store.importStateBackup(from: url)
            backupAction = nil
        }
    }

    private func backupFileName() -> String {
        let blockName = store.state?.activeBlock?.name ?? "Scheduler"
        let safeName = blockName.map { character in
            character.isLetter || character.isNumber ? String(character) : "-"
        }.joined().trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        return "\(safeName.isEmpty ? "Scheduler" : safeName)-backup-\(stamp).json"
    }

    private func runSettingsEditProbeIfRequested() {
        guard SettingsEditProbe.isRequested, !settingsEditProbeStarted else { return }
        settingsEditProbeStarted = true
        Task {
            await runSettingsEditProbe()
        }
    }

    private func runSettingsEditProbe() async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let targetBlockId = "block-settings-edit-2027"
        let updatedBlockName = "Settings Edit Week Updated"
        let holidayDate = "2027-03-08"
        let auditAttendingName = "Audit Attending"
        let legacyAttendingName = "Legacy Attending"
        let expectedProgram = "Audit Source Program"
        let removedExpectedProgram = "UT Pediatrics"

        func writeFailure(_ message: String) {
            SettingsEditProbe.write([
                "ok": false,
                "screen": "Settings",
                "blockId": store.state?.activeBlockId ?? "",
                "targetBlockId": targetBlockId,
                "message": message,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        guard let initialState = store.state, initialState.activeBlockId == targetBlockId else {
            writeFailure("Settings edit audit did not start on the expected block.")
            return
        }

        let blockUpdated = await store.run(
            "block.update",
            input: [
                "blockRef": targetBlockId,
                "patch": [
                    "name": updatedBlockName,
                    "status": "Review",
                    "coverage": [
                        "weekday": ["ip": ["count": 3]],
                        "saturday": ["ip": ["count": 1]],
                        "sunday": ["ip": ["count": 0]],
                        "holiday": ["ip": ["count": 2]],
                    ],
                    "holidays": [
                        ["date": holidayDate, "label": "Audit Holiday", "noClinic": true]
                    ],
                ],
            ]
        )
        guard blockUpdated else {
            writeFailure("block.update failed.")
            return
        }

        let rulesUpdated = await store.run(
            "rules.patch",
            input: ["patch": ["maxConsecutiveInpatientDays": 4, "honorNoClinicHolidays": false]]
        )
        guard rulesUpdated else {
            writeFailure("rules.patch failed.")
            return
        }

        let posterUpdated = await store.run(
            "posterSettings.patch",
            input: [
                "patch": [
                    "programName": "Audit Pediatric Neurology",
                    "chief": "Dr. Audit",
                    "tagline": "Audit ready",
                    "notes": ["Audit note one", "Audit note two"],
                    "locations": [
                        ["name": "Audit Main", "address": "1 Audit Way"],
                        ["name": "Audit Satellite", "address": "2 Remote Road"],
                    ],
                ]
            ]
        )
        guard posterUpdated else {
            writeFailure("posterSettings.patch failed.")
            return
        }

        let attendingAdded = await store.run("attending.add", input: ["name": auditAttendingName])
        guard attendingAdded else {
            writeFailure("attending.add failed.")
            return
        }

        let attendingUpdated = await store.run(
            "attending.update",
            input: [
                "name": auditAttendingName,
                "patch": [
                    "recurringClinics": [
                        [
                            "id": "audit-monday-am",
                            "weekday": "Monday",
                            "period": "AM",
                            "clinicName": "Audit Clinic",
                            "location": "Main",
                            "capacity": 3,
                            "active": true,
                        ]
                    ],
                    "oneOffDates": [
                        [
                            "id": "audit-oneoff",
                            "date": "2027-03-10",
                            "period": "PM",
                            "clinicName": "Audit Follow-up",
                            "location": "Annex",
                            "capacity": 1,
                        ]
                    ],
                ],
            ]
        )
        guard attendingUpdated else {
            writeFailure("attending.update failed.")
            return
        }

        let legacyRemoved = await store.run("attending.remove", input: ["name": legacyAttendingName])
        guard legacyRemoved else {
            writeFailure("attending.remove failed.")
            return
        }

        let expectedAdded = await store.run("expectedSource.add", input: ["program": expectedProgram])
        guard expectedAdded else {
            writeFailure("expectedSource.add failed.")
            return
        }

        let expectedRemoved = await store.run("expectedSource.remove", input: ["program": removedExpectedProgram])
        guard expectedRemoved, let finalState = store.state else {
            writeFailure("expectedSource.remove failed.")
            return
        }

        let block = finalState.activeBlock
        let holiday = block?.holidays?.first { $0.date == holidayDate }
        let rules = finalState.rules
        let poster = finalState.posterSettings
        let auditAttending = finalState.attendings?.first { $0.name == auditAttendingName }
        let expectedSources = finalState.expectedSourcePrograms ?? []
        let locationNames = (poster?.locations ?? []).compactMap(\.name).sorted()
        let recurring = auditAttending?.recurringClinics?.first
        let oneOff = auditAttending?.oneOffDates?.first

        let ok = finalState.activeBlockId == targetBlockId
            && block?.name == updatedBlockName
            && block?.status == "Review"
            && block?.coverageCount(for: .weekday) == 3
            && block?.coverageCount(for: .saturday) == 1
            && block?.coverageCount(for: .sunday) == 0
            && block?.coverageCount(for: .holiday) == 2
            && holiday?.label == "Audit Holiday"
            && holiday?.noClinic == true
            && rules?.maxConsecutiveInpatientDays == 4
            && rules?.honorNoClinicHolidays == false
            && poster?.programName == "Audit Pediatric Neurology"
            && poster?.chief == "Dr. Audit"
            && poster?.tagline == "Audit ready"
            && poster?.notes == ["Audit note one", "Audit note two"]
            && locationNames == ["Audit Main", "Audit Satellite"]
            && auditAttending != nil
            && recurring?.id == "audit-monday-am"
            && recurring?.weekday == "Monday"
            && recurring?.effectivePeriod == "AM"
            && recurring?.clinicName == "Audit Clinic"
            && recurring?.capacity == 3
            && recurring?.active == true
            && oneOff?.id == "audit-oneoff"
            && oneOff?.date == "2027-03-10"
            && oneOff?.effectivePeriod == "PM"
            && oneOff?.clinicName == "Audit Follow-up"
            && oneOff?.capacity == 1
            && finalState.attendings?.contains(where: { $0.name == legacyAttendingName }) == false
            && expectedSources.contains(expectedProgram)
            && !expectedSources.contains(removedExpectedProgram)

        SettingsEditProbe.write([
            "ok": ok,
            "screen": "Settings",
            "blockId": finalState.activeBlockId,
            "blockName": block?.name ?? "",
            "blockStatus": block?.status ?? "",
            "weekdayCoverage": block?.coverageCount(for: .weekday) ?? -1,
            "saturdayCoverage": block?.coverageCount(for: .saturday) ?? -1,
            "sundayCoverage": block?.coverageCount(for: .sunday) ?? -1,
            "holidayCoverage": block?.coverageCount(for: .holiday) ?? -1,
            "holidayDate": holiday?.date ?? "",
            "holidayLabel": holiday?.label ?? "",
            "holidayNoClinic": holiday?.noClinic ?? false,
            "maxConsecutiveInpatientDays": rules?.maxConsecutiveInpatientDays ?? -1,
            "honorNoClinicHolidays": rules?.honorNoClinicHolidays ?? true,
            "posterProgramName": poster?.programName ?? "",
            "posterChief": poster?.chief ?? "",
            "posterTagline": poster?.tagline ?? "",
            "posterLocations": locationNames,
            "posterNotes": poster?.notes ?? [],
            "attendingNames": (finalState.attendings ?? []).map(\.name).sorted(),
            "auditRecurringClinicId": recurring?.id ?? "",
            "auditOneOffClinicId": oneOff?.id ?? "",
            "expectedSourcePrograms": expectedSources.sorted(),
            "initialAttendingCount": initialState.attendings?.count ?? 0,
            "finalAttendingCount": finalState.attendings?.count ?? 0,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }
}

private enum SettingsEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_SETTINGS_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-settings-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Settings edit probe: \(error.localizedDescription)")
        }
    }
}

private let rosterContentTypes: [UTType] = [
    UTType(filenameExtension: "csv"),
    UTType(filenameExtension: "json"),
    UTType(filenameExtension: "xlsx"),
    UTType(filenameExtension: "xlsm"),
].compactMap { $0 }

private struct CoordinatorBundleSelection {
    let master: URL
    let inpatient: URL
    let outpatient: URL

    init?(urls: [URL]) {
        let pairs = urls.map { (url: $0, name: Self.normalizedName($0)) }
        guard
            let master = pairs.first(where: {
                ($0.name.contains("master") || $0.name.contains("schedule"))
                    && !$0.name.contains("inpatient")
                    && !$0.name.contains("outpatient")
            })?.url,
            let inpatient = pairs.first(where: { $0.name.contains("inpatient") })?.url,
            let outpatient = pairs.first(where: { $0.name.contains("outpatient") })?.url,
            Set([master, inpatient, outpatient]).count == 3
        else {
            return nil
        }
        self.master = master
        self.inpatient = inpatient
        self.outpatient = outpatient
    }

    private static func normalizedName(_ url: URL) -> String {
        url.deletingPathExtension()
            .lastPathComponent
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
    }
}

private enum BlockAction {
    case add
    case update
    case delete
    case use
}

private enum BackupAction {
    case export
    case restore
}

private struct CoverageStepper: View {
    let title: String
    @Binding var value: Int
    let isDisabled: Bool
    let onChange: () -> Void

    var body: some View {
        Stepper(
            "\(title): \(value)",
            value: Binding(
                get: { value },
                set: {
                    value = $0
                    onChange()
                }
            ),
            in: 0...12
        )
        .disabled(isDisabled)
    }
}

private struct HolidayDraft: Identifiable, Equatable {
    var id = UUID().uuidString
    var date: String
    var label: String
    var noClinic: Bool

    init(id: String = UUID().uuidString, date: String, label: String, noClinic: Bool) {
        self.id = id
        self.date = date
        self.label = label
        self.noClinic = noClinic
    }

    init(holiday: Holiday) {
        id = holiday.date
        date = holiday.date
        label = holiday.label ?? "Holiday"
        noClinic = holiday.noClinic ?? false
    }

    var payload: [String: Any] {
        [
            "date": date,
            "label": label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Holiday" : label,
            "noClinic": noClinic,
        ]
    }
}

private struct HolidayDraftRow: View {
    let holiday: HolidayDraft
    let isBusy: Bool
    let actionsDisabled: Bool
    let onDateChange: (String) -> Void
    let onLabelChange: (String) -> Void
    let onNoClinicChange: (Bool) -> Void
    let onSave: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField("YYYY-MM-DD", text: Binding(get: { holiday.date }, set: onDateChange))
                .textFieldStyle(.roundedBorder)
                .frame(width: 120)
            TextField("Label", text: Binding(get: { holiday.label }, set: onLabelChange))
                .textFieldStyle(.roundedBorder)
            Toggle("No clinic", isOn: Binding(get: { holiday.noClinic }, set: onNoClinicChange))
                .toggleStyle(.checkbox)
            Button {
                onSave()
            } label: {
                Image(systemName: "checkmark")
            }
            .buttonStyle(.borderless)
            .help("Save holiday")
            .disabled(actionsDisabled)
            Button(role: .destructive) {
                onRemove()
            } label: {
                if isBusy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "trash")
                }
            }
            .buttonStyle(.borderless)
            .help("Remove holiday")
            .disabled(actionsDisabled)
        }
    }
}

private struct PosterLocationDraft: Identifiable, Equatable {
    var id = UUID().uuidString
    var name = ""
    var address = ""

    init(id: String = UUID().uuidString, name: String = "", address: String = "") {
        self.id = id
        self.name = name
        self.address = address
    }

    init(_ location: PosterLocation) {
        id = "\(location.name ?? "")::\(location.address ?? "")"
        name = location.name ?? ""
        address = location.address ?? ""
    }

    var payload: [String: String] {
        [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "address": address.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
    }
}

private struct PosterLocationDraftRow: View {
    @Binding var location: PosterLocationDraft
    let isDisabled: Bool
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField("Name", text: $location.name)
                .textFieldStyle(.roundedBorder)
            TextField("Address", text: $location.address)
                .textFieldStyle(.roundedBorder)
            Button(role: .destructive) {
                onRemove()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Remove location")
            .disabled(isDisabled)
        }
    }
}

private let attendingWeekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
private let attendingPeriods = ["AM", "PM"]
private let clinicPolicyRoles = ["Resident", "Fellow", "Student"]

private struct AttendingProfileSettings: View {
    let attending: Attending
    let isBusy: Bool
    let actionsDisabled: Bool
    let onSaveProfile: ([RecurringClinic], [OneOffClinic]) -> Void
    let onRemove: () -> Void

    @State private var draftRecurring: [RecurringClinic] = []
    @State private var draftOneOffs: [OneOffClinic] = []
    @State private var syncedRecurring: [RecurringClinic] = []
    @State private var syncedOneOffs: [OneOffClinic] = []

    private var savedRecurring: [RecurringClinic] {
        attending.recurringClinics ?? []
    }

    private var savedOneOffs: [OneOffClinic] {
        attending.oneOffDates ?? []
    }

    private var recurring: [RecurringClinic] {
        draftRecurring
    }

    private var oneOffs: [OneOffClinic] {
        draftOneOffs
    }

    private var hasUnsavedRecurring: Bool {
        draftRecurring != syncedRecurring
    }

    private var hasUnsavedOneOffs: Bool {
        draftOneOffs != syncedOneOffs
    }

    private var hasUnsavedChanges: Bool {
        hasUnsavedRecurring || hasUnsavedOneOffs
    }

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                recurringGrid
                recurringDetails
                Divider()
                oneOffEditor
                HStack(spacing: 8) {
                    Button {
                        onSaveProfile(draftRecurring, draftOneOffs)
                    } label: {
                        if isBusy {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Saving")
                            }
                        } else {
                            Label("Save Clinic Profile", systemImage: "checkmark")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(actionsDisabled || !hasUnsavedChanges)

                    Button {
                        syncDraftFromSaved(force: true)
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                    }
                    .help("Discard clinic profile edits")
                    .disabled(actionsDisabled || !hasUnsavedChanges)

                    Spacer()

                    Button(role: .destructive) {
                        onRemove()
                    } label: {
                        Label("Remove Attending", systemImage: "minus.circle")
                    }
                    .disabled(actionsDisabled)
                }
            }
            .padding(.top, 6)
        } label: {
            HStack {
                Text(attending.name)
                Spacer()
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear {
            syncDraftFromSaved(force: true)
        }
        .onChange(of: savedRecurring) { newValue in
            syncRecurringFromSaved(newValue)
        }
        .onChange(of: savedOneOffs) { newValue in
            syncOneOffsFromSaved(newValue)
        }
    }

    private var recurringGrid: some View {
        Grid(alignment: .center, horizontalSpacing: 7, verticalSpacing: 7) {
            GridRow {
                Text("")
                ForEach(attendingWeekdays, id: \.self) { weekday in
                    Text(String(weekday.prefix(3)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(attendingPeriods, id: \.self) { period in
                GridRow {
                    Text(period)
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    ForEach(attendingWeekdays, id: \.self) { weekday in
                        Toggle(
                            "",
                            isOn: Binding(
                                get: { hasRecurring(weekday: weekday, period: period) },
                                set: { _ in toggleRecurring(weekday: weekday, period: period) }
                            )
                        )
                        .labelsHidden()
                        .accessibilityLabel("\(weekday) \(period)")
                        .toggleStyle(.checkbox)
                        .disabled(actionsDisabled)
                    }
                }
            }
        }
    }

    private var recurringDetails: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !recurring.isEmpty {
                Text("Recurring clinic details")
                    .font(.callout.bold())
                ForEach(recurringDetailSlots, id: \.key) { item in
                    HStack(spacing: 8) {
                        Text(item.label)
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                            .frame(width: 58, alignment: .leading)

                        TextField("Clinic", text: Binding(
                            get: { item.slot.clinicName ?? "" },
                            set: { updateRecurringClinicName(index: item.index, clinicName: $0) }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .disabled(actionsDisabled)

                        TextField("Location", text: Binding(
                            get: { item.slot.location ?? "" },
                            set: { updateRecurringLocation(index: item.index, location: $0) }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .disabled(actionsDisabled)

                        TextField("Capacity", text: Binding(
                            get: { item.slot.capacity.map(String.init) ?? "" },
                            set: { updateRecurringCapacity(index: item.index, capacity: $0) }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 82)
                        .disabled(actionsDisabled)

                        ClinicRolePolicyMenu(
                            allowedRoles: item.slot.allowedRoles ?? [],
                            onToggle: { role in toggleRecurringAllowedRole(index: item.index, role: role) }
                        )
                        .disabled(actionsDisabled)
                    }
                }
            }
        }
    }

    private var oneOffEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("One-off clinic dates")
                    .font(.callout.bold())
                Spacer()
                Button {
                    addOneOff()
                } label: {
                    Image(systemName: "plus")
                }
                .help("Add one-off clinic date")
                .disabled(actionsDisabled)
            }

            if oneOffs.isEmpty {
                Text("No one-off dates.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(oneOffs.enumerated()), id: \.offset) { index, slot in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            TextField("YYYY-MM-DD", text: Binding(
                                get: { slot.date ?? "" },
                                set: { updateOneOffDate(index: index, date: $0) }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 120)
                            .disabled(actionsDisabled)

                            Picker("Period", selection: Binding(
                                get: { slot.effectivePeriod },
                                set: { updateOneOffPeriod(index: index, period: $0) }
                            )) {
                                ForEach(attendingPeriods, id: \.self) { period in
                                    Text(period).tag(period)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 80)
                            .disabled(actionsDisabled)

                            TextField("Clinic", text: Binding(
                                get: { slot.clinicName ?? "" },
                                set: { updateOneOffClinicName(index: index, clinicName: $0) }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .disabled(actionsDisabled)

                            TextField("Location", text: Binding(
                                get: { slot.location ?? "" },
                                set: { updateOneOffLocation(index: index, location: $0) }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .disabled(actionsDisabled)
                        }

                        HStack(spacing: 8) {
                            TextField("Capacity", text: Binding(
                                get: { slot.capacity.map(String.init) ?? "" },
                                set: { updateOneOffCapacity(index: index, capacity: $0) }
                            ))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 82)
                            .disabled(actionsDisabled)

                            ClinicRolePolicyMenu(
                                allowedRoles: slot.allowedRoles ?? [],
                                onToggle: { role in toggleOneOffAllowedRole(index: index, role: role) }
                            )
                            .disabled(actionsDisabled)

                            Spacer()

                            Button(role: .destructive) {
                                removeOneOff(index: index)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove one-off date")
                            .disabled(actionsDisabled)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func hasRecurring(weekday: String, period: String) -> Bool {
        recurring.contains { $0.weekday == weekday && $0.effectivePeriod == period }
    }

    private func syncDraftFromSaved(force: Bool = false) {
        if force || !hasUnsavedRecurring || draftRecurring == savedRecurring {
            draftRecurring = savedRecurring
            syncedRecurring = savedRecurring
        }
        if force || !hasUnsavedOneOffs || draftOneOffs == savedOneOffs {
            draftOneOffs = savedOneOffs
            syncedOneOffs = savedOneOffs
        }
    }

    private func syncRecurringFromSaved(_ recurring: [RecurringClinic]) {
        if !hasUnsavedRecurring || draftRecurring == recurring {
            draftRecurring = recurring
            syncedRecurring = recurring
        }
    }

    private func syncOneOffsFromSaved(_ oneOffs: [OneOffClinic]) {
        if !hasUnsavedOneOffs || draftOneOffs == oneOffs {
            draftOneOffs = oneOffs
            syncedOneOffs = oneOffs
        }
    }

    private func toggleRecurring(weekday: String, period: String) {
        if let index = draftRecurring.firstIndex(where: { $0.weekday == weekday && $0.effectivePeriod == period }) {
            draftRecurring.remove(at: index)
        } else {
            draftRecurring.append(RecurringClinic(weekday: weekday, period: period, session: nil, clinicName: nil, capacity: nil, allowedRoles: nil, active: nil))
        }
    }

    private func updateRecurringClinicName(index: Int, clinicName: String) {
        updateRecurring(index: index) { clinic in
            RecurringClinic(
                id: clinic.id,
                weekday: clinic.weekday,
                period: clinic.period,
                session: clinic.session,
                clinicName: clinicName,
                location: clinic.location,
                capacity: clinic.capacity,
                allowedRoles: clinic.allowedRoles,
                active: clinic.active
            )
        }
    }

    private func updateRecurringLocation(index: Int, location: String) {
        updateRecurring(index: index) { clinic in
            RecurringClinic(
                id: clinic.id,
                weekday: clinic.weekday,
                period: clinic.period,
                session: clinic.session,
                clinicName: clinic.clinicName,
                location: location,
                capacity: clinic.capacity,
                allowedRoles: clinic.allowedRoles,
                active: clinic.active
            )
        }
    }

    private func updateRecurringCapacity(index: Int, capacity: String) {
        updateRecurring(index: index) { clinic in
            RecurringClinic(
                id: clinic.id,
                weekday: clinic.weekday,
                period: clinic.period,
                session: clinic.session,
                clinicName: clinic.clinicName,
                location: clinic.location,
                capacity: parseCapacity(capacity),
                allowedRoles: clinic.allowedRoles,
                active: clinic.active
            )
        }
    }

    private func toggleRecurringAllowedRole(index: Int, role: String) {
        updateRecurring(index: index) { clinic in
            RecurringClinic(
                id: clinic.id,
                weekday: clinic.weekday,
                period: clinic.period,
                session: clinic.session,
                clinicName: clinic.clinicName,
                location: clinic.location,
                capacity: clinic.capacity,
                allowedRoles: toggledRoles(clinic.allowedRoles, role: role),
                active: clinic.active
            )
        }
    }

    private func updateRecurring(index: Int, mutate: (RecurringClinic) -> RecurringClinic) {
        guard draftRecurring.indices.contains(index) else { return }
        draftRecurring[index] = mutate(draftRecurring[index])
    }

    private func addOneOff() {
        draftOneOffs.append(OneOffClinic(date: "", period: "AM", session: nil, allowedRoles: nil))
    }

    private func updateOneOffDate(index: Int, date: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: date,
                period: slot.period,
                session: slot.session,
                clinicName: slot.clinicName,
                location: slot.location,
                capacity: slot.capacity,
                allowedRoles: slot.allowedRoles
            )
        }
    }

    private func updateOneOffPeriod(index: Int, period: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: slot.date,
                period: period,
                session: nil,
                clinicName: slot.clinicName,
                location: slot.location,
                capacity: slot.capacity,
                allowedRoles: slot.allowedRoles
            )
        }
    }

    private func updateOneOffClinicName(index: Int, clinicName: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: slot.date,
                period: slot.period,
                session: slot.session,
                clinicName: clinicName,
                location: slot.location,
                capacity: slot.capacity,
                allowedRoles: slot.allowedRoles
            )
        }
    }

    private func updateOneOffLocation(index: Int, location: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: slot.date,
                period: slot.period,
                session: slot.session,
                clinicName: slot.clinicName,
                location: location,
                capacity: slot.capacity,
                allowedRoles: slot.allowedRoles
            )
        }
    }

    private func updateOneOffCapacity(index: Int, capacity: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: slot.date,
                period: slot.period,
                session: slot.session,
                clinicName: slot.clinicName,
                location: slot.location,
                capacity: parseCapacity(capacity),
                allowedRoles: slot.allowedRoles
            )
        }
    }

    private func toggleOneOffAllowedRole(index: Int, role: String) {
        updateOneOff(index: index) { slot in
            OneOffClinic(
                id: slot.id,
                date: slot.date,
                period: slot.period,
                session: slot.session,
                clinicName: slot.clinicName,
                location: slot.location,
                capacity: slot.capacity,
                allowedRoles: toggledRoles(slot.allowedRoles, role: role)
            )
        }
    }

    private func updateOneOff(index: Int, mutate: (OneOffClinic) -> OneOffClinic) {
        guard draftOneOffs.indices.contains(index) else { return }
        draftOneOffs[index] = mutate(draftOneOffs[index])
    }

    private func toggledRoles(_ roles: [String]?, role: String) -> [String]? {
        var selected = Set(roles ?? [])
        if selected.contains(role) {
            selected.remove(role)
        } else {
            selected.insert(role)
        }
        let normalized = clinicPolicyRoles.filter { selected.contains($0) }
        return normalized.isEmpty ? nil : normalized
    }

    private func removeOneOff(index: Int) {
        guard draftOneOffs.indices.contains(index) else { return }
        draftOneOffs.remove(at: index)
    }

    private func parseCapacity(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : Int(trimmed)
    }

    private var summary: String {
        let recurringCount = recurring.count
        let oneOffCount = oneOffs.count
        if recurringCount == 0 && oneOffCount == 0 {
            return "No clinic days"
        }
        return "\(recurringCount) recurring, \(oneOffCount) one-off"
    }

    private var recurringDetailSlots: [RecurringDetailSlot] {
        Array(recurring.enumerated())
            .filter { $0.element.weekday?.isEmpty == false }
            .sorted {
                recurringSortKey($0.element, index: $0.offset) < recurringSortKey($1.element, index: $1.offset)
            }
            .compactMap { index, slot in
                guard let weekday = slot.weekday else { return nil }
                let period = slot.effectivePeriod
                return RecurringDetailSlot(
                    key: "\(index)|\(weekday)|\(period)",
                    index: index,
                    label: "\(String(weekday.prefix(3))) \(period)",
                    slot: slot
                )
            }
    }

    private func recurringSortKey(_ slot: RecurringClinic, index: Int) -> String {
        let weekdayIndex = attendingWeekdays.firstIndex(of: slot.weekday ?? "") ?? attendingWeekdays.count
        let periodIndex = attendingPeriods.firstIndex(of: slot.effectivePeriod) ?? attendingPeriods.count
        return "\(weekdayIndex)-\(periodIndex)-\(index)"
    }
}

private struct ClinicRolePolicyMenu: View {
    let allowedRoles: [String]
    let onToggle: (String) -> Void

    private var title: String {
        let selected = Set(allowedRoles)
        let normalized = clinicPolicyRoles.filter { selected.contains($0) }
        return normalized.isEmpty ? "Any role" : normalized.joined(separator: ", ")
    }

    var body: some View {
        Menu {
            ForEach(clinicPolicyRoles, id: \.self) { role in
                Button {
                    onToggle(role)
                } label: {
                    if allowedRoles.contains(role) {
                        Label(role, systemImage: "checkmark")
                    } else {
                        Text(role)
                    }
                }
            }
        } label: {
            Label(title, systemImage: "person.2")
        }
        .frame(width: 150)
        .help("Allowed clinic rotator roles")
    }
}

private struct RecurringDetailSlot {
    var key: String
    var index: Int
    var label: String
    var slot: RecurringClinic
}
