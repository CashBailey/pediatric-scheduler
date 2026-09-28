import Foundation
import AppKit
import SwiftUI

/// Single source of UI truth. Boots the Python backend, loads state, and
/// funnels every mutation through the command endpoint — after which it
/// replaces the published state with the authoritative copy the backend
/// returns. SwiftUI re-renders off `@Published state`.
@MainActor
final class AppStore: ObservableObject {
    static let allConflictsQueryKey = "__all__"

    enum Phase: Equatable {
        case starting
        case ready
        case failed(String)
    }

    @Published var phase: Phase = .starting
    @Published var state: SchedulerState?
    @Published var lastMessage: String?
    @Published var lastReport: String?
    @Published var lastReportDate: String?
    @Published var lastReportBlockId: String?
    @Published var lastDraftReport: DraftReport?
    @Published var lastConflicts: [ConflictSummary] = []
    @Published var lastConflictsDate: String?
    @Published var lastConflictsQueryKey: String?
    @Published var lastConflictsBlockId: String?
    @Published var lastExportFolderPath: String?
    @Published var lastExportDescription: String?
    @Published var lastExportFileNames: [String] = []
    @Published var planningGrid: PlanningGridProjection?
    /// Bumped after every successful mutating command. Views that project
    /// server state (planning grid) refetch off this instead of diffing the
    /// typed SchedulerState, so a stateDecodeFailed result still refreshes.
    @Published private(set) var mutationTick = 0
    @Published var scheduleFocus: ScheduleFocus?
    /// Sidebar selection lives on the store so the app menu (⌘1–⌘9) can
    /// drive navigation as well as the sidebar list.
    @Published var screenSelection: Screen = Screen.initialSelection
    @Published private(set) var undoDepth = 0
    @Published private(set) var redoDepth = 0
    /// True while an undo/redo is in flight — blocks re-entry (holding ⌘Z
    /// must not double-pop the stacks) and disables the buttons.
    @Published private(set) var isTimeTraveling = false

    private let backend = BackendController()
    private let api = APIClient()
    private let historyLimit = 50
    private var undoStack: [Data] = []
    private var redoStack: [Data] = []
    /// Raw bytes of the last state this store adopted. The backend is
    /// single-writer (this app), so these equal what the backend holds —
    /// used as the undo "before" snapshot instead of re-fetching the whole
    /// state before every command. nil forces a fresh GET.
    private var lastKnownStateData: Data?

    var canUndo: Bool { undoDepth > 0 && !isTimeTraveling }
    var canRedo: Bool { redoDepth > 0 && !isTimeTraveling }

    /// Launch the backend (off the main thread) and load initial state.
    func boot() {
        phase = .starting
        backend.startIfNeeded { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success:
                    await self.reload()
                case .failure(let error):
                    self.phase = .failed(error.localizedDescription)
                }
            }
        }
    }

    /// Re-fetch authoritative state from the backend.
    func reload() async {
        do {
            let data = try await api.getStateData()
            state = try APIClient.decodeState(from: data)
            lastKnownStateData = data
            phase = .ready
            clearConflictResults()
        } catch {
            // Only tear down to the boot-failure screen when there is no
            // usable state yet. A transient failure on a manual ⌘R refresh
            // should not destroy a working UI.
            if state == nil {
                phase = .failed(error.localizedDescription)
            } else {
                lastMessage = "Reload failed: \(error.localizedDescription) Press ⌘R to retry."
            }
        }
    }

    /// Run a command; on success adopt the returned state. Errors surface in
    /// `lastMessage` rather than crashing the UI.
    @discardableResult
    func run(_ type: String, input: [String: Any] = [:]) async -> Bool {
        guard !isTimeTraveling else {
            lastMessage = "Undo or redo is already in progress."
            return false
        }
        do {
            let before = try await snapshotStateData()
            let result = try await api.command(type: type, input: input)
            if let newState = result.state {
                state = newState
                lastKnownStateData = result.stateData
            } else if result.changed {
                // Backend mutated but Swift could not decode the typed
                // projection. Keep raw bytes for undo/redo snapshots.
                lastKnownStateData = result.stateData
            }
            if let report = result.data["report"] as? String {
                lastReport = report
                lastReportDate = type == "report.daily" ? input["date"] as? String : nil
                lastReportBlockId = type == "report.daily" ? state?.activeBlock?.id : nil
            } else if let report = result.data["report"] as? [String: Any] {
                lastDraftReport = DraftReport(raw: report)
            }
            if result.ok && result.changed {
                // Keep the current planning grid rendering while the fresh
                // projection loads (mutationTick triggers the refetch) — nil-ing
                // it here swapped in the legacy grid and read as a blink.
                mutationTick += 1
                if shouldClearConflictResults(after: type, input: input) {
                    clearConflictResults()
                }
                if type == "block.use" {
                    // The draft report describes the previous block.
                    lastDraftReport = nil
                }
                recordUndoSnapshot(before)
            }
            var message = result.ok ? result.message : (result.errorMessage ?? "Command failed (\(type)). Try again, or reload the schedule (⌘R).")
            if result.stateDecodeFailed {
                message = [message, "The change was saved, but the view could not refresh — reload the schedule (⌘R)."]
                    .compactMap { $0 }
                    .joined(separator: " ")
            }
            lastMessage = message
            return result.ok
        } catch {
            lastMessage = error.localizedDescription
            return false
        }
    }

    /// Run several commands as ONE undo step. A multi-run paint gesture must
    /// revert with a single Undo (the browser folds all runs into one history
    /// entry), so the undo snapshot is taken once before the first command and
    /// recorded once if anything changed. Stops at the first failed command.
    /// `changed` is false when every command was an acknowledged no-op —
    /// callers must not claim success ("Painted N days") in that case.
    @discardableResult
    func runBatch(_ type: String, inputs: [[String: Any]]) async -> (ok: Bool, changed: Bool) {
        guard !inputs.isEmpty else { return (true, false) }
        guard !isTimeTraveling else {
            lastMessage = "Undo or redo is already in progress."
            return (false, false)
        }
        do {
            let before = try await snapshotStateData()
            var anyChanged = false
            var lastResultMessage: String?
            for input in inputs {
                let result = try await api.command(type: type, input: input)
                if let newState = result.state {
                    state = newState
                    lastKnownStateData = result.stateData
                } else if result.changed {
                    lastKnownStateData = result.stateData
                }
                anyChanged = anyChanged || (result.ok && result.changed)
                guard result.ok else {
                    lastMessage = result.errorMessage ?? "Command failed (\(type)). Try again, or reload the schedule (⌘R)."
                    if anyChanged {
                        mutationTick += 1
                        clearConflictResults()
                        recordUndoSnapshot(before)
                    }
                    return (false, anyChanged)
                }
                lastResultMessage = result.message
            }
            if anyChanged {
                mutationTick += 1
                clearConflictResults()
                recordUndoSnapshot(before)
            }
            lastMessage = lastResultMessage
            return (true, anyChanged)
        } catch {
            lastMessage = error.localizedDescription
            return (false, false)
        }
    }

    /// Current backend state bytes for an undo snapshot. Served from the
    /// adopted-state cache when available; falls back to a real GET.
    private func snapshotStateData() async throws -> Data {
        if let cached = lastKnownStateData {
            return cached
        }
        let data = try await api.getStateData()
        lastKnownStateData = data
        return data
    }

    private func adoptStateData(_ data: Data) throws {
        state = try APIClient.decodeState(from: data)
        lastKnownStateData = data
        phase = .ready
    }

    private func encodedStateData(from object: Any) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw AppError("The scheduler state could not be serialized — reload the schedule (⌘R) and try again.")
        }
        return try JSONSerialization.data(withJSONObject: object)
    }

    /// Preview the known local Coordinator DOCX bundle from this user's Downloads.
    func previewDefaultCoordinatorDocx() async throws -> CoordinatorImportResult {
        try await api.importDefaultCoordinatorDocxPreview()
    }

    /// Preview user-selected Coordinator DOCX files from disk. This keeps import
    /// local-first while removing the old dependence on hard-coded Downloads
    /// filenames.
    func previewCoordinatorDocx(master: URL, inpatient: URL, outpatient: URL) async throws -> CoordinatorImportResult {
        try await api.importCoordinatorDocxPreview(
            masterPath: master.path,
            inpatientPath: inpatient.path,
            outpatientPath: outpatient.path
        )
    }

    /// Persist a reviewed Coordinator DOCX scheduler-state preview, then reload
    /// through the normal state route.
    @discardableResult
    func commitCoordinatorImportResult(_ result: CoordinatorImportResult) async -> Bool {
        do {
            try await applyCoordinatorImportResult(result)
            return true
        } catch {
            lastMessage = error.localizedDescription
            return false
        }
    }

    /// Import the known local Coordinator DOCX bundle immediately. Kept for simple
    /// entry points; native screens should preview + commit separately.
    func importDefaultCoordinatorDocx() async {
        do {
            let result = try await previewDefaultCoordinatorDocx()
            _ = await commitCoordinatorImportResult(result)
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    /// Import user-selected Coordinator DOCX files immediately. Kept for simple
    /// entry points; native screens should preview + commit separately.
    func importCoordinatorDocx(master: URL, inpatient: URL, outpatient: URL) async {
        do {
            let result = try await previewCoordinatorDocx(master: master, inpatient: inpatient, outpatient: outpatient)
            _ = await commitCoordinatorImportResult(result)
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    /// Parse a template-style or matrix-style roster file and return the
    /// validated state preview. Callers can review the summary before
    /// committing it.
    func previewRosterFile(
        _ url: URL,
        mode: RosterImportMode = .merge,
        replaceSourceId: String? = nil,
        columnMapping: [String: Int]? = nil,
        matrixBangBehavior: String = "present"
    ) async throws -> RosterImportResult {
        try await api.importRosterPreview(
            filePath: url.path,
            mode: mode.rawValue,
            replaceSourceId: replaceSourceId,
            columnMapping: columnMapping,
            matrixBangBehavior: matrixBangBehavior
        )
    }

    /// Persist a previously reviewed roster import preview and reload state.
    @discardableResult
    func commitRosterImportResult(
        _ result: RosterImportResult,
        columnMapping: [String: Int]? = nil,
        matrixBangBehavior: String? = nil
    ) async -> Bool {
        guard !isTimeTraveling else {
            lastMessage = "Undo or redo is already in progress."
            return false
        }
        do {
            let before = try await snapshotStateData()
            let mappingOverride = result.importMeta.isMatrix
                ? nil
                : (columnMapping ?? result.importMeta.columnMapping)
            let freshResult = try await api.importRosterPreview(
                filePath: result.sourceFile,
                mode: result.mode.rawValue,
                replaceSourceId: result.replaceSourceId,
                columnMapping: mappingOverride,
                matrixBangBehavior: matrixBangBehavior ?? result.importMeta.matrixBangBehavior
            )
            let replacementData = try encodedStateData(from: freshResult.stateObject)
            try await api.writeStateData(replacementData)
            var message = freshResult.replaceSourceId == nil ? "Imported roster" : "Replaced source"
            message += ": \(freshResult.added) added, \(freshResult.updated) updated."
            if freshResult.removed > 0 {
                message += " \(freshResult.removed) removed."
            }
            if freshResult.warningsCount > 0 {
                message += " \(freshResult.warningsCount) warnings."
            }
            lastMessage = message
            await refreshAfterStateReplacement(before: before, replacementData: replacementData)
            return true
        } catch {
            lastMessage = error.localizedDescription
            return false
        }
    }

    /// Import a roster file immediately. Kept for simple entry points; richer
    /// native flows should call preview + commit separately.
    func importRosterFile(_ url: URL, mode: RosterImportMode = .merge) async {
        do {
            let result = try await previewRosterFile(url, mode: mode)
            _ = await commitRosterImportResult(result)
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    /// Build the engine export package and write it as normal files in
    /// Downloads so the native app does not depend on browser download APIs.
    func exportPackage() async {
        do {
            let result = try await api.command(type: "export.package")
            guard result.ok, let package = result.data["package"] as? [String: Any] else {
                lastMessage = result.errorMessage ?? "Export failed."
                return
            }
            let export = try writeExportPackage(package)
            rememberExport(export, description: "Export package")
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    func exportPDFs() async {
        do {
            let result = try await api.command(type: "export.pdfs")
            guard result.ok, let files = result.data["files"] as? [[String: Any]] else {
                lastMessage = result.errorMessage ?? "PDF export failed."
                return
            }
            let export = try writePDFExports(files)
            rememberExport(export, description: "PDF exports")
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    func exportWordDocs() async {
        do {
            let result = try await api.command(type: "export.word")
            guard result.ok, let files = result.data["files"] as? [[String: Any]] else {
                lastMessage = result.errorMessage ?? "Word export failed."
                return
            }
            let export = try writeBase64Exports(files)
            rememberExport(export, description: "Word exports")
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    /// Coordinator's three final documents (Master / Inpatient / Outpatient),
    /// each as .docx + .pdf, in her July format (2026-07-29 #9).
    func exportCoordinatorBundle() async {
        do {
            let result = try await api.command(type: "export.coordinatorBundle")
            guard result.ok, let files = result.data["files"] as? [[String: Any]] else {
                lastMessage = result.errorMessage ?? "Final schedule export failed."
                return
            }
            let export = try writeBase64Exports(files)
            rememberExport(export, description: "Final schedule documents")
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    func exportHandoffPacket() async {
        var root: URL?
        do {
            let packageResult = try await api.command(type: "export.package")
            guard packageResult.ok, let package = packageResult.data["package"] as? [String: Any] else {
                lastMessage = packageResult.errorMessage ?? "Export package failed."
                return
            }
            let pdfResult = try await api.command(type: "export.pdfs")
            guard pdfResult.ok, let pdfFiles = pdfResult.data["files"] as? [[String: Any]] else {
                lastMessage = pdfResult.errorMessage ?? "PDF export failed."
                return
            }
            let wordResult = try await api.command(type: "export.word")
            guard wordResult.ok, let wordFiles = wordResult.data["files"] as? [[String: Any]] else {
                lastMessage = wordResult.errorMessage ?? "Word export failed."
                return
            }

            let folder = try makeExportFolder(blockName: state?.activeBlock?.name ?? "schedule")
            root = folder
            var written: [URL] = []
            written.append(contentsOf: try writeExportPackage(package, to: folder).files)
            written.append(contentsOf: try writePDFExports(pdfFiles, to: folder.appendingPathComponent("PDFs", isDirectory: true)).files)
            written.append(contentsOf: try writeBase64Exports(wordFiles, to: folder.appendingPathComponent("Word", isDirectory: true)).files)
            rememberExport(
                ExportWriteResult(folder: folder, files: written),
                description: "Handoff packet"
            )
        } catch {
            // A half-written packet folder looks complete in Finder; every
            // file is re-derivable, so remove the folder rather than leave
            // a misleading partial export.
            if let root {
                try? FileManager.default.removeItem(at: root)
            }
            lastMessage = "Handoff packet export failed: \(error.localizedDescription) Partial files were removed — please re-export."
        }
    }

    func revealLastExportFolder() {
        guard let path = lastExportFolderPath, !path.isEmpty else {
            lastMessage = "No export folder has been written yet."
            return
        }
        let folder = URL(fileURLWithPath: path, isDirectory: true)
        NSWorkspace.shared.activateFileViewerSelecting([folder])
    }

    func revealLastExportFile(named fileName: String) {
        guard let path = lastExportFolderPath, !path.isEmpty else {
            lastMessage = "No export folder has been written yet."
            return
        }
        let folder = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        let file = folder.appendingPathComponent(fileName).standardizedFileURL
        let folderPath = folder.path.hasSuffix("/") ? folder.path : "\(folder.path)/"
        guard file.path.hasPrefix(folderPath) else {
            lastMessage = "Export file was not found."
            return
        }
        guard FileManager.default.fileExists(atPath: file.path) else {
            lastMessage = "Export file was not found."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([file])
    }

    func copyLastExportPath() {
        guard let path = lastExportFolderPath, !path.isEmpty else {
            lastMessage = "No export folder has been written yet."
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(path, forType: .string)
        lastMessage = "Copied export folder path."
    }

    /// Save a full scheduler-state JSON backup to a user-selected file. This
    /// preserves fields Swift does not decode, because the raw backend JSON is
    /// written directly.
    func exportStateBackup(to url: URL) async {
        do {
            let object = try await api.getStateObject()
            guard JSONSerialization.isValidJSONObject(object) else {
                throw AppError("The scheduler state could not be serialized for backup — reload the schedule (⌘R) and try again.")
            }
            let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: url, options: .atomic)
            lastMessage = "Backup written to \(url.path)."
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    /// Restore a scheduler-state JSON backup through the normal backend state
    /// route so the frozen schema still protects local data.
    func importStateBackup(from url: URL) async {
        guard !isTimeTraveling else {
            lastMessage = "Undo or redo is already in progress."
            return
        }
        let object: Any
        do {
            let data = try Data(contentsOf: url)
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            // Raw Cocoa errors name neither the file nor what a valid one is.
            lastMessage = "\(url.lastPathComponent) is not a valid scheduler backup — choose a JSON file created by Export Backup."
            return
        }
        do {
            let before = try await snapshotStateData()
            let replacementData = try encodedStateData(from: object)
            try await api.writeStateData(replacementData)
            lastMessage = "Backup restored from \(url.lastPathComponent)."
            await refreshAfterStateReplacement(before: before, replacementData: replacementData)
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    func loadConflicts(date: String? = nil) async {
        do {
            var input: [String: Any] = [:]
            let filteredDate = date?.isEmpty == false ? date : nil
            if let filteredDate {
                input["date"] = filteredDate
            }
            let result = try await api.command(type: "conflicts.list", input: input)
            guard result.ok, let raw = result.data["conflicts"] as? [[String: Any]] else {
                lastMessage = result.errorMessage ?? "Could not load conflicts."
                return
            }
            lastConflicts = raw.map(ConflictSummary.init).sorted {
                if $0.date != $1.date { return $0.date < $1.date }
                return $0.title < $1.title
            }
            lastConflictsDate = filteredDate
            lastConflictsQueryKey = filteredDate ?? Self.allConflictsQueryKey
            lastConflictsBlockId = state?.activeBlock?.id
            lastMessage = result.message
        } catch {
            lastMessage = error.localizedDescription
        }
    }

    func loadPlanningGrid(blockRef: String? = nil, peekBeforeBlock: Bool = false, peekPastBlock: Bool = false) async {
        do {
            var input: [String: Any] = [:]
            if let blockRef, !blockRef.isEmpty {
                input["blockRef"] = blockRef
            }
            if peekBeforeBlock {
                input["peekBeforeBlock"] = true
            }
            if peekPastBlock {
                input["peekPastBlock"] = true
            }
            let result = try await api.command(type: "grid.show", input: input)
            guard result.ok,
                  let grid = result.data["grid"] as? [String: Any],
                  let blockId = result.data["blockId"] as? String
            else {
                planningGrid = nil
                lastMessage = result.errorMessage ?? "Could not load planning grid."
                return
            }
            planningGrid = PlanningGridProjection(
                blockId: blockId,
                peekBeforeBlock: peekBeforeBlock,
                peekPastBlock: peekPastBlock,
                rawStartDate: result.data["rawStartDate"] as? String,
                rawEndDate: result.data["rawEndDate"] as? String,
                effectiveStartDate: result.data["effectiveStartDate"] as? String,
                effectiveEndDate: result.data["effectiveEndDate"] as? String,
                raw: grid
            )
        } catch {
            // Keep the stale grid on a transient failure — wiping it to an
            // empty panel loses the user's context. The explicit not-ok
            // branch above still clears it when the backend says no.
            lastMessage = "Could not refresh the planning grid: \(error.localizedDescription)"
        }
    }

    func focus(_ conflict: ConflictSummary) {
        scheduleFocus = ScheduleFocus(conflict: conflict)
    }

    func clearDraftReport() {
        lastDraftReport = nil
    }

    /// Drop one resolved check from the draft report, keeping the remaining
    /// unresolved picks visible. Clears the panel only when nothing is left.
    func removeDraftCheck(id: String) {
        guard var report = lastDraftReport else { return }
        report.checks.removeAll { $0.id == id }
        lastDraftReport = report.checks.isEmpty ? nil : report
    }

    func undo() async {
        // Peek — don't pop — until the backend write succeeds. If the write
        // fails, nothing (stacks, backend, UI) has changed. If the write
        // succeeds, commit the stack mutation BEFORE the refresh so the
        // history always matches what the backend actually persisted, even
        // when the follow-up getState/decode fails.
        guard !isTimeTraveling else { return }
        isTimeTraveling = true
        defer { isTimeTraveling = false }
        guard let previous = undoStack.last else {
            lastMessage = "Nothing to undo."
            return
        }
        let current: Data
        var localDecodeError: Error?
        do {
            current = try await snapshotStateData()
            try await api.writeStateData(previous)
            do {
                try adoptStateData(previous)
            } catch {
                state = nil
                lastKnownStateData = nil
                localDecodeError = error
            }
        } catch {
            lastMessage = error.localizedDescription
            return
        }
        _ = popUndoSnapshot()
        pushRedoSnapshot(current)
        clearStateDerivedPanels()
        do {
            let refreshed = try await api.getStateData()
            try adoptStateData(refreshed)
            lastMessage = "Undid the last change. Redo is available."
        } catch {
            if let localDecodeError {
                lastMessage = "Undid the last change, but the written state could not be decoded and refreshing failed: \(localDecodeError.localizedDescription); \(error.localizedDescription)"
            } else {
                lastMessage = "Undid the last change, but refreshing the view failed: \(error.localizedDescription)"
            }
        }
    }

    func redo() async {
        guard !isTimeTraveling else { return }
        isTimeTraveling = true
        defer { isTimeTraveling = false }
        guard let next = redoStack.last else {
            lastMessage = "Nothing to redo."
            return
        }
        let current: Data
        var localDecodeError: Error?
        do {
            current = try await snapshotStateData()
            try await api.writeStateData(next)
            do {
                try adoptStateData(next)
            } catch {
                state = nil
                lastKnownStateData = nil
                localDecodeError = error
            }
        } catch {
            lastMessage = error.localizedDescription
            return
        }
        _ = popRedoSnapshot()
        pushUndoSnapshot(current)
        clearStateDerivedPanels()
        do {
            let refreshed = try await api.getStateData()
            try adoptStateData(refreshed)
            lastMessage = "Redid the change."
        } catch {
            if let localDecodeError {
                lastMessage = "Redid the change, but the written state could not be decoded and refreshing failed: \(localDecodeError.localizedDescription); \(error.localizedDescription)"
            } else {
                lastMessage = "Redid the change, but refreshing the view failed: \(error.localizedDescription)"
            }
        }
    }

    private func applyCoordinatorImportResult(_ result: CoordinatorImportResult) async throws {
        guard !isTimeTraveling else {
            throw AppError("Undo or redo is already in progress.")
        }
        let before = try await snapshotStateData()
        let replacementData = try encodedStateData(from: result.stateObject)
        try await api.writeStateData(replacementData)
        var message = "Imported Coordinator DOCX: \(result.importedRotators) rotators, \(result.inpatientAssignments) inpatient, \(result.outpatientSessions) outpatient."
        if result.unresolvedNames > 0 {
            message += " \(result.unresolvedNames) unresolved names."
        }
        if result.warningsCount > 0 {
            message += " \(result.warningsCount) warnings."
        }
        lastMessage = message
        await refreshAfterStateReplacement(before: before, replacementData: replacementData)
    }

    /// Refresh the UI after the backend has accepted a full-state
    /// replacement. The write has already succeeded, so a refresh failure
    /// must not read as an import failure: history still records the undo
    /// snapshot and the message tells the user how to recover. Every derived
    /// panel (reports, conflicts, planning grid, schedule focus) describes
    /// the old state — clear all via clearStateDerivedPanels().
    private func refreshAfterStateReplacement(before: Data, replacementData: Data) async {
        var localDecodeError: Error?
        do {
            try adoptStateData(replacementData)
        } catch {
            state = nil
            lastKnownStateData = nil
            localDecodeError = error
        }
        clearStateDerivedPanels()
        if before != replacementData {
            recordUndoSnapshot(before)
        }
        do {
            let after = try await api.getStateData()
            try adoptStateData(after)
        } catch {
            if let localDecodeError {
                lastMessage = "The change was saved, but the written state could not be decoded and refreshing failed — reload the schedule (⌘R): \(localDecodeError.localizedDescription); \(error.localizedDescription)"
            } else {
                lastMessage = "The change was saved, but refreshing the view failed — reload the schedule (⌘R): \(error.localizedDescription)"
            }
        }
    }

    private struct ExportWriteResult {
        let folder: URL
        let files: [URL]
    }

    private func writeExportPackage(_ package: [String: Any], to targetFolder: URL? = nil) throws -> ExportWriteResult {
        let manifest = package["manifest"] as? [String: Any] ?? [:]
        let blockName = manifest["block"] as? String ?? state?.activeBlock?.name ?? "schedule"
        let folder = try prepareExportFolder(targetFolder ?? makeExportFolder(blockName: blockName))
        let files = manifest["files"] as? [[String: Any]] ?? []
        var written: [URL] = []

        for file in files {
            guard let name = file["name"] as? String else { continue }
            let key = file["key"] as? String ?? exportPackageKey(for: name)
            let destination = folder.appendingPathComponent(URL(fileURLWithPath: name).lastPathComponent)
            let format = file["format"] as? String
            if format == "text" || format == "csv" {
                // A manifest/payload key drift must fail loudly, not write an
                // empty file into an export that looks complete.
                guard let content = package[key] as? String else {
                    throw AppError("Export package is missing content for \(name) — re-run the export.")
                }
                try content.write(to: destination, atomically: true, encoding: .utf8)
            } else {
                guard let object = package[key], JSONSerialization.isValidJSONObject(object) else {
                    throw AppError("Export package is missing content for \(name) — re-run the export.")
                }
                try writeJSON(object, to: destination)
            }
            written.append(destination)
        }
        return ExportWriteResult(folder: folder, files: written)
    }

    private func exportPackageKey(for fileName: String) -> String {
        switch fileName {
        case "manifest.json":
            return "manifest"
        case "roster.json":
            return "roster"
        case "roster.csv":
            return "rosterCsv"
        case "inpatient-calendar.json":
            return "inpatientCalendar"
        case "inpatient-calendar.csv":
            return "inpatientCalendarCsv"
        case "outpatient-calendar.json":
            return "outpatientCalendar"
        case "outpatient-calendar.csv":
            return "outpatientCalendarCsv"
        case "daily-reports.txt":
            return "dailyReports"
        case "legend.json":
            return "legend"
        case "legend.csv":
            return "legendCsv"
        case "conflicts.json":
            return "conflicts"
        case "conflicts.csv":
            return "conflictsCsv"
        // Keep the shorter source-summary names as legacy fallbacks for older manifests.
        case "source-summary.json", "source-import-summary.json":
            return "sourceSummary"
        case "source-summary.csv", "source-import-summary.csv":
            return "sourceSummaryCsv"
        case "schedule-package.json":
            return "schedulePackage"
        default:
            return fileName
        }
    }

    private func writePDFExports(_ files: [[String: Any]], to targetFolder: URL? = nil) throws -> ExportWriteResult {
        try writeBase64Exports(files, to: targetFolder)
    }

    private func writeBase64Exports(_ files: [[String: Any]], to targetFolder: URL? = nil) throws -> ExportWriteResult {
        let folder = try prepareExportFolder(targetFolder ?? makeExportFolder(blockName: state?.activeBlock?.name ?? "schedule"))
        var written: [URL] = []
        for file in files {
            guard
                let name = file["name"] as? String,
                let encoded = file["base64"] as? String,
                let data = Data(base64Encoded: encoded)
            else {
                throw AppError("The backend sent an export file that could not be decoded — re-run the export.")
            }
            let destination = folder.appendingPathComponent(URL(fileURLWithPath: name).lastPathComponent)
            try data.write(to: destination, options: .atomic)
            written.append(destination)
        }
        return ExportWriteResult(folder: folder, files: written)
    }

    private func makeExportFolder(blockName: String) throws -> URL {
        let fileManager = FileManager.default
        let downloads = fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
        let folder = downloads
            .appendingPathComponent("PediatricSchedulerExports", isDirectory: true)
            .appendingPathComponent("\(safePathComponent(blockName))-\(exportTimestamp())", isDirectory: true)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private func prepareExportFolder(_ folder: URL) throws -> URL {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private func writeJSON(_ object: Any?, to url: URL) throws {
        guard let object, JSONSerialization.isValidJSONObject(object) else {
            throw AppError("Export content for \(url.lastPathComponent) was missing or invalid — re-run the export.")
        }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
    }

    private func safePathComponent(_ value: String) -> String {
        let sanitized = value.map { character in
            character.isLetter || character.isNumber ? String(character) : "-"
        }.joined()
        let trimmed = sanitized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? "schedule" : trimmed
    }

    private func exportTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    private func rememberExport(_ export: ExportWriteResult, description: String) {
        lastExportFolderPath = export.folder.path
        lastExportDescription = description
        lastExportFileNames = export.files.map { relativeExportPath($0, root: export.folder) }.sorted()
        let count = lastExportFileNames.count
        lastMessage = "\(description) written to \(export.folder.path) (\(count) file\(count == 1 ? "" : "s"))."
    }

    private func relativeExportPath(_ file: URL, root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let filePath = file.standardizedFileURL.path
        let prefix = rootPath.hasSuffix("/") ? rootPath : "\(rootPath)/"
        if filePath.hasPrefix(prefix) {
            return String(filePath.dropFirst(prefix.count))
        }
        return file.lastPathComponent
    }

    private func recordUndoSnapshot(_ snapshot: Data) {
        pushUndoSnapshot(snapshot)
        redoStack.removeAll()
        syncHistoryDepths()
    }

    private func pushUndoSnapshot(_ snapshot: Data) {
        undoStack.append(snapshot)
        if undoStack.count > historyLimit {
            undoStack.removeFirst(undoStack.count - historyLimit)
        }
        syncHistoryDepths()
    }

    private func pushRedoSnapshot(_ snapshot: Data) {
        redoStack.append(snapshot)
        if redoStack.count > historyLimit {
            redoStack.removeFirst(redoStack.count - historyLimit)
        }
        syncHistoryDepths()
    }

    private func popUndoSnapshot() -> Data? {
        guard !undoStack.isEmpty else { return nil }
        let snapshot = undoStack.removeLast()
        syncHistoryDepths()
        return snapshot
    }

    private func popRedoSnapshot() -> Data? {
        guard !redoStack.isEmpty else { return nil }
        let snapshot = redoStack.removeLast()
        syncHistoryDepths()
        return snapshot
    }

    private func syncHistoryDepths() {
        undoDepth = undoStack.count
        redoDepth = redoStack.count
    }

    private func clearStateDerivedPanels() {
        lastReport = nil
        lastReportDate = nil
        lastReportBlockId = nil
        lastDraftReport = nil
        clearConflictResults()
        planningGrid = nil
        // Wholesale state swaps (undo/redo, import) really do invalidate the
        // grid — bump the tick so the grid view refetches the projection.
        mutationTick += 1
        scheduleFocus = nil
    }

    private func clearConflictResults() {
        lastConflicts = []
        lastConflictsDate = nil
        lastConflictsQueryKey = nil
        lastConflictsBlockId = nil
        scheduleFocus = nil
    }

    private func shouldClearConflictResults(after type: String, input: [String: Any]) -> Bool {
        if type == "block.update",
           let patch = input["patch"] as? [String: Any],
           Set(patch.keys).isSubset(of: Set(["status", "finalizedAt", "finalizedBy", "finalReview"])) {
            return false
        }
        return true
    }

    func shutdown() {
        backend.stop()
    }
}

struct PlanningGridProjection {
    let blockId: String
    /// The peek configuration this projection was fetched under. The grid
    /// view refuses to render a projection whose flags don't match the
    /// current toggles — a stale no-peek grid shown mid-toggle reads as
    /// "assignments shifted into the peek window" (Coordinator 2026-07-29 #7).
    let peekBeforeBlock: Bool
    let peekPastBlock: Bool
    let rawStartDate: String?
    let rawEndDate: String?
    let effectiveStartDate: String?
    let effectiveEndDate: String?
    let dates: [String]
    let rows: [PlanningGridRow]
    let totals: [PlanningDayTotal]
    let sectionCounts: [String: Int]
    let sectionRotatorIds: [String: Set<String>]
    let sectionRows: [String: [PlanningGridRow]]

    init(blockId: String, peekBeforeBlock: Bool = false, peekPastBlock: Bool = false, rawStartDate: String?, rawEndDate: String?, effectiveStartDate: String?, effectiveEndDate: String?, raw: [String: Any]) {
        self.blockId = blockId
        self.peekBeforeBlock = peekBeforeBlock
        self.peekPastBlock = peekPastBlock
        self.rawStartDate = rawStartDate
        self.rawEndDate = rawEndDate
        self.effectiveStartDate = effectiveStartDate
        self.effectiveEndDate = effectiveEndDate
        dates = (raw["dates"] as? [Any] ?? []).compactMap { $0 as? String }
        rows = (raw["rows"] as? [[String: Any]] ?? []).map(PlanningGridRow.init)
        totals = (raw["totals"] as? [[String: Any]] ?? []).map(PlanningDayTotal.init)

        var counts: [String: Int] = [:]
        var idsBySection: [String: Set<String>] = [:]
        var rowsBySection: [String: [PlanningGridRow]] = [:]
        let sections = raw["sections"] as? [String: Any] ?? [:]
        for (sectionId, value) in sections {
            let rows = (value as? [[String: Any]] ?? []).map(PlanningGridRow.init)
            counts[sectionId] = rows.count
            rowsBySection[sectionId] = rows
            idsBySection[sectionId] = Set(rows.map(\.rotator.id))
        }
        sectionCounts = counts
        sectionRotatorIds = idsBySection
        sectionRows = rowsBySection
    }

    func count(_ sectionId: String) -> Int {
        sectionCounts[sectionId] ?? 0
    }

    func rows(in sectionId: String) -> [PlanningGridRow] {
        sectionRows[sectionId] ?? []
    }

    func rotatorIds(in sectionIds: [String]) -> Set<String> {
        sectionIds.reduce(into: Set<String>()) { result, sectionId in
            result.formUnion(sectionRotatorIds[sectionId] ?? [])
        }
    }

    var totalInpatient: Int {
        totals.reduce(0) { $0 + $1.ip }
    }

    var totalOutpatient: Int {
        totals.reduce(0) { $0 + $1.op }
    }

    var totalUnassigned: Int {
        totals.reduce(0) { $0 + $1.unassigned }
    }

    var totalBoth: Int {
        totals.reduce(0) { $0 + $1.both }
    }
}

struct PlanningGridRow: Identifiable {
    let rotator: PlanningGridRotator
    let cells: [PlanningGridCell]

    var id: String {
        rotator.id
    }

    init(raw: [String: Any]) {
        rotator = PlanningGridRotator(raw: raw["rotator"] as? [String: Any] ?? [:])
        cells = (raw["cells"] as? [[String: Any]] ?? []).map(PlanningGridCell.init)
    }

    init(rotator: PlanningGridRotator, cells: [PlanningGridCell]) {
        self.rotator = rotator
        self.cells = cells
    }
}

struct PlanningGridRotator {
    let id: String
    let label: String
    let program: String
    let level: String
    let role: String
    let continuityClinic: String
    let staffKind: String?

    init(raw: [String: Any]) {
        id = raw["id"] as? String ?? UUID().uuidString
        label = (raw["displayName"] as? String)
            ?? (raw["fullName"] as? String)
            ?? id
        program = raw["program"] as? String ?? "Program"
        level = raw["level"] as? String ?? "Level"
        role = raw["role"] as? String ?? ""
        continuityClinic = raw["continuityClinic"] as? String ?? ""
        staffKind = raw["syntheticStaffRow"] as? String
    }

    init(
        id: String,
        label: String,
        program: String,
        level: String,
        role: String,
        continuityClinic: String = "",
        staffKind: String? = nil
    ) {
        self.id = id
        self.label = label
        self.program = program
        self.level = level
        self.role = role
        self.continuityClinic = continuityClinic
        self.staffKind = staffKind
    }

    var detail: String {
        if isPediatricNeurologyFellow {
            return level.lowercased() == "fellow"
                ? "Fellow · \(program)"
                : "Fellow · \(program) · \(level)"
        }
        return "\(program) - \(level)"
    }

    var isFellow: Bool {
        role == "Fellow" || level.lowercased() == "fellow"
    }

    var isPediatricNeurologyFellow: Bool {
        let normalizedProgram = program.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return isFellow
            && (normalizedProgram.isEmpty || normalizedProgram == "other" || normalizedProgram.contains("pedi"))
    }

    var isAttendingProjection: Bool {
        staffKind == "attending" || role == "Attending"
    }
}

struct PlanningGridCell: Identifiable {
    let date: String
    let status: String
    let reason: String?
    let label: String?
    let offCalendar: Bool
    let inpatientCount: Int
    let outpatientCount: Int
    let staffKind: String?
    let staffTitles: [String]
    let staffPeriods: [String]

    var id: String {
        date
    }

    init(raw: [String: Any]) {
        date = raw["date"] as? String ?? ""
        status = raw["status"] as? String ?? "unassigned"
        reason = raw["reason"] as? String
        label = raw["label"] as? String
        offCalendar = raw["offCalendar"] as? Bool ?? false
        inpatientCount = (raw["ip"] as? [Any] ?? []).count
        outpatientCount = (raw["op"] as? [Any] ?? []).count
        staffKind = raw["staffKind"] as? String
        staffTitles = []
        staffPeriods = []
    }

    init(
        date: String,
        status: String,
        reason: String? = nil,
        label: String? = nil,
        offCalendar: Bool = false,
        inpatientCount: Int = 0,
        outpatientCount: Int = 0,
        staffKind: String? = nil,
        staffTitles: [String] = [],
        staffPeriods: [String] = []
    ) {
        self.date = date
        self.status = status
        self.reason = reason
        self.label = label
        self.offCalendar = offCalendar
        self.inpatientCount = inpatientCount
        self.outpatientCount = outpatientCount
        self.staffKind = staffKind
        self.staffTitles = staffTitles
        self.staffPeriods = staffPeriods
    }

    var isEditable: Bool {
        status != "absent" && staffKind != "attending"
    }
}

struct PlanningDayTotal: Identifiable {
    let date: String
    let ip: Int
    let op: Int
    let both: Int
    let unassigned: Int
    let present: Int

    var id: String {
        date
    }

    init(raw: [String: Any]) {
        date = raw["date"] as? String ?? ""
        ip = Self.int(raw["ip"])
        op = Self.int(raw["op"])
        both = Self.int(raw["both"])
        unassigned = Self.int(raw["unassigned"])
        present = Self.int(raw["present"])
    }

    private static func int(_ value: Any?) -> Int {
        if let value = value as? Int {
            return value
        }
        if let value = value as? Double {
            return Int(value)
        }
        if let value = value as? NSNumber {
            return value.intValue
        }
        if let value = value as? String {
            return Int(value) ?? 0
        }
        return 0
    }
}

struct ConflictSummary: Identifiable, Equatable {
    let id: String
    let severity: String
    let type: String
    let date: String
    let title: String
    let detail: String
    let assignment: String
    let rotatorId: String?
    let period: String?

    init(raw: [String: Any]) {
        id = raw["id"] as? String ?? UUID().uuidString
        severity = raw["severity"] as? String ?? "Warning"
        type = raw["type"] as? String ?? ""
        date = raw["date"] as? String ?? ""
        title = raw["title"] as? String ?? "Schedule conflict"
        detail = raw["detail"] as? String ?? ""
        assignment = raw["assignment"] as? String ?? ""
        rotatorId = raw["rotatorId"] as? String
        period = raw["period"] as? String
    }

    var target: ScheduleFocusTarget {
        if type == "double-booked" {
            return .planning
        }
        switch assignment.lowercased() {
        case "clinic":
            return .clinics
        case "outpatient":
            return .outpatient
        case "inpatient":
            return .inpatient
        default:
            return .planning
        }
    }

    var targetLabel: String {
        switch target {
        case .planning:
            return "Planning Grid"
        case .inpatient:
            return "Inpatient"
        case .outpatient:
            return "Outpatient"
        case .clinics:
            return "Clinics"
        case .rotators:
            return "Rotators"
        }
    }
}

enum ScheduleFocusTarget: String, Equatable {
    case planning
    case inpatient
    case outpatient
    case clinics
    case rotators
}

struct ScheduleFocus: Equatable {
    let token = UUID()
    let conflictId: String
    let target: ScheduleFocusTarget
    let date: String
    let assignment: String
    let rotatorId: String?
    let period: String?
    let title: String

    init(conflict: ConflictSummary) {
        conflictId = conflict.id
        target = conflict.target
        date = conflict.date
        assignment = conflict.assignment.lowercased()
        rotatorId = conflict.rotatorId
        period = conflict.period
        title = conflict.title
    }

    init(rotatorId: String, title: String) {
        conflictId = "rotator-\(rotatorId)"
        target = .rotators
        date = ""
        assignment = ""
        self.rotatorId = rotatorId
        period = nil
        self.title = title
    }

    func isFocusedDay(_ day: String, on target: ScheduleFocusTarget) -> Bool {
        self.target == target && date == day
    }

    func matches(inpatient assignment: InpatientAssignment) -> Bool {
        guard date == assignment.date else { return false }
        guard self.assignment.isEmpty || self.assignment == "inpatient" else { return false }
        guard let rotatorId else { return true }
        return assignment.rotatorId == rotatorId
    }

    func matches(outpatient session: OutpatientSession) -> Bool {
        guard date == session.date else { return false }
        guard self.assignment.isEmpty || self.assignment == "outpatient" else { return false }
        if let rotatorId, session.rotatorId != rotatorId {
            return false
        }
        if let period, session.period != period {
            return false
        }
        return true
    }

    func matches(clinic assignment: ClinicAssignment) -> Bool {
        guard date == assignment.date else { return false }
        if let rotatorId, assignment.rotatorId != rotatorId {
            return false
        }
        if let period, assignment.session != period {
            return false
        }
        return true
    }
}
