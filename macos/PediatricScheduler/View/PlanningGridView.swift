import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct PlanningGridView: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedRotatorId = ""
    @State private var displayMode: PlanningDisplayMode = .master
    @State private var showStaffRows = true
    @State private var peekBeforeBlock = false
    @State private var peekPastBlock = false
    @State private var startDate = ""
    @State private var endDate = ""
    @State private var phase: RangePhase = .inpatient
    @State private var isApplying = false
    @State private var isDrafting = false
    @State private var isRunningMethodistAuto = false
    @State private var isLoadingProjection = false
    @State private var needsProjectionRefresh = false
    @State private var quickPaintingDate: String?
    @State private var dropAssigningDate: String?
    @State private var draggingRotatorId: String?
    @State private var dragContext: PlanningDragContext?
    @State private var removingAssignmentId: String?
    @State private var planningEditProbeStarted = false
    @AppStorage("planningGridPaintOn") private var paintOn = true
    @State private var paintDrag: PaintDragState?
    @State private var isCommittingPaint = false
    @State private var methodistStartDrafts: [String: String] = [:]
    @State private var methodistStartSavingId: String?

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            VStack(spacing: 0) {
                planningToolbar(block: block, state: state)
                Divider()
                workspace(block: block, state: state)
            }
            .onAppear {
                syncDefaults(block: block, state: state)
                refreshPlanningGrid(block: block)
                runPlanningEditProbeIfRequested(block: block)
            }
            .onChange(of: block.id) { _ in
                syncDefaults(block: block, state: state)
                refreshPlanningGrid(block: block)
                runPlanningEditProbeIfRequested(block: block)
            }
            .onChange(of: peekBeforeBlock) { _ in refreshPlanningGrid(block: block) }
            .onChange(of: peekPastBlock) { _ in refreshPlanningGrid(block: block) }
            .onChange(of: paintOn) { isOn in
                // Turning paint off mid-drag removes the sweep overlay, so its
                // onEnded never fires — drop the in-flight selection here.
                if !isOn && !isCommittingPaint {
                    paintDrag = nil
                }
            }
            .onChange(of: store.mutationTick) { _ in refreshPlanningGrid(block: block) }
            .onChange(of: state.rotators.map(\.id)) { _ in ensureSelection(state: state) }
        } else {
            StatusView(icon: "calendar.day.timeline.left", title: "No active block",
                       message: "Create or import a rotation block to edit assignments.")
        }
    }

    /// Compact wrapping control band above the grid. Replaces the old
    /// fixed-width left editor rail so the grid gets the full content width.
    private func planningToolbar(block: ServiceBlock, state: SchedulerState) -> some View {
        let validationMessage = planningRangeValidationMessage(block: block)
        return VStack(alignment: .leading, spacing: 8) {
            FlexibleWrap(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Planning Grid").font(.headline)
                    Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                toolbarGroup {
                    Picker("View", selection: $displayMode) {
                        ForEach(PlanningDisplayMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 220)
                    .accessibilityIdentifier("planning-grid-view-picker")
                    .help("Choose which assignments the grid shows")

                    Toggle("Staff rows", isOn: $showStaffRows)
                        .accessibilityIdentifier("planning-grid-staff-rows-toggle")
                    Toggle("Peek before", isOn: $peekBeforeBlock)
                        .accessibilityIdentifier("planning-grid-prior-peek-toggle")
                        .help("Show 14 read-only calendar days before the block start")
                    Toggle("Peek past", isOn: $peekPastBlock)
                        .accessibilityIdentifier("planning-grid-peek-toggle")
                        .help("Show 14 read-only calendar days past the block end")
                }

                toolbarGroup {
                    Picker("Rotator", selection: $selectedRotatorId) {
                        ForEach(sortedRotators(state)) { rotator in
                            Text(rotator.label).tag(rotator.id)
                        }
                    }
                    .frame(width: 230)
                    .accessibilityIdentifier("planning-grid-rotator-picker")

                    Picker("Phase", selection: $phase) {
                        ForEach(RangePhase.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 180)
                    .accessibilityIdentifier("planning-grid-phase-picker")
                    .help("Phase used by Paint mode, the paint buttons, and Apply")

                    Toggle(isOn: $paintOn) {
                        Label("Paint", systemImage: "paintbrush")
                    }
                    .toggleStyle(.button)
                    .tint(.accentColor)
                    .accessibilityIdentifier("planning-grid-paint-toggle")
                    .help("Paint mode: drag across days in a rotator's row to assign the selected phase")
                }

                toolbarGroup {
                    TextField("Start date", text: $startDate)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 106)
                        .accessibilityIdentifier("planning-grid-start-date")
                    TextField("End date", text: $endDate)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 106)
                        .accessibilityIdentifier("planning-grid-end-date")
                    Button {
                        applyRange(block: block)
                    } label: {
                        if isApplying {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text("Applying")
                            }
                        } else {
                            Label("Apply", systemImage: phase.systemImage)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("planning-grid-apply-button")
                    .help(validationMessage ?? "Apply the selected phase to this date range.")
                    .disabled(isApplying || validationMessage != nil)
                }

                toolbarGroup {
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
                    .accessibilityIdentifier("planning-grid-generate-draft-button")
                    .disabled(isDrafting || state.rotators.isEmpty)

                    let methodistCount = state.rotators.filter(MethodistSetup.isMethodist).count
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
                        .accessibilityIdentifier("planning-grid-methodist-auto-button")
                        .disabled(isRunningMethodistAuto || isDrafting)
                        .help("Generate Methodist 14/14 assignments")
                    }
                }
            }

            if paintOn {
                Label("Paint is on: drag across days in a rotator's row to paint \(phase.title); a single click paints one day. Turn Paint off to click-select without editing.", systemImage: "paintbrush.pointed")
                    .font(.caption)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityIdentifier("planning-grid-paint-hint")
            }
            if let validationMessage {
                Label(validationMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if let message = store.lastMessage, !message.isEmpty {
                Label(message, systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(.bar)
    }

    private func toolbarGroup<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 8, content: content)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
    }

    private func workspace(block: ServiceBlock, state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            let missingStarts = methodistRotatorsMissingStart(block: block, state: state)
            if !missingStarts.isEmpty {
                methodistSetupPanel(rotators: missingStarts, block: block, state: state)
                    .padding([.horizontal, .top])
                    .padding(.bottom, 10)
                Divider()
            }
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
            PlanningProjectionSummary(
                projection: activeProjection(block),
                displayMode: displayMode,
                isLoading: isLoadingProjection
            ) {
                refreshPlanningGrid(block: block)
            }
            .padding()
            Divider()
            if let projection = activeProjection(block), !projection.dates.isEmpty {
                PlanningMatrixView(
                    state: state,
                    projection: projection,
                    displayMode: displayMode,
                    showStaffRows: showStaffRows,
                    staffRows: staffRows(projection: projection, block: block, state: state),
                    visibleRotatorIds: (peekBeforeBlock || peekPastBlock) ? rawBlockActiveRotatorIds(block: block, state: state) : nil,
                    selectedRotatorId: selectedRotatorId,
                    phase: phase,
                    focus: store.scheduleFocus,
                    paintingDate: quickPaintingDate,
                    droppingDate: dropAssigningDate,
                    draggingRotatorId: draggingRotatorId,
                    dragContext: dragContext,
                    paintActive: paintOn && !isCommittingPaint && !isApplying && !isDrafting,
                    paintDrag: paintDrag,
                    paintCommitting: isCommittingPaint,
                    actionsDisabled: isApplying || isDrafting || quickPaintingDate != nil || dropAssigningDate != nil || removingAssignmentId != nil || isCommittingPaint,
                    dropDisabled: isApplying || isDrafting || quickPaintingDate != nil || dropAssigningDate != nil || removingAssignmentId != nil || paintOn || isCommittingPaint,
                    onSelectRotator: { selectedRotatorId = $0 },
                    onDragRotator: beginDraggingRotator,
                    onPaintCell: { rotatorId, date in
                        // Paint off: clicking a cell only selects the row —
                        // no accidental mutation. Paint on: pointer clicks go
                        // to the sweep overlay instead, but assistive tech
                        // (AXPress) reaches this button directly, so it paints
                        // the one day exactly like a single-click sweep.
                        selectedRotatorId = rotatorId
                        if paintOn {
                            applyPhase(block: block, rotatorId: rotatorId, on: date)
                        }
                    },
                    onPaintSweep: { rotatorId, dates in
                        extendPaintSweep(rotatorId: rotatorId, dates: dates, block: block)
                    },
                    onPaintSweepEnd: { commitPaint(block: block) },
                    onInvalidDrop: rejectDrop,
                    onDropRotator: { rotatorId, date in dropRotator(rotatorId, on: date) }
                )
                .padding([.horizontal, .bottom])
                .task(id: NativePlanningGridProbe.fingerprint(projection: projection, displayMode: displayMode, state: state)) {
                    NativePlanningGridProbe.write(projection: projection, displayMode: displayMode, state: state)
                }
                Divider()
            } else {
                // Legacy grid is the fallback while no projection is loaded
                // (cold start, block switch, post-edit refresh) — it also
                // carries the only per-assignment delete affordance.
                grid(block: block, state: state)
            }
        }
    }

    private func grid(block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        // Group once so each day row works on its own slice instead of filtering
        // and label-sorting the full block arrays on every render (see DashboardView).
        let inpatientByDate = Dictionary(grouping: state.inpatientAssignments, by: \.date)
        let outpatientByDate = Dictionary(grouping: state.outpatientSessions, by: \.date)
        let halfDayFactsByDate = Dictionary(grouping: state.halfDayFacts ?? [], by: \.date)
        let rotatorLabels = Dictionary(state.rotators.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
        return ScrollViewReader { proxy in
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        ForEach(dates, id: \.self) { date in
                            PlanningDayRow(
                                date: date,
                                state: state,
                                dayInpatient: inpatientByDate[date] ?? [],
                                dayOutpatient: outpatientByDate[date] ?? [],
                                dayHalfDayFacts: halfDayFactsByDate[date] ?? [],
                                rotatorLabels: rotatorLabels,
                                displayMode: displayMode,
                                selectedRotatorId: selectedRotatorId,
                                phase: phase,
                                focus: store.scheduleFocus,
                                isPainting: quickPaintingDate == date,
                                isDropping: dropAssigningDate == date,
                                draggingRotatorId: draggingRotatorId,
                                dragContext: dragContext,
                                removingAssignmentId: removingAssignmentId,
                                actionsDisabled: isApplying || isDrafting || quickPaintingDate != nil || dropAssigningDate != nil || removingAssignmentId != nil || isCommittingPaint || selectedRotatorId.isEmpty,
                                dropDisabled: isApplying || isDrafting || quickPaintingDate != nil || dropAssigningDate != nil || removingAssignmentId != nil || isCommittingPaint,
                                assignmentActionsDisabled: isApplying || isDrafting || quickPaintingDate != nil || dropAssigningDate != nil || removingAssignmentId != nil || isCommittingPaint,
                                onPaintDay: { applyPhase(block: block, on: $0) },
                                onDropRotator: { rotatorId, date in dropRotator(rotatorId, on: date) },
                                onInvalidDrop: rejectDrop,
                                onDeleteAssignment: { deleteAssignment($0) }
                            )
                            .id(date)
                            Divider()
                        }
                    } header: {
                        PlanningGridHeader(displayMode: displayMode)
                    }
                }
                .frame(minWidth: displayMode.gridMinWidth, alignment: .topLeading)
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

    private func activeProjection(_ block: ServiceBlock) -> PlanningGridProjection? {
        guard let projection = store.planningGrid,
              projection.blockId == block.id,
              projection.peekBeforeBlock == peekBeforeBlock,
              projection.peekPastBlock == peekPastBlock
        else { return nil }
        return projection
    }

    private func refreshPlanningGrid(block: ServiceBlock) {
        if isLoadingProjection {
            needsProjectionRefresh = true
            return
        }
        isLoadingProjection = true
        Task {
            await store.loadPlanningGrid(blockRef: block.id, peekBeforeBlock: peekBeforeBlock, peekPastBlock: peekPastBlock)
            isLoadingProjection = false
            if needsProjectionRefresh {
                needsProjectionRefresh = false
                if let state = store.state, let activeBlock = state.activeBlock {
                    refreshPlanningGrid(block: activeBlock)
                }
            }
        }
    }

    private func syncDefaults(block: ServiceBlock, state: SchedulerState) {
        let focused = applyFocus(block: block)
        if startDate.isEmpty || startDate < block.startDate || startDate > block.endDate {
            startDate = block.startDate
        }
        if !focused && (endDate.isEmpty || endDate < block.startDate || endDate > block.endDate) {
            endDate = block.endDate
        }
        ensureSelection(state: state)
    }

    private func ensureSelection(state: SchedulerState) {
        if selectedRotatorId.isEmpty || !state.rotators.contains(where: { $0.id == selectedRotatorId }) {
            selectedRotatorId = sortedRotators(state).first?.id ?? ""
        }
    }

    @discardableResult
    private func applyFocus(block: ServiceBlock) -> Bool {
        guard let focus = store.scheduleFocus,
              focus.target == .planning,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return false }
        startDate = focus.date
        endDate = focus.date
        if let rotatorId = focus.rotatorId {
            selectedRotatorId = rotatorId
        }
        return true
    }

    private func scrollToFocus(proxy: ScrollViewProxy, block: ServiceBlock) {
        guard let focus = store.scheduleFocus,
              focus.target == .planning,
              block.startDate <= focus.date,
              focus.date <= block.endDate
        else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(focus.date, anchor: .center)
        }
    }

    private func sortedRotators(_ state: SchedulerState) -> [Rotator] {
        state.rotators.sorted {
            $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
        }
    }

    private func staffRows(projection: PlanningGridProjection, block: ServiceBlock, state: SchedulerState) -> [PlanningGridRow] {
        guard showStaffRows else { return [] }
        let visibleIds = (peekBeforeBlock || peekPastBlock) ? rawBlockActiveRotatorIds(block: block, state: state) : nil
        let fellowRows = projection.rows.filter { row in
            row.rotator.isPediatricNeurologyFellow
                && (visibleIds == nil || visibleIds?.contains(row.rotator.id) == true)
                && row.cells.contains { $0.status != "absent" }
        }
        return fellowRows + attendingStaffRows(state: state, dates: projection.dates)
    }

    private func rawBlockActiveRotatorIds(block: ServiceBlock, state: SchedulerState) -> Set<String> {
        Set(state.rotators.filter { rotator in
            (rotator.segments ?? []).contains { segment in
                segment.start <= block.endDate && block.startDate <= segment.end
            }
        }.map(\.id))
    }

    private func attendingStaffRows(state: SchedulerState, dates: [String]) -> [PlanningGridRow] {
        let dateSet = Set(dates)
        var sessionsByAttending: [String: (name: String, sessionsByDate: [String: [PlanningStaffSession]])] = [:]
        for session in state.outpatientSessions where dateSet.contains(session.date) {
            for detail in outpatientDetails(for: session) {
                let provider = detail.attending.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !provider.isEmpty else { continue }
                let key = provider.lowercased()
                var entry = sessionsByAttending[key] ?? (name: provider, sessionsByDate: [:])
                var bucket = entry.sessionsByDate[session.date] ?? []
                bucket.append(
                    PlanningStaffSession(
                        period: session.period == "PM" ? "PM" : "AM",
                        clinic: detail.clinic.isEmpty ? (session.clinic ?? "Clinic") : detail.clinic,
                        provider: provider
                    )
                )
                entry.sessionsByDate[session.date] = bucket
                sessionsByAttending[key] = entry
            }
        }
        return sessionsByAttending.values
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { attending in
                let rotator = PlanningGridRotator(
                    id: "staff-attending::\(attending.name.lowercased())",
                    label: attending.name,
                    program: "Attending",
                    level: "Attending",
                    role: "Attending",
                    staffKind: "attending"
                )
                let cells = dates.map { date in
                    let sessions = attending.sessionsByDate[date] ?? []
                    guard !sessions.isEmpty else {
                        return PlanningGridCell(date: date, status: "absent", staffKind: "attending")
                    }
                    let titles = sessions.map { "\($0.period) \($0.clinic) with \($0.provider)" }
                    let periods = Array(Set(sessions.map(\.period))).sorted()
                    return PlanningGridCell(
                        date: date,
                        status: "outpatient",
                        outpatientCount: sessions.count,
                        staffKind: "attending",
                        staffTitles: titles,
                        staffPeriods: periods
                    )
                }
                return PlanningGridRow(rotator: rotator, cells: cells)
            }
    }

    private func outpatientDetails(for session: OutpatientSession) -> [(clinic: String, attending: String)] {
        let normalized = (session.details ?? []).compactMap { detail -> (clinic: String, attending: String)? in
            let clinic = (detail.clinic ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let attending = (detail.attending ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clinic.isEmpty || !attending.isEmpty else { return nil }
            return (clinic: clinic, attending: attending)
        }
        if !normalized.isEmpty {
            return normalized
        }
        return [
            (
                clinic: (session.clinic ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                attending: (session.provider ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            ),
        ]
    }

    private func planningRangeValidationMessage(block: ServiceBlock) -> String? {
        guard !selectedRotatorId.isEmpty else { return "Pick a rotator." }
        guard CalendarUtil.isISODate(startDate) else { return "Enter a valid start date (yyyy-MM-dd)." }
        guard CalendarUtil.isISODate(endDate) else { return "Enter a valid end date (yyyy-MM-dd)." }
        guard startDate <= endDate else { return "Start date must be on or before end date." }
        guard block.startDate <= startDate, endDate <= block.endDate else {
            return "Pick dates inside the active block."
        }
        return nil
    }

    private func applyRange(block: ServiceBlock) {
        guard !isApplying else { return }
        isApplying = true
        let input: [String: Any] = [
            "blockRef": block.id,
            "rotatorRef": selectedRotatorId,
            "startDate": startDate,
            "endDate": endDate,
            "phase": phase.rawValue,
        ]
        Task {
            await store.run("assign.range", input: input)
            isApplying = false
        }
    }

    private func applyPhase(block: ServiceBlock, on date: String) {
        applyPhase(block: block, rotatorId: selectedRotatorId, on: date)
    }

    private func applyPhase(block: ServiceBlock, rotatorId: String, on date: String) {
        guard quickPaintingDate == nil, !rotatorId.isEmpty else { return }
        quickPaintingDate = date
        let input: [String: Any] = [
            "blockRef": block.id,
            "rotatorRef": rotatorId,
            "startDate": date,
            "endDate": date,
            "phase": phase.rawValue,
        ]
        Task {
            await store.run("assign.range", input: input)
            quickPaintingDate = nil
        }
    }

    private func beginDraggingRotator(_ rotatorId: String) {
        draggingRotatorId = rotatorId
        dragContext = store.state.map { PlanningDragContext(state: $0, rotatorId: rotatorId) }
        // ponytail: SwiftUI gives no "drag session ended" callback, so a short failsafe
        // bounds a cancelled/off-target drag's stale drop-preview tint instead of an 8s hang.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if draggingRotatorId == rotatorId {
                draggingRotatorId = nil
                dragContext = nil
            }
        }
    }

    private func rejectDrop(_ reason: String) {
        draggingRotatorId = nil
        dragContext = nil
        store.lastMessage = reason
    }

    private func dropRotator(_ rotatorId: String, on date: String) {
        guard dropAssigningDate == nil else { return }
        if let state = store.state {
            let feedback = PlanningDropValidator.validate(state: state, rotatorId: rotatorId, date: date)
            guard feedback.isValid else {
                rejectDrop(feedback.reason)
                return
            }
        }
        dropAssigningDate = date
        Task {
            await store.run("inpatient.drop", input: ["rotatorRef": rotatorId, "date": date])
            dropAssigningDate = nil
            draggingRotatorId = nil
            dragContext = nil
        }
    }

    private func deleteAssignment(_ chip: ChipData) {
        guard removingAssignmentId == nil else { return }
        removingAssignmentId = chip.id
        Task {
            switch chip.kind {
            case .inpatient:
                await store.run("inpatient.delete", input: ["assignmentRef": chip.id])
            case .outpatient:
                await store.run("outpatient.delete", input: ["sessionRef": chip.id])
            }
            removingAssignmentId = nil
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

    // MARK: - Paint sweep

    /// Accumulate the dates a paint drag has covered. The row and phase are
    /// snapshotted when the sweep starts (mirroring the browser paintReducer);
    /// sweeps that wander onto another row mid-drag are ignored. Outpatient
    /// sweeps never accumulate weekend/no-clinic days, so the drag preview
    /// only highlights cells the commit will actually paint (browser parity:
    /// blocked cells never enter the selection).
    private func extendPaintSweep(rotatorId: String, dates: Set<String>, block: ServiceBlock) {
        guard paintOn, !isCommittingPaint else { return }
        let sweepPhase = paintDrag?.phase ?? phase
        var eligible = dates
        if sweepPhase == .outpatient {
            let noClinic = Set((block.holidays ?? []).filter { $0.noClinic == true }.map(\.date))
            eligible.subtract(PaintSelection.outpatientBlockedDates(in: eligible, noClinicDates: noClinic))
        }
        if var drag = paintDrag {
            guard drag.rotatorId == rotatorId else { return }
            drag.selected.formUnion(eligible)
            paintDrag = drag
        } else {
            paintDrag = PaintDragState(rotatorId: rotatorId, phase: phase, selected: eligible)
            selectedRotatorId = rotatorId
        }
    }

    /// Commit the sweep: group the selection into contiguous runs and issue
    /// the `assign.range` commands as ONE batch, so a single Undo reverts the
    /// whole gesture even when it split into multiple runs (browser parity:
    /// one history entry per paint stroke).
    private func commitPaint(block: ServiceBlock) {
        guard let drag = paintDrag, !isCommittingPaint else { return }
        let dates = drag.selected
        guard !dates.isEmpty else {
            paintDrag = nil
            if drag.phase == .outpatient {
                store.lastMessage = "Outpatient can't be painted on weekends or no-clinic days."
            }
            return
        }
        let runs = PaintSelection.contiguousRuns(dates, includeWeekends: drag.phase != .outpatient)
        isCommittingPaint = true
        Task {
            let inputs = runs.map { run -> [String: Any] in
                [
                    "blockRef": block.id,
                    "rotatorRef": drag.rotatorId,
                    "startDate": run.start,
                    "endDate": run.end,
                    "phase": drag.phase.rawValue,
                ]
            }
            let result = await store.runBatch("assign.range", inputs: inputs)
            if result.ok && result.changed {
                let name = store.state?.rotatorLabel(drag.rotatorId) ?? drag.rotatorId
                store.lastMessage = "Painted \(dates.count) \(drag.phase.title) day\(dates.count == 1 ? "" : "s") for \(name)."
            }
            // On an ok-but-unchanged batch, keep the backend's own message
            // ("No changes for … no applicable days") instead of claiming
            // a paint that didn't happen.
            isCommittingPaint = false
            paintDrag = nil
        }
    }

    // MARK: - Methodist 14/14 setup
    // Gating predicates live in MethodistSetup (Model) so they stay testable
    // and pinned to the engine's methodist-no-start warning semantics.

    private func methodistRotatorsMissingStart(block: ServiceBlock, state: SchedulerState) -> [Rotator] {
        MethodistSetup.rotatorsMissingStart(block: block, state: state)
    }

    private func suggestedRotationStart(rotator: Rotator, block: ServiceBlock) -> String? {
        MethodistSetup.suggestedRotationStart(rotator: rotator, block: block)
    }

    private func methodistSourceNotice(state: SchedulerState) -> String? {
        let readiness = SourceReadiness(state: state)
        guard let methodist = readiness.expectedPrograms.first(where: {
            $0.program.caseInsensitiveCompare("Methodist") == .orderedSame
        }) else { return nil }
        switch methodist.status {
        case .reviewed:
            return nil
        case .dataPresent:
            return "Methodist roster data is present, but its source record still needs labeling."
        case .waiting:
            return "Methodist is also still missing a reviewed source."
        }
    }

    private func methodistSetupPanel(rotators: [Rotator], block: ServiceBlock, state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Methodist 14/14 setup needed", systemImage: "building.2")
                .font(.headline)
            Text("\(rotators.count) Methodist rotator\(rotators.count == 1 ? " has" : "s have") no rotation start date, so the 14/14 inpatient/outpatient split can't be generated for them. Set a start date below, or open Rotators to edit the full profile.")
                .font(.callout)
                .foregroundStyle(.secondary)
            if let sourceNotice = methodistSourceNotice(state: state) {
                HStack(spacing: 6) {
                    Label(sourceNotice, systemImage: "tray.and.arrow.down")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Button("Open Sources") { store.screenSelection = .sources }
                        .buttonStyle(.link)
                        .font(.caption)
                        .accessibilityIdentifier("planning-grid-methodist-open-sources")
                }
            }
            ForEach(rotators) { rotator in
                methodistSetupRow(rotator: rotator, block: block)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("planning-grid-methodist-setup-panel")
    }

    private func methodistSetupRow(rotator: Rotator, block: ServiceBlock) -> some View {
        let isSaving = methodistStartSavingId == rotator.id
        let draft = (methodistStartDrafts[rotator.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return HStack(spacing: 8) {
            Text(rotator.label)
                .font(.callout.bold())
                .frame(minWidth: 140, alignment: .leading)
            TextField("YYYY-MM-DD", text: Binding(
                get: { methodistStartDrafts[rotator.id] ?? "" },
                set: { methodistStartDrafts[rotator.id] = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(width: 118)
            .accessibilityIdentifier("methodist-setup-start-field-\(rotator.id)")
            Button {
                setMethodistRotationStart(rotator: rotator, date: draft)
            } label: {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Set")
                }
            }
            .accessibilityIdentifier("methodist-setup-set-\(rotator.id)")
            .disabled(methodistStartSavingId != nil || !CalendarUtil.isISODate(draft))
            .help("Save this rotation start date for \(rotator.label)")
            if let suggestion = suggestedRotationStart(rotator: rotator, block: block) {
                Button("Use segment start \(suggestion)") {
                    setMethodistRotationStart(rotator: rotator, date: suggestion)
                }
                .buttonStyle(.link)
                .accessibilityIdentifier("methodist-setup-suggest-\(rotator.id)")
                .disabled(methodistStartSavingId != nil)
                .help("Copy \(rotator.label)'s segment start (\(suggestion)) into their rotation start date")
            }
            Button("Open in Rotators") {
                store.scheduleFocus = ScheduleFocus(rotatorId: rotator.id, title: "Set rotation start")
            }
            .buttonStyle(.link)
            .accessibilityIdentifier("methodist-setup-open-rotators-\(rotator.id)")
            Spacer(minLength: 0)
        }
    }

    private func setMethodistRotationStart(rotator: Rotator, date: String) {
        guard CalendarUtil.isISODate(date) else {
            store.lastMessage = "Enter a valid rotation start date (yyyy-MM-dd)."
            return
        }
        guard methodistStartSavingId == nil else { return }
        methodistStartSavingId = rotator.id
        Task {
            let ok = await store.run("rotator.update", input: [
                "rotatorRef": rotator.id,
                "rotatorId": rotator.id,
                "patch": ["rotationStartDate": date],
            ])
            if ok {
                methodistStartDrafts[rotator.id] = nil
                store.lastMessage = "Set \(rotator.label)'s rotation start to \(date). Run Methodist 14/14 to generate the split."
            }
            methodistStartSavingId = nil
        }
    }

    private func runPlanningEditProbeIfRequested(block: ServiceBlock) {
        guard PlanningEditProbe.isRequested, !planningEditProbeStarted else { return }
        planningEditProbeStarted = true
        Task {
            await runPlanningEditProbe(blockId: block.id)
        }
    }

    private func runPlanningEditProbe(blockId: String) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let rotatorId = "rot-edit-1"
        let targetDate = "2026-08-03"
        let initialCount = store.state?.inpatientAssignments.count ?? 0
        let initialUndoDepth = store.undoDepth
        let initialRedoDepth = store.redoDepth

        func writeFailure(_ message: String) {
            PlanningEditProbe.write([
                "ok": false,
                "screen": "Planning Grid",
                "blockId": blockId,
                "targetDate": targetDate,
                "message": message,
                "initialCount": initialCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        let edited = await store.run("assign.range", input: [
            "blockRef": blockId,
            "rotatorRef": rotatorId,
            "startDate": targetDate,
            "endDate": targetDate,
            "phase": "inpatient"
        ])
        guard edited else {
            writeFailure("Planning Grid range edit command failed.")
            return
        }
        let afterEditCount = store.state?.inpatientAssignments.count ?? -1
        let afterEditSource = store.state?.inpatientAssignments.first {
            $0.date == targetDate && $0.rotatorId == rotatorId
        }?.source ?? ""
        let afterEditUndoDepth = store.undoDepth
        let afterEditRedoDepth = store.redoDepth

        await store.undo()
        let afterUndoCount = store.state?.inpatientAssignments.count ?? -1
        let afterUndoContainsTarget = store.state?.inpatientAssignments.contains {
            $0.date == targetDate && $0.rotatorId == rotatorId
        } ?? true
        let afterUndoUndoDepth = store.undoDepth
        let afterUndoRedoDepth = store.redoDepth

        await store.redo()
        let afterRedoCount = store.state?.inpatientAssignments.count ?? -1
        let afterRedoContainsTarget = store.state?.inpatientAssignments.contains {
            $0.date == targetDate && $0.rotatorId == rotatorId
        } ?? false
        let afterRedoUndoDepth = store.undoDepth
        let afterRedoRedoDepth = store.redoDepth

        // Paint-gesture parity: two non-contiguous single-day ranges committed
        // through runBatch must revert with ONE undo (one history entry per
        // paint stroke). Ends back at the redo state so the audit's persisted
        // final-state check is unaffected.
        let batchDates = ["2026-08-04", "2026-08-06"]
        let batchOk = await store.runBatch("assign.range", inputs: batchDates.map { date in
            [
                "blockRef": blockId,
                "rotatorRef": rotatorId,
                "startDate": date,
                "endDate": date,
                "phase": "inpatient",
            ]
        }).ok
        let afterBatchCount = store.state?.inpatientAssignments.count ?? -1
        await store.undo()
        let afterBatchUndoCount = store.state?.inpatientAssignments.count ?? -1
        let afterBatchUndoContainsBatchDates = store.state?.inpatientAssignments.contains {
            batchDates.contains($0.date) && $0.rotatorId == rotatorId
        } ?? true

        PlanningEditProbe.write([
            "ok": initialCount == 0
                && afterEditCount == 1
                && afterEditSource.localizedCaseInsensitiveContains("range")
                && afterUndoCount == 0
                && !afterUndoContainsTarget
                && afterRedoCount == 1
                && afterRedoContainsTarget
                && batchOk
                && afterBatchCount == 3
                && afterBatchUndoCount == 1
                && !afterBatchUndoContainsBatchDates,
            "screen": "Planning Grid",
            "blockId": blockId,
            "targetDate": targetDate,
            "rotatorId": rotatorId,
            "initialCount": initialCount,
            "afterEditCount": afterEditCount,
            "afterUndoCount": afterUndoCount,
            "afterRedoCount": afterRedoCount,
            "afterEditSource": afterEditSource,
            "afterUndoContainsTarget": afterUndoContainsTarget,
            "afterRedoContainsTarget": afterRedoContainsTarget,
            "initialUndoDepth": initialUndoDepth,
            "initialRedoDepth": initialRedoDepth,
            "afterEditUndoDepth": afterEditUndoDepth,
            "afterEditRedoDepth": afterEditRedoDepth,
            "afterUndoUndoDepth": afterUndoUndoDepth,
            "afterUndoRedoDepth": afterUndoRedoDepth,
            "afterRedoUndoDepth": afterRedoUndoDepth,
            "afterRedoRedoDepth": afterRedoRedoDepth,
            "batchOk": batchOk,
            "afterBatchCount": afterBatchCount,
            "afterBatchUndoCount": afterBatchUndoCount,
            "lastMessage": store.lastMessage ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date())
        ])
    }
}

private enum PlanningEditProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_PLANNING_EDIT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_PLANNING_EDIT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-planning-edit.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Planning Grid edit probe: \(error.localizedDescription)")
        }
    }
}

private enum PlanningDisplayMode: String, CaseIterable, Identifiable {
    case master
    case inpatient
    case outpatient

    var id: String { rawValue }

    var title: String {
        switch self {
        case .master: return "Master"
        case .inpatient: return "Inpatient"
        case .outpatient: return "Outpatient"
        }
    }

    /// True filter per row (Coordinator 2026-07-29 #3): the Inpatient tab shows
    /// every rotator with ANY inpatient day this block, Outpatient likewise —
    /// mixed rotators appear in both. Replaces the old fixed section-id lists,
    /// which hid mixed-with-open-day rows from both tabs.
    func matches(_ row: PlanningGridRow) -> Bool {
        switch self {
        case .master:
            return true
        case .inpatient:
            return row.cells.contains { $0.status == "inpatient" || $0.status == "both" }
        case .outpatient:
            return row.cells.contains { $0.status == "outpatient" || $0.status == "both" }
        }
    }

    var showsInpatient: Bool {
        self != .outpatient
    }

    var showsOutpatient: Bool {
        self != .inpatient
    }

    var showsOff: Bool {
        self != .outpatient
    }

    var inpatientWidth: CGFloat {
        self == .inpatient ? 420 : 260
    }

    var outpatientWidth: CGFloat {
        self == .outpatient ? 520 : 300
    }

    var gridMinWidth: CGFloat {
        switch self {
        case .master: return 1010
        case .inpatient: return 760
        case .outpatient: return 820
        }
    }
}

private enum NativePlanningGridProbe {
    private static let sectionIds = ["needs", "mixed", "fullyIp", "fullyOp", "unavailable"]

    static func fingerprint(
        projection: PlanningGridProjection,
        displayMode: PlanningDisplayMode,
        state: SchedulerState
    ) -> String {
        let counts = sectionIds.map { "\($0):\(projection.count($0))" }.joined(separator: "|")
        return [
            projection.blockId,
            displayMode.rawValue,
            "\(projection.dates.count)",
            "\(projection.rows.count)",
            "\(state.rotators.count)",
            counts
        ].joined(separator: "::")
    }

    static func write(
        projection: PlanningGridProjection,
        displayMode: PlanningDisplayMode,
        state: SchedulerState
    ) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-planning-grid.json")
        let sectionCounts = Dictionary(
            uniqueKeysWithValues: sectionIds.map { ($0, projection.count($0)) }
        )
        let sectionSamples = Dictionary(
            uniqueKeysWithValues: sectionIds.map { sectionId in
                (sectionId, projection.rows(in: sectionId).prefix(5).map(\.rotator.label))
            }
        )
        let payload: [String: Any] = [
            "ok": true,
            "screen": "Planning Grid",
            "blockId": projection.blockId,
            "activeBlockId": state.activeBlockId,
            "activeBlockName": state.activeBlock?.name ?? "",
            "displayMode": displayMode.rawValue,
            "dateCount": projection.dates.count,
            "rowCount": projection.rows.count,
            "rotatorCount": state.rotators.count,
            "sectionCounts": sectionCounts,
            "sectionSamples": sectionSamples,
            "totals": [
                "inpatient": projection.totalInpatient,
                "outpatient": projection.totalOutpatient,
                "unassigned": projection.totalUnassigned,
                "both": projection.totalBoth
            ],
            "sampleRows": projection.rows.prefix(8).map(\.rotator.label)
        ]

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Planning Grid probe: \(error.localizedDescription)")
        }
    }
}

private enum RangePhase: String, CaseIterable, Identifiable {
    case inpatient
    case outpatient
    case off
    case clear

    var id: String { rawValue }

    var title: String {
        switch self {
        case .inpatient: return "IP"
        case .outpatient: return "OP"
        case .off: return "Off"
        case .clear: return "Clear"
        }
    }

    var systemImage: String {
        switch self {
        case .inpatient: return "bed.double"
        case .outpatient: return "stethoscope"
        case .off: return "slash.circle"
        case .clear: return "eraser"
        }
    }
}

private struct PlanningProjectionSummary: View {
    let projection: PlanningGridProjection?
    let displayMode: PlanningDisplayMode
    let isLoading: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let projection {
                PlanningStatChip(title: "Needs", value: projection.count("needs"), color: .orange)
                PlanningStatChip(title: "Mixed", value: projection.count("mixed"), color: .teal)
                PlanningStatChip(title: "IP", value: projection.count("fullyIp"), color: .green)
                PlanningStatChip(title: "OP", value: projection.count("fullyOp"), color: .blue)
                PlanningStatChip(title: "Away", value: projection.count("unavailable"), color: .gray)
                Divider().frame(height: 24)
                PlanningStatChip(title: "IP days", value: projection.totalInpatient, color: .green)
                PlanningStatChip(title: "OP days", value: projection.totalOutpatient, color: .blue)
                PlanningStatChip(title: "Open", value: projection.totalUnassigned, color: .orange)
                if projection.totalBoth > 0 {
                    PlanningStatChip(title: "Both", value: projection.totalBoth, color: .purple)
                }
            } else {
                Label(isLoading ? "Loading grid" : "Grid projection", systemImage: "tablecells")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Text(displayMode.title)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Button(action: onRefresh) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 16, height: 16)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("planning-grid-refresh-button")
            .help("Refresh planning grid")
            .disabled(isLoading)
        }
    }
}

private struct PlanningStatChip: View {
    let title: String
    let value: Int
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.caption.bold())
                .foregroundStyle(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(color.opacity(0.1), in: Capsule())
    }
}

private struct PlanningStaffSession {
    let period: String
    let clinic: String
    let provider: String
}

private enum PlanningMatrixLayout {
    static let rowHeaderWidth: CGFloat = 190
    static let baseCellHeight: CGFloat = 42
    static let minimumCellWidth: CGFloat = 24
    static let maximumCellWidth: CGFloat = 66
    /// Absolute floor under zoom — protects sweepDates' width division from
    /// off-by-one cell resolution at extreme zoom-out.
    static let absoluteMinimumCellWidth: CGFloat = 16
    static let coordinateSpace = "planning-matrix-scroll"

    static func metrics(viewportWidth: CGFloat, rawDateCount: Int, zoom: Double = 1.0) -> PlanningMatrixMetrics {
        let dateCount = max(1, rawDateCount)
        let separators = CGFloat(dateCount + 1)
        let available = max(0, viewportWidth - rowHeaderWidth - separators - 4)
        let fitted = floor(available / CGFloat(dateCount))
        let base = min(maximumCellWidth, max(minimumCellWidth, fitted))
        let scale = CGFloat(zoom)
        return PlanningMatrixMetrics(
            cellWidth: max(absoluteMinimumCellWidth, (base * scale).rounded()),
            cellHeight: max(18, (baseCellHeight * scale).rounded())
        )
    }
}

private struct PlanningMatrixMetrics {
    let cellWidth: CGFloat
    let cellHeight: CGFloat
}

/// Keeps the leading matrix cell visible while the shared two-axis scroll view
/// moves its date columns. One scroll view preserves row alignment and paint
/// gestures; the offset only counteracts horizontal movement for this cell.
private struct PlanningMatrixStickyLeading<Content: View>: View {
    let width: CGFloat
    let height: CGFloat
    let content: Content

    init(width: CGFloat, height: CGFloat, @ViewBuilder content: () -> Content) {
        self.width = width
        self.height = height
        self.content = content()
    }

    var body: some View {
        GeometryReader { geometry in
            content
                .frame(width: width, height: height, alignment: .leading)
                .offset(x: max(0, -geometry.frame(in: .named(PlanningMatrixLayout.coordinateSpace)).minX))
        }
        .frame(width: width, height: height)
        .zIndex(10)
    }
}

private struct PlanningDropFeedback {
    let isValid: Bool
    let reason: String
}

/// In-flight paint sweep. Row and phase are snapshotted when the drag starts
/// (mirroring the browser paintReducer's `down` action, so mid-drag phase
/// flips can't corrupt the paint); dates accumulate as the drag covers them.
private struct PaintDragState {
    let rotatorId: String
    let phase: RangePhase
    var selected: Set<String>
}

/// Precomputed once when a drag starts so per-cell drop validation does set
/// lookups instead of rescanning every assignment while the cursor moves.
private struct PlanningDragContext {
    let rotatorId: String
    let inpatientDates: Set<String>
    let outpatientDates: Set<String>

    init(state: SchedulerState, rotatorId: String) {
        self.rotatorId = rotatorId
        inpatientDates = Set(
            state.inpatientAssignments
                .filter { $0.rotatorId == rotatorId && !$0.isOff }
                .map(\.date)
        )
        outpatientDates = Set(
            state.outpatientSessions
                .filter { $0.rotatorId == rotatorId }
                .map(\.date)
        )
    }
}

private enum PlanningDropValidator {
    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    static func validate(
        state: SchedulerState,
        rotatorId: String?,
        date: String,
        dropDisabled: Bool = false,
        isPeek: Bool = false,
        isEditable: Bool = true,
        expectedRowRotatorId: String? = nil,
        dragContext: PlanningDragContext? = nil
    ) -> PlanningDropFeedback {
        if dropDisabled {
            return invalid("Finish the current action before dropping another rotator.")
        }
        if isPeek {
            return invalid("Peek days are read-only.")
        }
        if !isEditable {
            return invalid("This target is read-only.")
        }
        guard let rotatorId, !rotatorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return invalid("Drag a rotator to assign inpatient.")
        }
        if let expectedRowRotatorId, expectedRowRotatorId != rotatorId {
            return invalid("Drop \(state.rotatorLabel(rotatorId)) on their own row.")
        }
        guard let rotator = state.rotator(rotatorId) else {
            return invalid("Rotator not found.")
        }
        if !rotator.isActive(on: date) {
            return invalid("\(rotator.label) is not on service on \(date).")
        }
        if let unavailable = unavailableReason(rotator: rotator, date: date) {
            return invalid("\(rotator.label) is unavailable on \(date) (\(unavailable)).")
        }
        let context = dragContext?.rotatorId == rotatorId ? dragContext : nil
        if context?.outpatientDates.contains(date)
            ?? state.outpatientSessions.contains(where: { $0.date == date && $0.rotatorId == rotatorId }) {
            return invalid("\(rotator.label) already has an outpatient session on \(date).")
        }
        if let maxConsecutive = state.rules?.maxConsecutiveInpatientDays,
           maxConsecutive > 0,
           consecutiveInpatientRun(state: state, rotatorId: rotatorId, date: date, precomputed: context?.inpatientDates) > maxConsecutive {
            return invalid("\(rotator.label) would exceed \(maxConsecutive) consecutive inpatient days.")
        }
        return PlanningDropFeedback(isValid: true, reason: "Drop to assign inpatient.")
    }

    private static func unavailableReason(rotator: Rotator, date: String) -> String? {
        let weekday = CalendarUtil.weekdayName(date)
        if (rotator.dayOff ?? []).contains(weekday) {
            return weekday
        }
        for range in rotator.unavailableRanges ?? [] {
            if range.start <= date && date <= range.end {
                return "\(range.start) to \(range.end)"
            }
        }
        return nil
    }

    private static func consecutiveInpatientRun(state: SchedulerState, rotatorId: String, date: String, precomputed: Set<String>? = nil) -> Int {
        var assigned = precomputed ?? Set(
            state.inpatientAssignments
                .filter { $0.rotatorId == rotatorId && !$0.isOff }
                .map(\.date)
        )
        assigned.insert(date)
        var length = 1
        var cursor = addDays(date, -1)
        while let value = cursor, assigned.contains(value) {
            length += 1
            cursor = addDays(value, -1)
        }
        cursor = addDays(date, 1)
        while let value = cursor, assigned.contains(value) {
            length += 1
            cursor = addDays(value, 1)
        }
        return length
    }

    private static func addDays(_ iso: String, _ days: Int) -> String? {
        guard let date = CalendarUtil.date(from: iso),
              let shifted = utcCalendar.date(byAdding: .day, value: days, to: date)
        else { return nil }
        let parts = utcCalendar.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private static func invalid(_ reason: String) -> PlanningDropFeedback {
        PlanningDropFeedback(isValid: false, reason: reason)
    }
}

private struct PlanningMatrixView: View {
    let state: SchedulerState
    let projection: PlanningGridProjection
    let displayMode: PlanningDisplayMode
    let showStaffRows: Bool
    let staffRows: [PlanningGridRow]
    let visibleRotatorIds: Set<String>?
    let selectedRotatorId: String
    let phase: RangePhase
    let focus: ScheduleFocus?
    let paintingDate: String?
    let droppingDate: String?
    let draggingRotatorId: String?
    let dragContext: PlanningDragContext?
    let paintActive: Bool
    let paintDrag: PaintDragState?
    let paintCommitting: Bool
    let actionsDisabled: Bool
    let dropDisabled: Bool
    let onSelectRotator: (String) -> Void
    let onDragRotator: (String) -> Void
    let onPaintCell: (String, String) -> Void
    let onPaintSweep: (String, Set<String>) -> Void
    let onPaintSweepEnd: () -> Void
    let onInvalidDrop: (String) -> Void
    let onDropRotator: (String, String) -> Void
    @State private var collapsedSections: Set<String> = []
    /// Grid zoom (Coordinator 2026-07-29 call: Option+scroll resizes the cells so
    /// nearly the whole roster plus the coverage-count footer fit on screen).
    /// Persisted so her chosen density survives relaunches.
    @AppStorage("planningGridZoom") private var zoomScale: Double = 1.0
    @State private var scrollMonitor: Any?

    private static let zoomRange: ClosedRange<Double> = 0.55...1.4

    var body: some View {
        GeometryReader { geometry in
            let metrics = PlanningMatrixLayout.metrics(
                viewportWidth: geometry.size.width,
                rawDateCount: rawDateCount,
                zoom: zoomScale
            )
            ScrollViewReader { proxy in
                matrixScroll(metrics: metrics)
                    .onAppear { scrollToFocus(proxy: proxy) }
                    .onChange(of: focus) { _ in scrollToFocus(proxy: proxy) }
            }
        }
        .accessibilityIdentifier("planning-grid-matrix")
        .frame(minHeight: 260, maxHeight: .infinity)
        .layoutPriority(1)
        .background(Color.secondary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
        .onAppear { installZoomScrollMonitor() }
        .onDisappear { removeZoomScrollMonitor() }
    }

    /// Option+scroll-wheel zoom. A local NSEvent monitor is the only macOS
    /// SwiftUI route to "modifier + scroll"; it is installed only while this
    /// grid is on screen and consumes the event so the scroll view doesn't
    /// also pan.
    private func installZoomScrollMonitor() {
        guard scrollMonitor == nil else { return }
        scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { event in
            guard event.modifierFlags.contains(.option) else { return event }
            let step = event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.004 : 0.04)
            let next = min(Self.zoomRange.upperBound, max(Self.zoomRange.lowerBound, zoomScale + step))
            if next != zoomScale {
                zoomScale = next
            }
            return nil
        }
    }

    private func removeZoomScrollMonitor() {
        if let scrollMonitor {
            NSEvent.removeMonitor(scrollMonitor)
            self.scrollMonitor = nil
        }
    }

    private func matrixScroll(metrics: PlanningMatrixMetrics) -> some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 1, pinnedViews: [.sectionHeaders]) {
                Section {
                    if showStaffRows && !staffRows.isEmpty {
                        let isCollapsed = collapsedSections.contains("staff")
                        PlanningMatrixSectionHeader(
                            sectionId: "staff",
                            count: staffRows.count,
                            dateCount: projection.dates.count,
                            isCollapsed: isCollapsed,
                            metrics: metrics
                        ) {
                            toggleSection("staff")
                        }
                        if !isCollapsed {
                            ForEach(staffRows) { row in
                                matrixRow(row, metrics: metrics)
                                    .id(row.rotator.id)
                            }
                        }
                    }

                    // One stable alphabetical list (Coordinator 2026-07-29 #2):
                    // no category sections, no re-sorting as assignments
                    // change, and "not in block" rows are dropped entirely.
                    let rows = visibleRows()
                    if rows.isEmpty {
                        PlanningMatrixEmptyRow(
                            displayMode: displayMode,
                            dates: projection.dates,
                            rawStartDate: projection.rawStartDate,
                            rawEndDate: projection.rawEndDate,
                            metrics: metrics
                        )
                    } else {
                        ForEach(rows) { row in
                            matrixRow(row, metrics: metrics)
                                .id(row.rotator.id)
                        }
                    }

                    PlanningMatrixTotalsFooter(totals: projection.totals, metrics: metrics)
                } header: {
                    PlanningMatrixDateHeader(
                        dates: projection.dates,
                        rawStartDate: projection.rawStartDate,
                        rawEndDate: projection.rawEndDate,
                        metrics: metrics
                    )
                }
            }
            .padding(1)
        }
        .coordinateSpace(name: PlanningMatrixLayout.coordinateSpace)
    }

    private func matrixRow(_ row: PlanningGridRow, metrics: PlanningMatrixMetrics) -> some View {
        PlanningMatrixRowView(
            state: state,
            row: row,
            rawStartDate: projection.rawStartDate,
            rawEndDate: projection.rawEndDate,
            selectedRotatorId: selectedRotatorId,
            phase: phase,
            focus: focus,
            paintingDate: paintingDate,
            droppingDate: droppingDate,
            draggingRotatorId: draggingRotatorId,
            dragContext: dragContext,
            paintActive: paintActive,
            paintDrag: paintDrag,
            paintCommitting: paintCommitting,
            actionsDisabled: actionsDisabled,
            dropDisabled: dropDisabled,
            metrics: metrics,
            onSelectRotator: onSelectRotator,
            onDragRotator: onDragRotator,
            onPaintCell: onPaintCell,
            onPaintSweep: onPaintSweep,
            onPaintSweepEnd: onPaintSweepEnd,
            onInvalidDrop: onInvalidDrop,
            onDropRotator: onDropRotator
        )
    }

    private var rawDateCount: Int {
        let count = projection.dates.filter { date in
            if let rawStartDate = projection.rawStartDate, date < rawStartDate { return false }
            if let rawEndDate = projection.rawEndDate, date > rawEndDate { return false }
            return true
        }.count
        return count > 0 ? count : projection.dates.count
    }

    private func scrollToFocus(proxy: ScrollViewProxy) {
        guard let focus, focus.target == .planning else { return }
        // Only the pinned staff block is collapsible now — auto-open it when
        // the focused rotator lives there.
        if showStaffRows,
           let rotatorId = focus.rotatorId,
           staffRows.contains(where: { $0.rotator.id == rotatorId }) {
            collapsedSections.remove("staff")
        }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(focus.rotatorId ?? focus.date, anchor: .center)
        }
    }

    private func toggleSection(_ sectionId: String) {
        if collapsedSections.contains(sectionId) {
            collapsedSections.remove(sectionId)
        } else {
            collapsedSections.insert(sectionId)
        }
    }

    private var staffFellowIds: Set<String> {
        guard showStaffRows else { return [] }
        return Set(staffRows.filter { $0.rotator.isPediatricNeurologyFellow && !$0.rotator.isAttendingProjection }.map(\.rotator.id))
    }

    private func visibleRows() -> [PlanningGridRow] {
        let fellowIds = staffFellowIds
        return projection.rows
            .filter { visibleRotatorIds == nil || visibleRotatorIds?.contains($0.rotator.id) == true }
            .filter { !fellowIds.contains($0.rotator.id) }
            .filter { row in row.cells.contains { $0.status != "absent" } }
            .filter { displayMode.matches($0) }
            .sorted { $0.rotator.label.localizedCaseInsensitiveCompare($1.rotator.label) == .orderedAscending }
    }
}

private struct PlanningMatrixDateHeader: View {
    let dates: [String]
    let rawStartDate: String?
    let rawEndDate: String?
    let metrics: PlanningMatrixMetrics

    var body: some View {
        HStack(spacing: 1) {
            PlanningMatrixStickyLeading(
                width: PlanningMatrixLayout.rowHeaderWidth,
                height: metrics.cellHeight
            ) {
                Text("Rotator")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                    .padding(.leading, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .background(.bar)
            }

            ForEach(dates.indices, id: \.self) { index in
                let date = dates[index]
                let isPeek = isPeekDate(date)
                VStack(spacing: 1) {
                    Text(String(CalendarUtil.weekdayName(date).prefix(3)))
                        .font(.caption2.bold())
                    Text(shortDate(date))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: metrics.cellWidth, height: metrics.cellHeight)
                .background(headerBackground(date))
                .overlay(alignment: .topLeading) {
                    if isPeek && (index == dates.startIndex || !isPeekDate(dates[index - 1])) {
                        Rectangle()
                            .fill(Color.accentColor.opacity(0.65))
                            .frame(width: 2)
                    }
                }
                .help(isPeek ? "\(date) is a read-only peek day" : date)
                .id(date)
            }
        }
        .background(.bar)
    }

    private func isPeekDate(_ date: String) -> Bool {
        if let rawStartDate, date < rawStartDate { return true }
        if let rawEndDate, date > rawEndDate { return true }
        return false
    }

    private func headerBackground(_ date: String) -> Color {
        if isPeekDate(date) {
            return Color.accentColor.opacity(0.08)
        }
        return CalendarUtil.isWeekend(date) ? Color.secondary.opacity(0.08) : Color.secondary.opacity(0.04)
    }

    private func shortDate(_ date: String) -> String {
        let parts = date.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return date }
        return "\(month)/\(day)"
    }
}

private struct PlanningMatrixSectionHeader: View {
    let sectionId: String
    let count: Int
    let dateCount: Int
    let isCollapsed: Bool
    let metrics: PlanningMatrixMetrics
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 8) {
                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .frame(width: 10)
                Text(sectionTitle)
                    .font(.caption.bold())
                Text("\(count)")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12), in: Capsule())
                Spacer(minLength: 0)
            }
            .frame(width: PlanningMatrixLayout.rowHeaderWidth + CGFloat(dateCount) * (metrics.cellWidth + 1), alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.secondary.opacity(0.08))
    }

    private var sectionTitle: String {
        // Only the pinned staff block still renders a section header.
        sectionId == "staff" ? "Staff rows" : sectionId
    }
}

private struct PlanningMatrixEmptyRow: View {
    let displayMode: PlanningDisplayMode
    let dates: [String]
    let rawStartDate: String?
    let rawEndDate: String?
    let metrics: PlanningMatrixMetrics

    var body: some View {
        HStack(spacing: 1) {
            PlanningMatrixStickyLeading(
                width: PlanningMatrixLayout.rowHeaderWidth,
                height: metrics.cellHeight
            ) {
                Text(emptyText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .background(Color(nsColor: .controlBackgroundColor))
            }
            ForEach(dates, id: \.self) { date in
                Text("-")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(width: metrics.cellWidth, height: metrics.cellHeight)
                    .background(isPeekDate(date) ? Color.accentColor.opacity(0.05) : Color.secondary.opacity(0.03))
            }
        }
    }

    private func isPeekDate(_ date: String) -> Bool {
        if let rawStartDate, date < rawStartDate { return true }
        if let rawEndDate, date > rawEndDate { return true }
        return false
    }

    private var emptyText: String {
        switch displayMode {
        case .master: return "No rotators in this block"
        case .inpatient: return "No inpatient rotators this block"
        case .outpatient: return "No outpatient rotators this block"
        }
    }
}

private struct PlanningMatrixRowView: View {
    let state: SchedulerState
    let row: PlanningGridRow
    let rawStartDate: String?
    let rawEndDate: String?
    let selectedRotatorId: String
    let phase: RangePhase
    let focus: ScheduleFocus?
    let paintingDate: String?
    let droppingDate: String?
    let draggingRotatorId: String?
    let dragContext: PlanningDragContext?
    let paintActive: Bool
    let paintDrag: PaintDragState?
    let paintCommitting: Bool
    let actionsDisabled: Bool
    let dropDisabled: Bool
    let metrics: PlanningMatrixMetrics
    let onSelectRotator: (String) -> Void
    let onDragRotator: (String) -> Void
    let onPaintCell: (String, String) -> Void
    let onPaintSweep: (String, Set<String>) -> Void
    let onPaintSweepEnd: () -> Void
    let onInvalidDrop: (String) -> Void
    let onDropRotator: (String, String) -> Void

    var body: some View {
        HStack(spacing: 1) {
            PlanningMatrixStickyLeading(
                width: PlanningMatrixLayout.rowHeaderWidth,
                height: metrics.cellHeight
            ) {
                rowHeader
            }
            cellsStrip
        }
        // .contain keeps the row identifier on the row group itself. Without
        // it, an identifier on a plain container cascades onto every child
        // button and clobbers the per-cell planning-grid-cell-* identifiers
        // (which the paint AX probe clicks).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("planning-grid-matrix-row-\(row.rotator.id)")
    }

    private var canPaintSweep: Bool {
        paintActive && !row.rotator.isAttendingProjection
    }

    private var rowPaintDrag: PaintDragState? {
        guard let paintDrag, paintDrag.rotatorId == row.rotator.id else { return nil }
        return paintDrag
    }

    private var cellsStrip: some View {
        HStack(spacing: 1) {
            ForEach(row.cells) { cell in
                let isPeek = isPeekDate(cell.date)
                let inSweep = rowPaintDrag?.selected.contains(cell.date) == true
                PlanningMatrixCellView(
                    state: state,
                    cell: cell,
                    rotatorId: row.rotator.id,
                    phase: phase,
                    continuityPeriods: CalendarUtil.continuityPeriods(
                        row.rotator.continuityClinic,
                        onWeekday: CalendarUtil.weekdayName(cell.date)
                    ),
                    isPeek: isPeek,
                    isFocused: cellMatchesFocus(cell),
                    isPainting: (paintingDate == cell.date && selectedRotatorId == row.rotator.id)
                        || (paintCommitting && inSweep),
                    isDropping: droppingDate == cell.date,
                    draggingRotatorId: draggingRotatorId,
                    dragContext: dragContext,
                    paintActive: paintActive,
                    paintPreviewPhase: inSweep ? rowPaintDrag?.phase : nil,
                    actionsDisabled: actionsDisabled,
                    dropDisabled: dropDisabled,
                    metrics: metrics,
                    onPaint: { onPaintCell(row.rotator.id, cell.date) },
                    onInvalidDrop: onInvalidDrop,
                    onDropRotator: { rotatorId in onDropRotator(rotatorId, cell.date) }
                )
                .accessibilityIdentifier("planning-grid-cell-\(row.rotator.id)-\(cell.date)")
                .accessibilityLabel("\(row.rotator.label), \(cell.date)")
            }
        }
        .overlay {
            if canPaintSweep {
                // Paint mode: a transparent layer captures the drag so a sweep
                // can't fight the scroll view or the per-cell buttons. The
                // drag stays bound to the row it started on (single-row sweep,
                // matching the browser paint tool).
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .local)
                            .onChanged { value in
                                onPaintSweep(
                                    row.rotator.id,
                                    sweepDates(from: value.startLocation.x, to: value.location.x)
                                )
                            }
                            .onEnded { _ in onPaintSweepEnd() }
                    )
            }
        }
    }

    /// Paintable dates covered by a sweep from one x-offset to another within
    /// this row's cell strip. Peek days and non-editable cells never join the
    /// selection.
    private func sweepDates(from startX: CGFloat, to endX: CGFloat) -> Set<String> {
        let unit = metrics.cellWidth + 1
        let count = row.cells.count
        guard count > 0, unit > 0 else { return [] }
        let low = max(0, min(count - 1, Int((min(startX, endX) / unit).rounded(.down))))
        let high = max(0, min(count - 1, Int((max(startX, endX) / unit).rounded(.down))))
        var out = Set<String>()
        for index in low...high {
            let cell = row.cells[index]
            guard cell.isEditable, !isPeekDate(cell.date) else { continue }
            out.insert(cell.date)
        }
        return out
    }

    @ViewBuilder
    private var rowHeader: some View {
        if row.rotator.isAttendingProjection {
            rowHeaderContent
                .help("Read-only attending projection")
        } else {
            Button {
                onSelectRotator(row.rotator.id)
            } label: {
                rowHeaderContent
            }
            .buttonStyle(.plain)
            .onDrag {
                onDragRotator(row.rotator.id)
                return NSItemProvider(object: row.rotator.id as NSString)
            }
            .help("Drag to assign inpatient")
        }
    }

    private var rowHeaderContent: some View {
        HStack(spacing: 7) {
            Image(systemName: row.rotator.isAttendingProjection ? "stethoscope" : "line.3.horizontal")
                .foregroundStyle(.secondary)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    if row.rotator.isPediatricNeurologyFellow {
                        Image(systemName: "star.fill")
                            .font(.caption2.bold())
                            .foregroundStyle(.orange)
                    }
                    Text(row.rotator.label)
                        .font(.caption.bold())
                        .lineLimit(1)
                }
                Text(row.rotator.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .frame(width: PlanningMatrixLayout.rowHeaderWidth, height: metrics.cellHeight, alignment: .leading)
        .background(rowHeaderBackground)
        .background(Color(nsColor: .controlBackgroundColor))
        .contentShape(Rectangle())
        .accessibilityIdentifier("planning-grid-row-header-\(row.rotator.id)")
    }

    private var rowHeaderBackground: Color {
        if row.rotator.isAttendingProjection {
            return Color.blue.opacity(0.08)
        }
        if row.rotator.id == selectedRotatorId {
            return Color.accentColor.opacity(0.14)
        }
        return Color.secondary.opacity(0.04)
    }

    private func cellMatchesFocus(_ cell: PlanningGridCell) -> Bool {
        guard let focus,
              focus.target == .planning,
              focus.date == cell.date
        else { return false }
        if let rotatorId = focus.rotatorId, rotatorId != row.rotator.id {
            return false
        }
        return true
    }

    private func isPeekDate(_ date: String) -> Bool {
        if let rawStartDate, date < rawStartDate { return true }
        if let rawEndDate, date > rawEndDate { return true }
        return false
    }
}

private struct PlanningMatrixCellView: View {
    let state: SchedulerState
    let cell: PlanningGridCell
    let rotatorId: String
    let phase: RangePhase
    /// "AM"/"PM" continuity-clinic periods for this cell's weekday; renders
    /// the corner badge Coordinator plans coverage around (2026-07-29 #8).
    let continuityPeriods: [String]
    let isPeek: Bool
    let isFocused: Bool
    let isPainting: Bool
    let isDropping: Bool
    let draggingRotatorId: String?
    let dragContext: PlanningDragContext?
    let paintActive: Bool
    let paintPreviewPhase: RangePhase?
    let actionsDisabled: Bool
    let dropDisabled: Bool
    let metrics: PlanningMatrixMetrics
    let onPaint: () -> Void
    let onInvalidDrop: (String) -> Void
    let onDropRotator: (String) -> Void
    @State private var isDropTargeted = false

    var body: some View {
        // Computed once per body: activeDropFeedback runs the drop validator, so
        // fill/stroke/help sharing one result matters while a drag is hovering.
        let feedback = activeDropFeedback
        Button(action: onPaint) {
            ZStack {
                RoundedRectangle(cornerRadius: 5)
                    .fill(backgroundColor(feedback))
                RoundedRectangle(cornerRadius: 5)
                    .stroke(borderColor(feedback), lineWidth: isFocused || isDropTargeted || feedback != nil || paintPreviewPhase != nil ? 2 : 1)
                if isPainting || isDropping {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    VStack(spacing: 1) {
                        Text(statusLabel)
                            .font(.caption2.bold())
                        if let detail = detailLabel {
                            Text(detail)
                                .font(.caption2)
                                .fontWeight(.medium)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .foregroundStyle(foregroundColor)
                }
            }
            .frame(width: metrics.cellWidth, height: metrics.cellHeight)
            .overlay(alignment: .bottomLeading) {
                // Continuity-clinic corner badge: "AM"/"PM", or "C" when the
                // rotator has both half-days. Shown regardless of cell status,
                // matching the pre-port React grid.
                if !continuityPeriods.isEmpty {
                    Text(continuityPeriods.count == 2 ? "C" : continuityPeriods[0])
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Color.indigo)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(
                            Color.indigo.opacity(0.14),
                            in: UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 5, bottomTrailingRadius: 0, topTrailingRadius: 5)
                        )
                        .allowsHitTesting(false)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(actionsDisabled || !cell.isEditable || isPeek)
        .help(continuityPeriods.isEmpty
            ? helpText(feedback)
            : "\(helpText(feedback)) Continuity clinic: \(continuityPeriods.joined(separator: " + ")).")
        .accessibilityValue(statusLabel.isEmpty ? "Not in block" : statusLabel)
        .onDrop(of: [.plainText], isTargeted: $isDropTargeted) { providers in
            guard !dropDisabled, let provider = providers.first else { return false }
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                guard let droppedRotatorId = rotatorId(from: item) else { return }
                DispatchQueue.main.async {
                    let feedback = dropFeedback(for: droppedRotatorId)
                    guard feedback.isValid else {
                        onInvalidDrop(feedback.reason)
                        return
                    }
                    onDropRotator(droppedRotatorId)
                }
            }
            return true
        }
    }

    private static func phaseColor(_ phase: RangePhase) -> Color {
        switch phase {
        case .inpatient: return .green
        case .outpatient: return .blue
        case .off: return .gray
        case .clear: return .orange
        }
    }

    private func backgroundColor(_ preview: PlanningDropFeedback?) -> Color {
        if let paintPreviewPhase {
            return Self.phaseColor(paintPreviewPhase).opacity(0.35)
        }
        if let preview {
            return preview.isValid ? Color.green.opacity(isDropTargeted ? 0.22 : 0.08) : Color.red.opacity(isDropTargeted ? 0.22 : 0.08)
        }
        if isPeek {
            return peekBackgroundColor
        }
        switch cell.status {
        case "inpatient":
            return Color.green.opacity(0.16)
        case "outpatient":
            if cell.staffKind == "attending" {
                return Color.blue.opacity(0.1)
            }
            return Color.blue.opacity(0.16)
        case "both":
            return Color.purple.opacity(0.18)
        case "off":
            return cell.reason == "marked-off" ? Color.gray.opacity(0.22) : Color.gray.opacity(0.14)
        case "absent":
            return Color.secondary.opacity(0.06)
        default:
            return cell.offCalendar ? Color.orange.opacity(0.08) : Color.orange.opacity(0.16)
        }
    }

    private var peekBackgroundColor: Color {
        switch cell.status {
        case "inpatient":
            return Color.green.opacity(0.08)
        case "outpatient":
            return Color.blue.opacity(0.08)
        case "both":
            return Color.purple.opacity(0.09)
        case "off":
            return Color.gray.opacity(0.12)
        case "absent":
            return Color.secondary.opacity(0.05)
        default:
            return Color.orange.opacity(0.08)
        }
    }

    private func borderColor(_ preview: PlanningDropFeedback?) -> Color {
        if let paintPreviewPhase {
            return Self.phaseColor(paintPreviewPhase).opacity(0.9)
        }
        if isFocused {
            return Color.accentColor
        }
        if let preview {
            return preview.isValid ? Color.green.opacity(isDropTargeted ? 0.85 : 0.42) : Color.red.opacity(isDropTargeted ? 0.85 : 0.42)
        }
        if isPeek {
            return Color.secondary.opacity(0.24)
        }
        switch cell.status {
        case "inpatient": return Color.green.opacity(0.45)
        case "outpatient": return Color.blue.opacity(0.45)
        case "both": return Color.purple.opacity(0.5)
        case "off": return Color.gray.opacity(0.35)
        case "absent": return Color.secondary.opacity(0.18)
        default: return Color.orange.opacity(0.45)
        }
    }

    private var foregroundColor: Color {
        if isPeek {
            return .secondary
        }
        switch cell.status {
        case "absent", "off":
            return .secondary
        case "inpatient":
            return .green
        case "outpatient":
            return .blue
        case "both":
            return .purple
        default:
            return .orange
        }
    }

    private var statusLabel: String {
        switch cell.status {
        case "inpatient": return "IP"
        case "outpatient": return cell.staffKind == "attending" ? staffPeriodLabel : "OP"
        case "both": return "IP+OP"
        case "off": return "OFF"
        case "absent": return ""
        default: return "-"
        }
    }

    private var detailLabel: String? {
        if cell.staffKind == "attending" {
            return nil
        }
        if cell.status == "both" {
            return "\(cell.inpatientCount) IP / \(cell.outpatientCount) OP"
        }
        if cell.status == "off", let reason = cell.reason, reason != "marked-off" {
            return reason
        }
        if cell.status == "unassigned", cell.offCalendar {
            return "closed"
        }
        if cell.status == "absent" {
            return "not in block"
        }
        return nil
    }

    private var staffPeriodLabel: String {
        if cell.staffPeriods.isEmpty {
            return "OP"
        }
        if cell.staffPeriods.count == 1 {
            return cell.staffPeriods[0]
        }
        return "AM+PM"
    }

    private func helpText(_ preview: PlanningDropFeedback?) -> String {
        let visibleStatus = statusLabel.isEmpty ? "Not in block" : statusLabel
        var parts = ["\(cell.date): \(visibleStatus)"]
        if let preview {
            parts.append(preview.isValid ? "Valid inpatient drop target" : "Invalid drop target")
            parts.append(preview.reason)
        }
        parts.append(contentsOf: cell.staffTitles)
        if let label = cell.label, !label.isEmpty {
            parts.append(label)
        }
        if let reason = cell.reason, !reason.isEmpty {
            parts.append(reason)
        }
        if isPeek {
            parts.append("Read-only peek day")
        } else if cell.isEditable {
            parts.append(paintActive
                ? "Drag or click to paint \(phase.title)"
                : "Click to select this rotator - turn on Paint to edit")
        } else if cell.staffKind == "attending" {
            parts.append("Read-only staff row")
        }
        return parts.joined(separator: " - ")
    }

    private var activeDropFeedback: PlanningDropFeedback? {
        guard isDropTargeted || draggingRotatorId == rotatorId else { return nil }
        return dropFeedback(for: draggingRotatorId ?? rotatorId)
    }

    private func dropFeedback(for candidateRotatorId: String?) -> PlanningDropFeedback {
        PlanningDropValidator.validate(
            state: state,
            rotatorId: candidateRotatorId,
            date: cell.date,
            dropDisabled: dropDisabled,
            isPeek: isPeek,
            isEditable: cell.isEditable,
            expectedRowRotatorId: rotatorId,
            dragContext: dragContext
        )
    }

    private func rotatorId(from item: NSSecureCoding?) -> String? {
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
}

private struct PlanningMatrixTotalsFooter: View {
    let totals: [PlanningDayTotal]
    let metrics: PlanningMatrixMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            PlanningMatrixTotalRow(title: "Inpatient", totals: totals, keyPath: \.ip, color: .green, metrics: metrics)
            PlanningMatrixTotalRow(title: "Outpatient", totals: totals, keyPath: \.op, color: .blue, metrics: metrics)
            PlanningMatrixTotalRow(title: "Unassigned", totals: totals, keyPath: \.unassigned, color: .orange, metrics: metrics)
            if totals.contains(where: { $0.both > 0 }) {
                PlanningMatrixTotalRow(title: "Both", totals: totals, keyPath: \.both, color: .purple, metrics: metrics)
            }
        }
        .padding(.top, 4)
    }
}

private struct PlanningMatrixTotalRow: View {
    let title: String
    let totals: [PlanningDayTotal]
    let keyPath: KeyPath<PlanningDayTotal, Int>
    let color: Color
    let metrics: PlanningMatrixMetrics

    var body: some View {
        HStack(spacing: 1) {
            PlanningMatrixStickyLeading(width: PlanningMatrixLayout.rowHeaderWidth, height: 28) {
                Text(title)
                    .font(.caption.bold())
                    .foregroundStyle(color)
                    .padding(.leading, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .background(color.opacity(0.08))
                    .background(Color(nsColor: .controlBackgroundColor))
            }
            ForEach(totals) { total in
                let value = total[keyPath: keyPath]
                Text(value > 0 ? "\(value)" : "")
                    .font(.caption.bold())
                    .foregroundStyle(color)
                    .frame(width: metrics.cellWidth, height: 28)
                    .background(value > 0 ? color.opacity(0.12) : Color.secondary.opacity(0.03))
            }
        }
    }
}

private struct PlanningGridHeader: View {
    let displayMode: PlanningDisplayMode

    var body: some View {
        HStack(spacing: 12) {
            Text("Date").frame(width: 112, alignment: .leading)
            Text("Selected").frame(width: 92, alignment: .leading)
            Image(systemName: "paintbrush")
                .frame(width: 52, alignment: .leading)
                .help("Paint selected phase")
            if displayMode.showsInpatient {
                Text("Inpatient").frame(width: displayMode.inpatientWidth, alignment: .leading)
            }
            if displayMode.showsOutpatient {
                Text("Outpatient").frame(width: displayMode.outpatientWidth, alignment: .leading)
            }
            if displayMode.showsOff {
                Text("Off").frame(width: 120, alignment: .leading)
            }
        }
        .font(.caption.bold())
        .foregroundStyle(.secondary)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct PlanningDayRow: View {
    let date: String
    let state: SchedulerState
    let dayInpatient: [InpatientAssignment]
    let dayOutpatient: [OutpatientSession]
    let dayHalfDayFacts: [HalfDayFact]
    let rotatorLabels: [String: String]
    let displayMode: PlanningDisplayMode
    let selectedRotatorId: String
    let phase: RangePhase
    let focus: ScheduleFocus?
    let isPainting: Bool
    let isDropping: Bool
    let draggingRotatorId: String?
    let dragContext: PlanningDragContext?
    let removingAssignmentId: String?
    let actionsDisabled: Bool
    let dropDisabled: Bool
    let assignmentActionsDisabled: Bool
    let onPaintDay: (String) -> Void
    let onDropRotator: (String, String) -> Void
    let onInvalidDrop: (String) -> Void
    let onDeleteAssignment: (ChipData) -> Void
    @State private var isDropTargeted = false

    private var selectedRotator: Rotator? {
        state.rotator(selectedRotatorId)
    }

    private var isFocused: Bool {
        focus?.isFocusedDay(date, on: .planning) == true
    }

    private func rotatorLabel(_ id: String) -> String {
        rotatorLabels[id] ?? id
    }

    private var inpatient: [InpatientAssignment] {
        dayInpatient
            .filter { !$0.isOff }
            .sorted { rotatorLabel($0.rotatorId) < rotatorLabel($1.rotatorId) }
    }

    private var off: [InpatientAssignment] {
        dayInpatient
            .filter { $0.isOff }
            .sorted { rotatorLabel($0.rotatorId) < rotatorLabel($1.rotatorId) }
    }

    private var outpatient: [OutpatientSession] {
        dayOutpatient
            .sorted {
                let left = "\(rotatorLabel($0.rotatorId ?? ""))-\($0.period)"
                let right = "\(rotatorLabel($1.rotatorId ?? ""))-\($1.period)"
                return left < right
            }
    }

    private var representedHalfDayFactIds: Set<String> {
        var rotatorIds = Set<String>()
        if displayMode.showsInpatient {
            rotatorIds.formUnion(inpatient.map(\.rotatorId))
        }
        if displayMode.showsOff {
            rotatorIds.formUnion(off.map(\.rotatorId))
        }
        var ids = Set(dayHalfDayFacts.filter { rotatorIds.contains($0.rotatorId) }.map(\.id))
        if displayMode.showsOutpatient {
            for session in outpatient {
                ids.formUnion(outpatientFacts(for: session).map(\.id))
            }
        }
        return ids
    }

    private var unmatchedHalfDayFacts: [HalfDayFact] {
        state.halfDayFactsFor(date: date).filter { !representedHalfDayFactIds.contains($0.id) }
    }

    var body: some View {
        // Computed once per body: activeDropFeedback runs the drop validator, so
        // background/help sharing one result matters while a drag is hovering.
        let feedback = activeDropFeedback
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(CalendarUtil.dayLabel(date))
                        .font(.system(.body, design: .rounded)).bold()
                    Text(date)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 112, alignment: .leading)

                phasePill
                    .frame(width: 92, alignment: .leading)

                paintButton
                    .frame(width: 52, alignment: .leading)

                if displayMode.showsInpatient {
                    chipColumn(inpatient.map {
                        ChipData(
                            id: $0.id,
                            kind: .inpatient,
                            rotatorId: $0.rotatorId,
                            period: nil,
                            name: rotatorLabel($0.rotatorId),
                            detail: $0.role,
                            source: $0.source,
                            facts: state.halfDayFactsFor(date: date, rotatorId: $0.rotatorId)
                        )
                    })
                        .frame(width: displayMode.inpatientWidth, alignment: .leading)
                }

                if displayMode.showsOutpatient {
                    chipColumn(outpatient.map {
                        ChipData(
                            id: $0.id,
                            kind: .outpatient,
                            rotatorId: $0.rotatorId,
                            period: $0.period,
                            name: rotatorLabel($0.rotatorId ?? ""),
                            detail: $0.period,
                            source: $0.source,
                            facts: outpatientFacts(for: $0)
                        )
                    })
                        .frame(width: displayMode.outpatientWidth, alignment: .leading)
                }

                if displayMode.showsOff {
                    chipColumn(off.map {
                        ChipData(
                            id: $0.id,
                            kind: .inpatient,
                            rotatorId: $0.rotatorId,
                            period: nil,
                            name: rotatorLabel($0.rotatorId),
                            detail: nil,
                            source: $0.source,
                            facts: state.halfDayFactsFor(date: date, rotatorId: $0.rotatorId)
                        )
                    })
                        .frame(width: 120, alignment: .leading)
                }
            }

            if !unmatchedHalfDayFacts.isEmpty {
                HStack(alignment: .top, spacing: 12) {
                    Label("Half-day facts", systemImage: "circle.lefthalf.filled")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .frame(width: 112, alignment: .leading)
                    HalfDayFactBadges(
                        facts: unmatchedHalfDayFacts,
                        includeRotator: true,
                        rotatorLabel: rotatorLabel
                    )
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(rowBackground(feedback))
        .help(dropHelpText(feedback))
        .onDrop(of: [.plainText], isTargeted: $isDropTargeted) { providers in
            guard !dropDisabled, let provider = providers.first else { return false }
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                guard let droppedRotatorId = rotatorId(from: item) else { return }
                DispatchQueue.main.async {
                    let feedback = dropFeedback(for: droppedRotatorId)
                    guard feedback.isValid else {
                        onInvalidDrop(feedback.reason)
                        return
                    }
                    onDropRotator(droppedRotatorId, date)
                }
            }
            return true
        }
    }

    private func rowBackground(_ preview: PlanningDropFeedback?) -> Color {
        if let preview {
            return preview.isValid ? Color.green.opacity(isDropTargeted ? 0.16 : 0.06) : Color.red.opacity(isDropTargeted ? 0.16 : 0.06)
        }
        if isDropping {
            return Color.accentColor.opacity(0.08)
        }
        if isFocused {
            return Color.accentColor.opacity(0.12)
        }
        return CalendarUtil.isWeekend(date) ? Color.secondary.opacity(0.06) : Color.clear
    }

    private var activeDropFeedback: PlanningDropFeedback? {
        guard isDropTargeted || draggingRotatorId != nil else { return nil }
        return dropFeedback(for: draggingRotatorId)
    }

    private func dropHelpText(_ preview: PlanningDropFeedback?) -> String {
        guard let preview else { return "Drop a rotator to assign inpatient" }
        return "\(preview.isValid ? "Valid inpatient drop target" : "Invalid drop target") - \(preview.reason)"
    }

    private func dropFeedback(for candidateRotatorId: String?) -> PlanningDropFeedback {
        PlanningDropValidator.validate(
            state: state,
            rotatorId: candidateRotatorId,
            date: date,
            dropDisabled: dropDisabled,
            dragContext: dragContext
        )
    }

    private var phasePill: some View {
        let status = selectedStatus
        return HStack(spacing: 5) {
            Circle().fill(status.color).frame(width: 7, height: 7)
            Text(status.label).font(.caption.bold())
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(status.color.opacity(0.12), in: Capsule())
    }

    private var selectedStatus: (label: String, color: Color) {
        guard let selectedRotator else { return ("-", .secondary) }
        if !selectedRotator.isActive(on: date) { return ("Absent", .secondary) }
        if off.contains(where: { $0.rotatorId == selectedRotator.id }) { return ("Off", .orange) }
        if inpatient.contains(where: { $0.rotatorId == selectedRotator.id }) { return ("IP", .green) }
        if outpatient.contains(where: { $0.rotatorId == selectedRotator.id }) { return ("OP", .blue) }
        return ("Open", .secondary)
    }

    private var canPaint: Bool {
        guard let selectedRotator else { return false }
        return selectedRotator.isActive(on: date)
    }

    private var paintButton: some View {
        Button {
            onPaintDay(date)
        } label: {
            Group {
                if isPainting {
                    ProgressView()
                        .controlSize(.small)
                } else if isDropping {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: phase.systemImage)
                }
            }
            .frame(width: 26, height: 26)
        }
        .buttonStyle(.borderless)
        .help("Paint \(phase.title)")
        .disabled(actionsDisabled || !canPaint)
    }

    private func rotatorId(from item: NSSecureCoding?) -> String? {
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

    private func chipColumn(_ chips: [ChipData]) -> some View {
        Group {
            if chips.isEmpty {
                Text("-")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 3)
            } else {
                FlexibleWrap(spacing: 6) {
                    ForEach(chips) { chip in
                        PlanningChip(
                            chip: chip,
                            isFocused: chipMatchesFocus(chip),
                            isDeleting: removingAssignmentId == chip.id,
                            actionsDisabled: assignmentActionsDisabled
                        ) {
                            onDeleteAssignment(chip)
                        }
                    }
                }
            }
        }
    }

    private func outpatientFacts(for session: OutpatientSession) -> [HalfDayFact] {
        guard let rotatorId = session.rotatorId, !rotatorId.isEmpty else { return [] }
        return dayHalfDayFacts
            .filter { $0.rotatorId == rotatorId && $0.period == session.period }
            .sorted { $0.displayLabel < $1.displayLabel }
    }

    private func chipMatchesFocus(_ chip: ChipData) -> Bool {
        guard let focus,
              focus.target == .planning,
              focus.date == date
        else { return false }
        if focus.assignment == "inpatient" && chip.kind != .inpatient {
            return false
        }
        if focus.assignment == "outpatient" && chip.kind != .outpatient {
            return false
        }
        if let rotatorId = focus.rotatorId, chip.rotatorId != rotatorId {
            return false
        }
        if let period = focus.period, let chipPeriod = chip.period, chipPeriod != period {
            return false
        }
        return true
    }
}

private enum AssignmentKind {
    case inpatient
    case outpatient
}

private struct ChipData: Identifiable {
    let id: String
    let kind: AssignmentKind
    let rotatorId: String?
    let period: String?
    let name: String
    let detail: String?
    let source: String?
    let facts: [HalfDayFact]
}

private struct PlanningChip: View {
    let chip: ChipData
    let isFocused: Bool
    let isDeleting: Bool
    let actionsDisabled: Bool
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Circle().fill(Color.assignmentSource(chip.source)).frame(width: 7, height: 7)
                    .help(sourceLabel)
                    .accessibilityLabel("Source: \(sourceLabel)")
                Text(chip.name).font(.callout)
                if let detail = chip.detail, !detail.isEmpty, detail != "Resident" {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
            if !chip.facts.isEmpty {
                HalfDayFactBadges(facts: chip.facts)
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

    private var sourceLabel: String {
        chip.source ?? "Unknown source"
    }
}
