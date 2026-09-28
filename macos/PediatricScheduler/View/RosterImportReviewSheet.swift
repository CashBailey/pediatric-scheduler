import SwiftUI

struct RosterImportReviewSheet: View {
    let result: RosterImportResult
    let isApplying: Bool
    /// Set by the presenter when a commit attempt fails, so the failure is
    /// visible inside the sheet instead of only in the occluded main window.
    let errorMessage: String?
    let onCancel: () -> Void
    let onConfirm: ([String: Int], String?) -> Void
    /// Re-runs the preview with the edited mapping/!B behavior so the
    /// rows/added/updated/removed/warnings summary reflects what commit will
    /// actually do, not the original auto-detected mapping. Debounced so
    /// dragging through Picker options doesn't fire a preview per tick.
    let onRemap: ([String: Int], String) async -> RosterImportResult
    @State private var columnMapping: [String: Int]
    @State private var matrixBangBehavior: String
    @State private var displayed: RosterImportResult
    @State private var isRemapping = false
    @State private var remapTask: Task<Void, Never>?

    init(
        result: RosterImportResult,
        isApplying: Bool,
        errorMessage: String? = nil,
        onCancel: @escaping () -> Void,
        onConfirm: @escaping ([String: Int], String?) -> Void,
        onRemap: @escaping ([String: Int], String) async -> RosterImportResult
    ) {
        self.result = result
        self.isApplying = isApplying
        self.errorMessage = errorMessage
        self.onCancel = onCancel
        self.onConfirm = onConfirm
        self.onRemap = onRemap
        _columnMapping = State(initialValue: result.importMeta.columnMapping)
        _matrixBangBehavior = State(initialValue: result.importMeta.matrixBangBehavior)
        _displayed = State(initialValue: result)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Review Roster Import")
                        .font(.title2.bold())
                    Text(result.fileName)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)
                .disabled(isApplying)
            }

            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 10) {
                GridRow {
                    Label(result.mode.title, systemImage: "arrow.triangle.2.circlepath")
                    Text(result.mode.summary)
                        .foregroundStyle(.secondary)
                }
                if result.replaceSourceId != nil {
                    GridRow {
                        Label("Replacing Source", systemImage: "doc.badge.arrow.up")
                        Text("The selected source record will keep its id.")
                            .foregroundStyle(.secondary)
                    }
                }
                GridRow {
                    Label("\(displayed.rows) rows", systemImage: "tablecells")
                    Text("\(displayed.added) added, \(displayed.updated) updated, \(displayed.removed) removed")
                        .foregroundStyle(result.mode == .replace && displayed.removed > 0 ? .red : .secondary)
                }
                GridRow {
                    Label("\(displayed.warningsCount) warnings", systemImage: "exclamationmark.triangle")
                    Text(columnsText)
                        .foregroundStyle(.secondary)
                }
                if isRemapping {
                    GridRow {
                        Text("")
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("Re-checking counts for the edited mapping…")
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                if showsMatrixBangPicker {
                    GridRow {
                        Label("!B cells", systemImage: "exclamationmark.square")
                        Picker("!B cells", selection: $matrixBangBehavior) {
                            Text("Include").tag("present")
                            Text("Exclude").tag("exclude")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 190)
                    }
                    GridRow {
                        Text("")
                        Text(bangSummary)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .font(.callout)

            if !result.importMeta.headers.isEmpty {
                Divider()
                DisclosureGroup("Column Mapping") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Adjust how roster columns map before applying this import.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                            ForEach(rosterImportFields) { field in
                                GridRow {
                                    Text(field.label)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .frame(width: 92, alignment: .leading)
                                    Picker(field.label, selection: mappingBinding(for: field.key)) {
                                        Text("Not Used").tag(-1)
                                        ForEach(result.importMeta.headers.indices, id: \.self) { index in
                                            Text(headerLabel(index))
                                                .tag(index)
                                        }
                                    }
                                    .labelsHidden()
                                    .frame(width: 310)
                                }
                            }
                        }
                        if isMissingRequiredMapping {
                            Label("A Name column is required.", systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    .padding(.top, 8)
                }
            }

            if !result.warnings.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Warnings")
                        .font(.callout.bold())
                    ForEach(result.warnings.prefix(5), id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if result.warnings.count > 5 {
                        Text("\(result.warnings.count - 5) more warnings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            HStack {
                if let errorMessage, !errorMessage.isEmpty {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                Spacer()
                Button(role: result.mode == .replace ? .destructive : nil) {
                    onConfirm(columnMapping, showsMatrixBangPicker ? matrixBangBehavior : nil)
                } label: {
                    if isApplying {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Applying")
                        }
                    } else {
                        Label(confirmTitle, systemImage: "checkmark")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isApplying || isMissingRequiredMapping)
            }
        }
        .padding(22)
        .frame(width: 560)
        .onChange(of: columnMapping) { _ in scheduleRemap() }
        .onChange(of: matrixBangBehavior) { _ in scheduleRemap() }
    }

    /// Debounces edits to the mapping/!B pickers: waits for typing/dragging
    /// to settle, then re-previews so the counts shown match what onConfirm
    /// will actually commit. A stale in-flight remap is cancelled by simply
    /// replacing remapTask — its result is discarded, only the latest wins.
    private func scheduleRemap() {
        remapTask?.cancel()
        let mapping = columnMapping
        let bangBehavior = matrixBangBehavior
        remapTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            isRemapping = true
            let fresh = await onRemap(mapping, bangBehavior)
            guard !Task.isCancelled else { return }
            displayed = fresh
            isRemapping = false
        }
    }

    private var columnsText: String {
        if result.importMeta.isMatrix {
            return "Layout: week-grid roster (B/!B marks)"
        }
        if displayed.columnsFound.isEmpty {
            return "No mapped columns reported"
        }
        return "Columns: \(displayed.columnsFound.joined(separator: ", "))"
    }

    private var showsMatrixBangPicker: Bool {
        result.importMeta.isMatrix && !result.importMeta.bangMarkedRotators.isEmpty
    }

    private var bangSummary: String {
        let names = result.importMeta.bangMarkedRotators.prefix(3).joined(separator: ", ")
        let extra = max(0, result.importMeta.bangMarkedRotators.count - 3)
        return extra > 0 ? "\(names), +\(extra)" : names
    }

    private var confirmTitle: String {
        result.replaceSourceId == nil ? result.mode.confirmTitle : "Replace Source"
    }

    private var isMissingRequiredMapping: Bool {
        !result.importMeta.headers.isEmpty && columnMapping["fullName"] == nil
    }

    private func mappingBinding(for key: String) -> Binding<Int> {
        Binding(
            get: { columnMapping[key] ?? -1 },
            set: { nextValue in
                if nextValue < 0 {
                    columnMapping.removeValue(forKey: key)
                } else {
                    columnMapping[key] = nextValue
                }
            }
        )
    }

    private func headerLabel(_ index: Int) -> String {
        let label = result.importMeta.headers[index].trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? "Column \(index + 1)" : label
    }
}

private struct RosterImportField: Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

private let rosterImportFields = [
    RosterImportField(key: "fullName", label: "Name"),
    RosterImportField(key: "program", label: "Program"),
    RosterImportField(key: "level", label: "Level"),
    RosterImportField(key: "startDate", label: "Start"),
    RosterImportField(key: "endDate", label: "End"),
    RosterImportField(key: "continuityClinic", label: "Clinic"),
    RosterImportField(key: "dayOff", label: "Day Off"),
    RosterImportField(key: "unavailableRanges", label: "Unavailable"),
]
