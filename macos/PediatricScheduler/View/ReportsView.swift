import SwiftUI
import Foundation

private let conflictScopeDate = "date"
private let conflictScopeAll = "all"

struct ReportsView: View {
    @EnvironmentObject var store: AppStore
    @State private var date = ""
    @State private var conflictScope = conflictScopeDate
    @State private var isGenerating = false
    @State private var isLoadingConflicts = false
    @State private var isExportingPackage = false
    @State private var isExportingPDFs = false
    @State private var isExportingWordDocs = false
    @State private var isExportingHandoffPacket = false
    @State private var isExportingCoordinatorBundle = false
    @State private var isFinalizing = false
    @State private var confirmingMarkFinal = false
    @State private var selectedExportFileName = ""
    @State private var acceptedExportReview = false
    @State private var reportsHandoffProbeStarted = false

    private var exportReviewFiles: [ExportReviewFile] {
        store.lastExportFileNames.map { ExportReviewFile(name: $0) }
    }

    private var exportReviewFingerprint: String {
        "\(store.lastExportFolderPath ?? "")|\(store.lastExportDescription ?? "")|\(store.lastExportFileNames.joined(separator: "|"))"
    }

    var body: some View {
        if let state = store.state, let block = state.activeBlock {
            HStack(spacing: 0) {
                controls(block: block, state: state)
                Divider()
                reportPane(block: block, state: state)
            }
            .onAppear {
                syncDate(block: block)
                runReportsHandoffProbeIfRequested(block: block)
            }
            .onChange(of: block.id) { _ in
                syncDate(block: block)
                runReportsHandoffProbeIfRequested(block: block)
            }
        } else {
            StatusView(icon: "doc.text.magnifyingglass", title: "No active block",
                       message: "Create or import a rotation block to generate reports.")
        }
    }

    private func controls(block: ServiceBlock, state: SchedulerState) -> some View {
        let dates = CalendarUtil.dateRange(block.startDate, block.endDate)
        let inpatientCount = state.inpatientAssignments.filter { $0.date == date && !$0.isOff }.count
        let outpatientCount = state.outpatientSessions.filter { $0.date == date }.count
        let halfDayCount = state.halfDayFactsFor(date: date).count
        let review = ReportsReviewSummary(
            state: state,
            block: block,
            conflicts: store.lastConflicts,
            allConflictsLoaded: store.lastConflictsQueryKey == AppStore.allConflictsQueryKey
                && store.lastConflictsBlockId == block.id
        )

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Reports").font(.title2).bold()
                    Label("\(block.startDate) to \(block.endDate)", systemImage: "calendar")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Picker("Date", selection: $date) {
                    ForEach(dates, id: \.self) { day in
                        Text(CalendarUtil.dayLabel(day)).tag(day)
                    }
                }

                Picker("Conflict Scope", selection: $conflictScope) {
                    Text("This Date").tag(conflictScopeDate)
                    Text("All Dates").tag(conflictScopeAll)
                }
                .pickerStyle(.segmented)

                VStack(alignment: .leading, spacing: 8) {
                    Label("\(inpatientCount) inpatient", systemImage: "bed.double")
                    Label("\(outpatientCount) outpatient", systemImage: "stethoscope")
                    Label("\(halfDayCount) half-day facts", systemImage: "circle.lefthalf.filled")
                }
                .font(.callout)
                .foregroundStyle(.secondary)

                Button {
                    generateReport()
                } label: {
                    if isGenerating {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Generating")
                        }
                    } else {
                        Label("Generate", systemImage: "doc.text.magnifyingglass")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isGenerating || date.isEmpty)

                Button {
                    loadConflicts()
                } label: {
                    if isLoadingConflicts {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Finding")
                        }
                    } else {
                        Label(conflictScope == conflictScopeAll ? "Find All Conflicts" : "Find Conflicts", systemImage: "exclamationmark.triangle")
                    }
                }
                .disabled(isLoadingConflicts || (conflictScope == conflictScopeDate && date.isEmpty))

                reviewFinalizePanel(review: review, block: block)

                Button {
                    exportHandoffPacket()
                } label: {
                    if isExportingHandoffPacket {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Building")
                        }
                    } else {
                        Label("Build Handoff Packet", systemImage: "archivebox")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!review.canBuildFinalPacket || isExportingHandoffPacket)

                Button {
                    exportPackage()
                } label: {
                    if isExportingPackage {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Exporting")
                        }
                    } else {
                        Label("Export Package", systemImage: "square.and.arrow.up")
                    }
                }
                .disabled(isExportingPackage)

                Button {
                    exportPDFs()
                } label: {
                    if isExportingPDFs {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Exporting")
                        }
                    } else {
                        Label("Export PDFs", systemImage: "doc.richtext")
                    }
                }
                .disabled(isExportingPDFs)

                Button {
                    exportWordDocs()
                } label: {
                    if isExportingWordDocs {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Exporting")
                        }
                    } else {
                        Label("Export Word", systemImage: "doc.text")
                    }
                }
                .disabled(isExportingWordDocs)

                exportReviewPanel()

                if let message = store.lastMessage, !message.isEmpty {
                    Label(message, systemImage: "info.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .help(message)
                        .textSelection(.enabled)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(width: 300, alignment: .topLeading)
    }

    private func reviewFinalizePanel(review: ReportsReviewSummary, block: ServiceBlock) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Review & Finalize", systemImage: "checkmark.seal")
                    .font(.callout.bold())
                Spacer(minLength: 0)
                Text(review.statusText)
                    .font(.caption.bold())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(review.statusColor.opacity(0.14), in: Capsule())
                    .foregroundStyle(review.statusColor)
            }

            VStack(alignment: .leading, spacing: 6) {
                FinalReviewLine(
                    title: review.allConflictsLoaded ? "\(review.criticalConflictCount) critical conflicts" : "Conflict review not loaded",
                    detail: review.allConflictsLoaded
                        ? "\(review.warningConflictCount) warning\(review.warningConflictCount == 1 ? "" : "s") also visible in Reports"
                        : "Load all-date conflicts before marking this block final.",
                    symbol: review.allConflictsLoaded ? "exclamationmark.triangle" : "arrow.clockwise",
                    color: review.allConflictsLoaded && review.criticalConflictCount == 0 ? .green : .orange
                )
                FinalReviewLine(
                    title: "\(review.openSlots) open inpatient slot\(review.openSlots == 1 ? "" : "s")",
                    detail: "\(review.staffedDays) of \(review.requiredDays) required day\(review.requiredDays == 1 ? "" : "s") fully staffed",
                    symbol: "bed.double",
                    color: review.openSlots == 0 ? .green : .orange
                )
                FinalReviewLine(
                    title: review.missingSourcePrograms.isEmpty
                        ? "Sources ready"
                        : "\(review.missingSourcePrograms.count) expected source\(review.missingSourcePrograms.count == 1 ? "" : "s") waiting",
                    detail: review.missingSourcePrograms.isEmpty
                        ? "Expected programs have reviewed sources or active roster data."
                        : review.missingSourcePrograms.joined(separator: ", "),
                    symbol: "tray.and.arrow.down",
                    color: review.missingSourcePrograms.isEmpty ? .green : .orange
                )
            }

            HStack(spacing: 8) {
                Button {
                    loadFinalReview()
                } label: {
                    if isLoadingConflicts && conflictScope == conflictScopeAll {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Reviewing")
                        }
                    } else {
                        Label("Load Review Checks", systemImage: "checklist")
                    }
                }
                .disabled(isLoadingConflicts)

                Button {
                    confirmingMarkFinal = true
                } label: {
                    if isFinalizing {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Finalizing")
                        }
                    } else {
                        Label("Mark Final", systemImage: "checkmark.seal")
                    }
                }
                .disabled(!review.canMarkFinal || isFinalizing)
                .help(review.canMarkFinal ? "Mark the block final." : "Run Load Review Checks and clear all blockers before marking final.")
                .confirmationDialog("Mark this block final?", isPresented: $confirmingMarkFinal) {
                    Button("Mark Final") {
                        markFinal(block: block, review: review)
                    }
                } message: {
                    Text("Finalizing records the review checks and stamps \(block.name) as Final.")
                }
            }

            if let finalizedAt = review.finalizedAt {
                Label("Finalized \(finalizedAt)", systemImage: "clock.badge.checkmark")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Button {
                exportHandoffPacket()
            } label: {
                if isExportingHandoffPacket {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Building")
                    }
                } else {
                    Label("Build Final Packet", systemImage: "archivebox")
                }
            }
            .disabled(!review.canBuildFinalPacket || isExportingHandoffPacket)
            .help(review.canBuildFinalPacket ? "Same export as \"Build Handoff Packet\" below." : "Mark the block final first.")

            Button {
                exportCoordinatorBundle()
            } label: {
                if isExportingCoordinatorBundle {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Building")
                    }
                } else {
                    Label("Download Final Schedules", systemImage: "arrow.down.doc")
                }
            }
            .disabled(!review.canBuildFinalPacket || isExportingCoordinatorBundle)
            .help(review.canBuildFinalPacket
                ? "Master, Inpatient, and Outpatient schedules in the send-out format, each as Word and PDF."
                : "Mark the block final first.")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func exportReviewPanel() -> some View {
        if let path = store.lastExportFolderPath, !path.isEmpty {
            let files = exportReviewFiles
            let summary = ExportReviewSummary(files: files)
            let selected = selectedExportFile(files: files)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Export Review", systemImage: "checklist")
                        .font(.callout.bold())
                    Spacer(minLength: 0)
                    Text(acceptedExportReview ? "Accepted" : summary.statusText)
                        .font(.caption.bold())
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(summary.statusColor.opacity(0.14), in: Capsule())
                        .foregroundStyle(summary.statusColor)
                }
                if let description = store.lastExportDescription, !description.isEmpty {
                    Label(description, systemImage: "archivebox")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(path)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)

                VStack(alignment: .leading, spacing: 4) {
                    ExportReviewLine(title: "Package", value: "\(summary.packageCount)", symbol: "shippingbox")
                    ExportReviewLine(title: "PDF", value: "\(summary.pdfCount)", symbol: "doc.richtext")
                    ExportReviewLine(title: "Word", value: "\(summary.wordCount)", symbol: "doc.text")
                    ExportReviewLine(title: "CSV", value: "\(summary.csvCount)", symbol: "tablecells")
                }

                if !files.isEmpty {
                    Picker("Review File", selection: $selectedExportFileName) {
                        ForEach(files) { file in
                            Text(file.name).tag(file.name)
                        }
                    }
                    .pickerStyle(.menu)

                    if let selected {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: selected.kind.systemImage)
                                .foregroundStyle(selected.kind.color)
                                .frame(width: 16)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(selected.displayName)
                                    .font(.caption.bold())
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Text(selected.name)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                    .truncationMode(.middle)
                            }
                            Spacer(minLength: 0)
                            Text(selected.kind.rawValue)
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Button {
                            if let selected {
                                store.revealLastExportFile(named: selected.name)
                            }
                        } label: {
                            Label("Show File", systemImage: "doc.viewfinder")
                        }
                        .disabled(selected == nil)

                        Button {
                            store.revealLastExportFolder()
                        } label: {
                            Label("Show in Finder", systemImage: "arrow.up.forward.app")
                        }
                    }
                    Button {
                        store.copyLastExportPath()
                    } label: {
                        Label("Copy Path", systemImage: "doc.on.doc")
                    }
                }

                Button {
                    acceptExportReview(summary: summary)
                } label: {
                    Label(acceptedExportReview ? "Accepted" : "Accept Handoff", systemImage: acceptedExportReview ? "checkmark.seal.fill" : "checkmark.seal")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!summary.isHandoffReady || acceptedExportReview)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .onAppear {
                ensureExportReviewSelection(files: files)
            }
        }
    }

    private func reportPane(block: ServiceBlock, state: SchedulerState) -> some View {
        let reportDate = date.isEmpty ? block.startDate : date
        let halfDayFacts = state.halfDayFactsFor(date: reportDate)
        let reportText = store.lastReportDate == reportDate && store.lastReportBlockId == block.id
            ? store.lastReport
            : nil
        let conflictQueryKey = conflictScope == conflictScopeAll ? AppStore.allConflictsQueryKey : reportDate
        let conflictsLoadedForScope = store.lastConflictsQueryKey == conflictQueryKey
            && store.lastConflictsBlockId == block.id
        let visibleConflicts = conflictsLoadedForScope ? store.lastConflicts : []
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(CalendarUtil.dayLabel(reportDate))
                        .font(.title3)
                        .bold()
                    Text(reportDate)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding()

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(reportText ?? "No report generated for this date.")
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)

                    if let postFinalChanges = block.postFinalChanges, !postFinalChanges.isEmpty {
                        Divider()

                        PostFinalChangesReportSection(changes: postFinalChanges)
                    }

                    Divider()

                    HalfDayFactsReportSection(
                        facts: halfDayFacts,
                        rotatorLabel: state.rotatorLabel
                    )

                    Divider()

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label(conflictScope == conflictScopeAll ? "Conflicts - All Dates" : "Conflicts", systemImage: "exclamationmark.triangle")
                                .font(.headline)
                            Spacer()
                            Text("\(visibleConflicts.count)")
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        if !conflictsLoadedForScope {
                            Text(conflictScope == conflictScopeAll ? "Use Find All Conflicts to scan the whole block." : "Use Find Conflicts to check this date.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        } else if visibleConflicts.isEmpty {
                            Text(conflictScope == conflictScopeAll ? "No conflicts found." : "No conflicts found for this date.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(visibleConflicts) { conflict in
                                ConflictRow(
                                    conflict: conflict,
                                    isFocused: store.scheduleFocus?.conflictId == conflict.id
                                ) {
                                    store.focus(conflict)
                                }
                                if conflict.id != visibleConflicts.last?.id {
                                    Divider()
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .padding()
            }
            .background(Color.secondary.opacity(0.03))
        }
    }

    private func syncDate(block: ServiceBlock) {
        if date.isEmpty || date < block.startDate || date > block.endDate {
            date = block.startDate
        }
    }

    private func generateReport() {
        guard !isGenerating, !date.isEmpty else { return }
        isGenerating = true
        Task {
            await store.run("report.daily", input: ["date": date])
            isGenerating = false
        }
    }

    private func loadConflicts() {
        guard !isLoadingConflicts, conflictScope == conflictScopeAll || !date.isEmpty else { return }
        isLoadingConflicts = true
        Task {
            await store.loadConflicts(date: conflictScope == conflictScopeAll ? nil : date)
            isLoadingConflicts = false
        }
    }

    private func loadFinalReview() {
        guard !isLoadingConflicts else { return }
        conflictScope = conflictScopeAll
        isLoadingConflicts = true
        Task {
            await store.loadConflicts(date: nil)
            isLoadingConflicts = false
        }
    }

    private func markFinal(block: ServiceBlock, review: ReportsReviewSummary) {
        guard !isFinalizing else { return }
        isFinalizing = true
        Task {
            let finalizedAt = ISO8601DateFormatter().string(from: Date())
            await store.run("block.update", input: [
                "blockRef": block.id,
                "patch": [
                    "status": "Final",
                    "finalizedAt": finalizedAt,
                    "finalizedBy": "Native Reports Review & Finalize",
                    "finalReview": [
                        "reviewedAt": finalizedAt,
                        "criticalConflictCount": review.criticalConflictCount,
                        "warningConflictCount": review.warningConflictCount,
                        "openSlots": review.openSlots,
                        "missingSourcePrograms": review.missingSourcePrograms,
                        "reason": "Reports Review & Finalize checks passed"
                    ]
                ]
            ])
            isFinalizing = false
        }
    }

    private func exportHandoffPacket() {
        guard !isExportingHandoffPacket else { return }
        isExportingHandoffPacket = true
        Task {
            let previousExport = exportReviewFingerprint
            await store.exportHandoffPacket()
            prepareExportReview(previousFingerprint: previousExport)
            isExportingHandoffPacket = false
        }
    }

    private func exportCoordinatorBundle() {
        guard !isExportingCoordinatorBundle else { return }
        isExportingCoordinatorBundle = true
        Task {
            let previousExport = exportReviewFingerprint
            await store.exportCoordinatorBundle()
            prepareExportReview(previousFingerprint: previousExport)
            isExportingCoordinatorBundle = false
        }
    }

    private func exportPackage() {
        guard !isExportingPackage else { return }
        isExportingPackage = true
        Task {
            let previousExport = exportReviewFingerprint
            await store.exportPackage()
            prepareExportReview(previousFingerprint: previousExport)
            isExportingPackage = false
        }
    }

    private func exportPDFs() {
        guard !isExportingPDFs else { return }
        isExportingPDFs = true
        Task {
            let previousExport = exportReviewFingerprint
            await store.exportPDFs()
            prepareExportReview(previousFingerprint: previousExport)
            isExportingPDFs = false
        }
    }

    private func exportWordDocs() {
        guard !isExportingWordDocs else { return }
        isExportingWordDocs = true
        Task {
            let previousExport = exportReviewFingerprint
            await store.exportWordDocs()
            prepareExportReview(previousFingerprint: previousExport)
            isExportingWordDocs = false
        }
    }

    private func selectedExportFile(files: [ExportReviewFile]) -> ExportReviewFile? {
        files.first { $0.name == selectedExportFileName } ?? files.first
    }

    private func ensureExportReviewSelection(files: [ExportReviewFile]) {
        guard !files.isEmpty else {
            selectedExportFileName = ""
            acceptedExportReview = false
            return
        }
        if !files.contains(where: { $0.name == selectedExportFileName }) {
            selectedExportFileName = files[0].name
            acceptedExportReview = false
        }
    }

    private func prepareExportReview(previousFingerprint: String) {
        guard exportReviewFingerprint != previousFingerprint else { return }
        selectedExportFileName = store.lastExportFileNames.first ?? ""
        acceptedExportReview = false
    }

    private func acceptExportReview(summary: ExportReviewSummary) {
        guard summary.isHandoffReady else { return }
        acceptedExportReview = true
    }

    private func runReportsHandoffProbeIfRequested(block: ServiceBlock) {
        guard ReportsHandoffProbe.isRequested, !reportsHandoffProbeStarted else { return }
        reportsHandoffProbeStarted = true
        Task {
            await runReportsHandoffProbe(blockId: block.id)
        }
    }

    private func runReportsHandoffProbe(blockId: String) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())

        func writeFailure(_ message: String) {
            ReportsHandoffProbe.write([
                "ok": false,
                "screen": "Reports",
                "blockId": blockId,
                "startedAt": startedAt,
                "message": message,
                "lastMessage": store.lastMessage ?? ""
            ])
        }

        await store.loadConflicts(date: nil)
        guard let state = store.state,
              let block = state.serviceBlocks.first(where: { $0.id == blockId }) ?? state.activeBlock
        else {
            writeFailure("Active block was not available after loading conflicts.")
            return
        }

        var review = ReportsReviewSummary(
            state: state,
            block: block,
            conflicts: store.lastConflicts,
            allConflictsLoaded: store.lastConflictsQueryKey == AppStore.allConflictsQueryKey
                && store.lastConflictsBlockId == block.id
        )
        if review.canMarkFinal {
            let finalizedAt = ISO8601DateFormatter().string(from: Date())
            let ok = await store.run("block.update", input: [
                "blockRef": block.id,
                "patch": [
                    "status": "Final",
                    "finalizedAt": finalizedAt,
                    "finalizedBy": "Native Reports Review & Finalize",
                    "finalReview": [
                        "reviewedAt": finalizedAt,
                        "criticalConflictCount": review.criticalConflictCount,
                        "warningConflictCount": review.warningConflictCount,
                        "openSlots": review.openSlots,
                        "missingSourcePrograms": review.missingSourcePrograms,
                        "reason": "Reports Review & Finalize checks passed"
                    ]
                ]
            ])
            guard ok else {
                writeFailure("Reports finalization command failed.")
                return
            }
        } else if !review.isFinal {
            writeFailure("Reports review was not ready to mark final.")
            return
        }

        await store.loadConflicts(date: nil)
        guard let finalState = store.state,
              let finalBlock = finalState.serviceBlocks.first(where: { $0.id == blockId }) ?? finalState.activeBlock
        else {
            writeFailure("Final block was not available after finalization.")
            return
        }
        review = ReportsReviewSummary(
            state: finalState,
            block: finalBlock,
            conflicts: store.lastConflicts,
            allConflictsLoaded: store.lastConflictsQueryKey == AppStore.allConflictsQueryKey
                && store.lastConflictsBlockId == finalBlock.id
        )
        guard review.canBuildFinalPacket else {
            writeFailure("Final handoff packet was still blocked after review.")
            return
        }

        let previousExport = exportReviewFingerprint
        await store.exportHandoffPacket()
        prepareExportReview(previousFingerprint: previousExport)
        let folderPath = store.lastExportFolderPath ?? ""
        let fileNames = store.lastExportFileNames
        let folderURL = URL(fileURLWithPath: folderPath, isDirectory: true)
        let existingFiles = fileNames.filter {
            FileManager.default.fileExists(atPath: folderURL.appendingPathComponent($0).path)
        }
        let hasPackage = ["manifest.json", "roster.csv", "inpatient-calendar.csv", "conflicts.csv", "schedule-package.json"]
            .allSatisfy { fileNames.contains($0) }
        let hasPDFs = fileNames.contains { $0.hasPrefix("PDFs/") && $0.hasSuffix(".pdf") }
        let hasWordDocs = fileNames.contains { $0.hasPrefix("Word/") && $0.hasSuffix(".docx") }
        let exportReviewSummary = ExportReviewSummary(files: fileNames.map { ExportReviewFile(name: $0) })
        acceptExportReview(summary: exportReviewSummary)
        let exportReviewAccepted = acceptedExportReview
        ReportsHandoffProbe.write([
            "ok": !folderPath.isEmpty
                && existingFiles.count == fileNames.count
                && hasPackage
                && hasPDFs
                && hasWordDocs
                && exportReviewSummary.isHandoffReady
                && exportReviewAccepted,
            "screen": "Reports",
            "blockId": finalBlock.id,
            "blockName": finalBlock.name,
            "status": finalBlock.status ?? "",
            "finalizedAt": finalBlock.finalizedAt ?? "",
            "finalizedBy": finalBlock.finalizedBy ?? "",
            "allConflictsLoaded": review.allConflictsLoaded,
            "criticalConflictCount": review.criticalConflictCount,
            "warningConflictCount": review.warningConflictCount,
            "openSlots": review.openSlots,
            "missingSourcePrograms": review.missingSourcePrograms,
            "canBuildFinalPacket": review.canBuildFinalPacket,
            "exportDescription": store.lastExportDescription ?? "",
            "exportFolderPath": folderPath,
            "fileNames": fileNames,
            "existingFileCount": existingFiles.count,
            "hasPackage": hasPackage,
            "hasPDFs": hasPDFs,
            "hasWordDocs": hasWordDocs,
            "exportReviewReady": exportReviewSummary.isHandoffReady,
            "exportReviewAccepted": exportReviewAccepted,
            "exportReviewFileCount": exportReviewSummary.fileCount,
            "exportReviewPackageCount": exportReviewSummary.packageCount,
            "exportReviewPDFCount": exportReviewSummary.pdfCount,
            "exportReviewWordCount": exportReviewSummary.wordCount,
            "exportReviewCSVCount": exportReviewSummary.csvCount,
            "exportReviewSelectedFile": fileNames.first ?? "",
            "startedAt": startedAt,
            "finishedAt": ISO8601DateFormatter().string(from: Date()),
            "lastMessage": store.lastMessage ?? ""
        ])
    }
}

private enum ReportsHandoffProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_REPORTS_HANDOFF_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-reports-handoff.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Reports handoff probe: \(error.localizedDescription)")
        }
    }
}

private struct PostFinalChangesReportSection: View {
    let changes: [PostFinalChange]

    private var recentChanges: [PostFinalChange] {
        Array(changes.suffix(5).reversed())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Post-Final Changes", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                    .font(.headline)
                Spacer()
                Text("\(changes.count)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("reports-post-final-changes-count")
            }
            ForEach(recentChanges) { change in
                VStack(alignment: .leading, spacing: 4) {
                    Text(change.displayReason)
                        .font(.callout.bold())
                        .lineLimit(2)
                        .accessibilityIdentifier("reports-post-final-change-reason-\(change.id)")
                    if !change.displayMetadata.isEmpty {
                        Text(change.displayMetadata)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    if let summary = change.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !summary.isEmpty {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .accessibilityIdentifier("reports-post-final-change-row-\(change.id)")
            }
        }
        .accessibilityIdentifier("reports-post-final-changes-section")
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct HalfDayFactsReportSection: View {
    let facts: [HalfDayFact]
    let rotatorLabel: (String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Half-Day Facts", systemImage: "circle.lefthalf.filled")
                    .font(.headline)
                Spacer()
                Text("\(facts.count)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if facts.isEmpty {
                Text("No half-day facts for this date.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(facts) { fact in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(rotatorLabel(fact.rotatorId))
                                    .font(.callout.bold())
                                HalfDayFactBadges(facts: [fact])
                            }
                            Text(fact.sourceLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct FinalReviewLine: View {
    let title: String
    let detail: String
    let symbol: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.bold())
                    .lineLimit(2)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct ExportReviewLine: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        HStack(spacing: 6) {
            Label(title, systemImage: symbol)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text(value)
                .font(.caption.monospacedDigit().bold())
        }
    }
}

private enum ExportReviewKind: String {
    case package = "Package"
    case pdf = "PDF"
    case word = "Word"
    case csv = "CSV"
    case json = "JSON"
    case text = "Text"
    case file = "File"

    var systemImage: String {
        switch self {
        case .package: return "shippingbox"
        case .pdf: return "doc.richtext"
        case .word: return "doc.text"
        case .csv: return "tablecells"
        case .json: return "curlybraces"
        case .text: return "doc.plaintext"
        case .file: return "doc"
        }
    }

    var color: Color {
        switch self {
        case .package: return .blue
        case .pdf: return .red
        case .word: return .indigo
        case .csv: return .green
        case .json: return .purple
        case .text: return .orange
        case .file: return .secondary
        }
    }
}

private struct ExportReviewFile: Identifiable {
    let name: String

    var id: String { name }

    var displayName: String {
        name.split(separator: "/").last.map(String.init) ?? name
    }

    var isRootPackageFile: Bool {
        !name.contains("/")
    }

    var kind: ExportReviewKind {
        if name.hasPrefix("PDFs/") || name.lowercased().hasSuffix(".pdf") { return .pdf }
        if name.hasPrefix("Word/") || name.lowercased().hasSuffix(".docx") { return .word }
        if name.lowercased().hasSuffix(".csv") { return .csv }
        if name.lowercased().hasSuffix(".json") { return isRootPackageFile ? .package : .json }
        if name.lowercased().hasSuffix(".txt") { return isRootPackageFile ? .package : .text }
        return isRootPackageFile ? .package : .file
    }
}

private struct ExportReviewSummary {
    let fileCount: Int
    let packageCount: Int
    let pdfCount: Int
    let wordCount: Int
    let csvCount: Int
    let hasManifest: Bool
    let hasSchedulePackage: Bool

    init(files: [ExportReviewFile]) {
        fileCount = files.count
        packageCount = files.filter(\.isRootPackageFile).count
        pdfCount = files.filter { $0.kind == .pdf }.count
        wordCount = files.filter { $0.kind == .word }.count
        csvCount = files.filter { $0.kind == .csv }.count
        hasManifest = files.contains { $0.name == "manifest.json" }
        hasSchedulePackage = files.contains { $0.name == "schedule-package.json" }
    }

    var isHandoffReady: Bool {
        hasManifest && hasSchedulePackage && pdfCount > 0 && wordCount > 0 && csvCount > 0
    }

    var statusText: String {
        if isHandoffReady { return "Ready" }
        if fileCount > 0 { return "Partial" }
        return "Empty"
    }

    var statusColor: Color {
        if isHandoffReady { return .green }
        if fileCount > 0 { return .orange }
        return .secondary
    }
}

private struct ReportsReviewSummary {
    let allConflictsLoaded: Bool
    let criticalConflictCount: Int
    let warningConflictCount: Int
    let requiredDays: Int
    let staffedDays: Int
    let openSlots: Int
    let missingSourcePrograms: [String]
    let isFinal: Bool
    let finalizedAt: String?

    init(
        state: SchedulerState,
        block: ServiceBlock,
        conflicts: [ConflictSummary],
        allConflictsLoaded: Bool
    ) {
        self.allConflictsLoaded = allConflictsLoaded
        let blockDates = CalendarUtil.dateRange(block.startDate, block.endDate)
        let dateSet = Set(blockDates)
        let scopedConflicts = allConflictsLoaded
            ? conflicts.filter { $0.date.isEmpty || dateSet.contains($0.date) }
            : []
        criticalConflictCount = scopedConflicts.filter {
            $0.severity.localizedCaseInsensitiveContains("critical")
        }.count
        warningConflictCount = scopedConflicts.count - criticalConflictCount

        let inpatientByDate = Dictionary(
            grouping: state.inpatientAssignments.filter { !$0.isOff },
            by: \.date
        )
        var required = 0
        var staffed = 0
        var open = 0
        for day in blockDates {
            let target = block.inpatientCoverageTarget(on: day)
            let count = inpatientByDate[day]?.count ?? 0
            if target > 0 {
                required += 1
            }
            if target > 0 && count >= target {
                staffed += 1
            }
            open += max(0, target - count)
        }
        requiredDays = required
        staffedDays = staffed
        openSlots = open
        missingSourcePrograms = Self.missingSourcePrograms(state: state, dates: blockDates)
        isFinal = (block.status ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare("Final") == .orderedSame
        finalizedAt = block.finalizedAt
    }

    var blockerCount: Int {
        (allConflictsLoaded ? criticalConflictCount : 1) + openSlots + missingSourcePrograms.count
    }

    var canMarkFinal: Bool {
        !isFinal && allConflictsLoaded && blockerCount == 0
    }

    var canBuildFinalPacket: Bool {
        isFinal && allConflictsLoaded && blockerCount == 0
    }

    var statusText: String {
        if canBuildFinalPacket { return "Final" }
        if isFinal && !allConflictsLoaded { return "Review needed" }
        if isFinal { return "\(blockerCount) blocker\(blockerCount == 1 ? "" : "s")" }
        if !allConflictsLoaded { return "Review needed" }
        if canMarkFinal { return "Ready" }
        return "\(blockerCount) blocker\(blockerCount == 1 ? "" : "s")"
    }

    var statusColor: Color {
        if canBuildFinalPacket { return .green }
        if isFinal { return .orange }
        if canMarkFinal { return .blue }
        return .orange
    }

    private static func missingSourcePrograms(state: SchedulerState, dates: [String]) -> [String] {
        let expected = uniquePrograms(state.expectedSourcePrograms ?? [])
        guard !expected.isEmpty else { return [] }
        let reviewedKeys = Set((state.sources ?? []).filter(\.isReviewed).map { programKey($0.program) })
        let activeKeys = Set(
            state.rotators
                .filter { rotator in dates.contains { rotator.isActive(on: $0) } }
                .compactMap(\.program)
                .map(programKey)
        )
        return expected.filter { program in
            let key = programKey(program)
            return !reviewedKeys.contains(key) && !activeKeys.contains(key)
        }
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

private struct ConflictRow: View {
    let conflict: ConflictSummary
    let isFocused: Bool
    let onFocus: () -> Void

    var body: some View {
        Button(action: onFocus) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: conflict.severity == "Critical" ? "exclamationmark.triangle.fill" : "info.circle.fill")
                    .foregroundStyle(conflict.severity == "Critical" ? .orange : .blue)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(conflict.title)
                            .font(.callout.bold())
                            .lineLimit(2)
                        if !conflict.date.isEmpty {
                            Text(conflict.date)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    if !conflict.detail.isEmpty {
                        Text(conflict.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
                Spacer(minLength: 0)
                Label(conflict.targetLabel, systemImage: "arrow.right.circle")
                    .font(.caption)
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(isFocused ? Color.accentColor : .secondary)
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .background(isFocused ? Color.accentColor.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Review in \(conflict.targetLabel)")
    }
}
