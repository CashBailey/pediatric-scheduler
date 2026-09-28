import SwiftUI
import UniformTypeIdentifiers

struct SourcesView: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedSourceId: String?
    @State private var isImporting = false
    @State private var rosterImportMode: RosterImportMode = .merge
    @State private var pendingRosterImport: RosterImportResult?
    @State private var isApplyingRosterImport = false
    @State private var pendingCoordinatorImport: CoordinatorImportResult?
    @State private var isApplyingCoordinatorImport = false
    // Rendered inside the review sheets; store.lastMessage is occluded while
    // a sheet is up, so commit failures need their own surface.
    @State private var importApplyErrorMessage: String?
    @State private var deletingSourceId: String?
    @State private var sourceToDeleteId: String?
    @State private var manualSourceProgram = "Other"
    @State private var manualSourceName = "Manual source"
    @State private var manualSourceContent = ""
    @State private var isAddingManualSource = false
    @State private var sourcesImportProbeStarted = false

    var body: some View {
        if let state = store.state {
            HStack(spacing: 0) {
                sourceList(state: state)
                Divider()
                detailPane(state: state)
            }
            .onAppear {
                syncSelection(state: state)
                runSourcesImportProbeIfRequested(state: state)
            }
            .onChange(of: sourceIds(state)) { _ in syncSelection(state: state) }
            .confirmationDialog("Delete source record?", isPresented: deleteConfirmationBinding) {
                Button("Delete Source", role: .destructive) {
                    if let source = sourceToDelete(state: state) {
                        deleteSource(source)
                    }
                }
                Button("Cancel", role: .cancel) {
                    sourceToDeleteId = nil
                }
            }
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
        } else {
            StatusView(icon: "tray.and.arrow.down", title: "No roster loaded",
                       message: "The backend is ready, but no scheduler state was returned.")
        }
    }

    private func sourceList(state: SchedulerState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Sources").font(.title2).bold()
                Spacer()
                Button {
                    chooseRosterFile()
                } label: {
                    if isImporting {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "person.crop.rectangle.stack")
                    }
                }
                .help("Import roster file")
                .disabled(isImporting)

                Button {
                    chooseCoordinatorBundle()
                } label: {
                    Image(systemName: "folder")
                }
                .help("Import DOCX files")
                .disabled(isImporting)
            }
            .padding()

            Picker("Roster import mode", selection: $rosterImportMode) {
                ForEach(RosterImportMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .padding(.horizontal)
            .padding(.bottom, 10)

            Divider()

            manualSourceComposer

            Divider()

            if sources(state).isEmpty {
                StatusView(icon: "tray", title: "No reviewed sources",
                           message: "No source records found.")
            } else {
                List(selection: $selectedSourceId) {
                    ForEach(sources(state)) { source in
                        SourceListRow(source: source)
                            .tag(Optional(source.id))
                    }
                }
            }
        }
        .frame(width: 320)
    }

    @ViewBuilder
    private func detailPane(state: SchedulerState) -> some View {
        // The lastMessage banner lives OUTSIDE the selected-source branch:
        // import failures must be visible on a fresh install where nothing
        // is selected yet.
        VStack(spacing: 0) {
            detailPaneContent(state: state)
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
    }

    @ViewBuilder
    private func detailPaneContent(state: SchedulerState) -> some View {
        if let source = selectedSource(state: state) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(source.displayName)
                            .font(.title2)
                            .bold()
                            .lineLimit(2)
                            .truncationMode(.middle)
                            .help(source.displayName)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: 6) {
                            Label(source.program ?? "Other", systemImage: "tag")
                            Label(source.typeLabel, systemImage: "doc")
                            if let importedAt = source.importedAt {
                                Label(importedAt, systemImage: "calendar")
                            }
                        }
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 8) {
                        Button {
                            chooseRosterFile(replacing: source)
                        } label: {
                            Label("Replace", systemImage: "doc.badge.arrow.up")
                        }
                        .disabled(deletingSourceId != nil || isImporting)

                        Button(role: .destructive) {
                            sourceToDeleteId = source.id
                        } label: {
                            if deletingSourceId == source.id {
                                HStack(spacing: 7) {
                                    ProgressView().controlSize(.small)
                                    Text("Deleting")
                                }
                            } else {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .disabled(deletingSourceId != nil || isImporting)

                        Spacer(minLength: 0)
                    }
                }
                .padding()

                Divider()

                sourceWarnings(source)

                sourcePreview(source)
            }
        } else {
            StatusView(icon: "tray.and.arrow.down", title: "Select a source",
                       message: "No source selected.")
        }
    }

    @ViewBuilder
    private func sourceWarnings(_ source: SourceRecord) -> some View {
        if source.warningCount > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Label("\(source.warningCount) import warning\(source.warningCount == 1 ? "" : "s")", systemImage: "exclamationmark.triangle")
                    .font(.callout.bold())
                    .foregroundStyle(.orange)

                ForEach(Array(source.importWarnings.prefix(5)), id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                if source.importWarnings.count > 5 {
                    Text("\(source.importWarnings.count - 5) more warning\(source.importWarnings.count == 6 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()
        }
    }

    @ViewBuilder
    private func sourcePreview(_ source: SourceRecord) -> some View {
        if !source.parsedRows.isEmpty {
            SourceRowsPreview(source: source)
        } else if let content = source.content, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ScrollView {
                Text(content)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding()
            }
            .background(Color.secondary.opacity(0.03))
        } else {
            StatusView(icon: "doc.text", title: "No preview rows",
                       message: "No row or text preview stored.")
        }
    }

    private func sources(_ state: SchedulerState) -> [SourceRecord] {
        (state.sources ?? []).sorted {
            ($0.importedAt ?? "") == ($1.importedAt ?? "")
                ? $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
                : ($0.importedAt ?? "") > ($1.importedAt ?? "")
        }
    }

    private func sourceIds(_ state: SchedulerState) -> [String] {
        sources(state).map(\.id)
    }

    private func selectedSource(state: SchedulerState) -> SourceRecord? {
        sources(state).first { $0.id == selectedSourceId }
    }

    private func sourceToDelete(state: SchedulerState) -> SourceRecord? {
        sources(state).first { $0.id == sourceToDeleteId }
    }

    private func syncSelection(state: SchedulerState) {
        let allSources = sources(state)
        if selectedSourceId == nil || !allSources.contains(where: { $0.id == selectedSourceId }) {
            selectedSourceId = allSources.first?.id
        }
    }

    private var deleteConfirmationBinding: Binding<Bool> {
        Binding(
            get: { sourceToDeleteId != nil },
            set: { value in
                if !value {
                    sourceToDeleteId = nil
                }
            }
        )
    }

    private var manualSourceComposer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Program", text: $manualSourceProgram)
                .textFieldStyle(.roundedBorder)
            TextField("Source name", text: $manualSourceName)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $manualSourceContent)
                .font(.callout)
                .frame(minHeight: 64, maxHeight: 90)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
                )
            Button {
                addManualSource()
            } label: {
                if isAddingManualSource {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Adding")
                    }
                } else {
                    Label("Add Note", systemImage: "note.text.badge.plus")
                }
            }
            .disabled(isAddingManualSource || manualSourceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private func addManualSource() {
        guard !isAddingManualSource else { return }
        let fileName = manualSourceName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fileName.isEmpty else { return }
        let program = manualSourceProgram.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = manualSourceContent.trimmingCharacters(in: .whitespacesAndNewlines)
        isAddingManualSource = true
        Task {
            let ok = await store.run(
                "source.add",
                input: [
                    "program": program.isEmpty ? "Other" : program,
                    "fileName": fileName,
                    "fileType": "manual",
                    "content": content,
                    "parsedRows": [],
                ]
            )
            // Keep the typed note intact when the add fails — resetting the
            // fields would destroy it with no way to recover.
            if ok {
                if let state = store.state {
                    selectedSourceId = sources(state).first?.id
                }
                manualSourceName = "Manual source"
                manualSourceContent = ""
            }
            isAddingManualSource = false
        }
    }

    private func deleteSource(_ source: SourceRecord) {
        guard deletingSourceId == nil else { return }
        deletingSourceId = source.id
        Task {
            await store.run("source.delete", input: ["sourceId": source.id])
            if let state = store.state {
                syncSelection(state: state)
            }
            deletingSourceId = nil
            sourceToDeleteId = nil
        }
    }

    private func chooseRosterFile(replacing source: SourceRecord? = nil) {
        guard !isImporting else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = sourceRosterContentTypes
        panel.prompt = source == nil ? "Import" : "Replace"
        panel.message = source == nil
            ? "Choose a template roster or week-grid Excel roster to import."
            : "Choose a replacement template or week-grid Excel roster for \(source?.displayName ?? "this source")."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isImporting = true
        Task {
            do {
                importApplyErrorMessage = nil
                pendingRosterImport = try await store.previewRosterFile(
                    url,
                    mode: rosterImportMode,
                    replaceSourceId: source?.id
                )
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
                if let state = store.state {
                    selectedSourceId = result.replaceSourceId ?? sources(state).first?.id
                }
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

    private func importCoordinatorBundle(urls: [URL]) {
        guard !isImporting else { return }
        guard let bundle = SourcesCoordinatorBundleSelection(urls: urls) else {
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
                if let state = store.state {
                    selectedSourceId = sources(state).first?.id
                }
            } else {
                importApplyErrorMessage = store.lastMessage ?? "The import could not be applied."
            }
            isApplyingCoordinatorImport = false
        }
    }

    private func runSourcesImportProbeIfRequested(state: SchedulerState) {
        guard SourcesImportProbe.isRequested, !sourcesImportProbeStarted else { return }
        sourcesImportProbeStarted = true
        Task {
            await runSourcesImportProbe(initialState: state)
        }
    }

    private func runSourcesImportProbe(initialState: SchedulerState) async {
        let startedAt = ISO8601DateFormatter().string(from: Date())
        let directory = AppSupport.dataDirectory()
        let csvURL = directory.appendingPathComponent("native-source-import-audit.csv")
        let expectedNames = ["Blake Lee", "Casey Morgan"]
        let initialSourceCount = initialState.sources?.count ?? 0
        let initialRotatorCount = initialState.rotators.count

        func writeFailure(_ message: String) {
            SourcesImportProbe.write([
                "ok": false,
                "screen": "Sources",
                "blockId": initialState.activeBlockId,
                "message": message,
                "sourceFile": csvURL.path,
                "initialSourceCount": initialSourceCount,
                "initialRotatorCount": initialRotatorCount,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        }

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try """
            Name,Program,Level,Start,End
            Blake Lee,UT Pediatrics,PGY-3,2026-09-14,2026-09-18
            Casey Morgan,UT Pediatrics,PGY-2,2026-09-14,2026-09-18

            """.write(to: csvURL, atomically: true, encoding: .utf8)

            let preview = try await store.previewRosterFile(csvURL, mode: .merge)
            let committed = await store.commitRosterImportResult(preview)
            guard committed, let state = store.state else {
                writeFailure("Sources import commit failed.")
                return
            }

            let importedSource = (state.sources ?? []).first { $0.fileName == csvURL.lastPathComponent }
                ?? sources(state).first
            selectedSourceId = importedSource?.id
            let importedNames = state.rotators
                .map(\.label)
                .filter { expectedNames.contains($0) }
                .sorted()

            SourcesImportProbe.write([
                "ok": state.activeBlockId == initialState.activeBlockId
                    && preview.added == expectedNames.count
                    && preview.rows == expectedNames.count
                    && committed
                    && (state.sources?.count ?? 0) == initialSourceCount + 1
                    && state.rotators.count == initialRotatorCount + expectedNames.count
                    && importedNames == expectedNames.sorted()
                    && importedSource?.fileName == csvURL.lastPathComponent
                    && (importedSource?.importedRotatorCount ?? 0) == expectedNames.count
                    && importedSource?.warningCount == 0
                    && (importedSource?.parsedRows.count ?? 0) == expectedNames.count,
                "screen": "Sources",
                "blockId": initialState.activeBlockId,
                "blockName": state.activeBlock?.name ?? "",
                "sourceFile": csvURL.path,
                "previewFileName": preview.fileName,
                "previewAdded": preview.added,
                "previewUpdated": preview.updated,
                "previewRemoved": preview.removed,
                "previewRows": preview.rows,
                "previewWarnings": preview.warningsCount,
                "previewColumns": preview.columnsFound,
                "committed": committed,
                "initialSourceCount": initialSourceCount,
                "afterSourceCount": state.sources?.count ?? 0,
                "initialRotatorCount": initialRotatorCount,
                "afterRotatorCount": state.rotators.count,
                "importedSourceId": importedSource?.id ?? "",
                "importedFileName": importedSource?.fileName ?? "",
                "importedProgram": importedSource?.program ?? "",
                "importedRotatorCount": importedSource?.importedRotatorCount ?? 0,
                "importedParsedRows": importedSource?.parsedRows.count ?? 0,
                "importedWarningCount": importedSource?.warningCount ?? 0,
                "importedWarnings": importedSource?.importWarnings ?? [],
                "importedRotators": importedNames,
                "lastMessage": store.lastMessage ?? "",
                "startedAt": startedAt,
                "finishedAt": ISO8601DateFormatter().string(from: Date())
            ])
        } catch {
            writeFailure(error.localizedDescription)
        }
    }
}

private enum SourcesImportProbe {
    static var isRequested: Bool {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_SOURCES_IMPORT_AUDIT")
            ?? ""
        return ["1", "true", "yes", "on"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func write(_ payload: [String: Any]) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-sources-import.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native Sources import probe: \(error.localizedDescription)")
        }
    }
}

private struct SourceListRow: View {
    let source: SourceRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(source.displayName)
                    .font(.body)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(source.typeLabel)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Text(source.program ?? "Other")
                if let importedAt = source.importedAt {
                    Text(importedAt)
                }
                if let count = source.importedRotatorCount {
                    Text("\(count) rotators")
                }
                if source.warningCount > 0 {
                    Label("\(source.warningCount)", systemImage: "exclamationmark.triangle")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}

private struct SourceRowsPreview: View {
    let source: SourceRecord

    var body: some View {
        let columns = source.previewColumns
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(Array(source.parsedRows.enumerated()), id: \.offset) { _, row in
                        HStack(spacing: 0) {
                            ForEach(columns, id: \.self) { column in
                                Text(row[column]?.displayString ?? "")
                                    .font(.callout)
                                    .lineLimit(2)
                                    .frame(width: 170, alignment: .leading)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 6)
                                    .border(Color.secondary.opacity(0.12), width: 0.5)
                            }
                        }
                    }
                } header: {
                    HStack(spacing: 0) {
                        ForEach(columns, id: \.self) { column in
                            Text(column)
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)
                                .frame(width: 170, alignment: .leading)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 7)
                                .border(Color.secondary.opacity(0.12), width: 0.5)
                        }
                    }
                    .background(.bar)
                }
            }
            .padding()
        }
        .background(Color.secondary.opacity(0.03))
    }
}

private let sourceRosterContentTypes: [UTType] = [
    UTType(filenameExtension: "csv"),
    UTType(filenameExtension: "json"),
    UTType(filenameExtension: "xlsx"),
    UTType(filenameExtension: "xlsm"),
].compactMap { $0 }

private struct SourcesCoordinatorBundleSelection {
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
        url.lastPathComponent.lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
    }
}
