import SwiftUI

struct CoordinatorImportReviewSheet: View {
    let result: CoordinatorImportResult
    let isApplying: Bool
    /// Set by the presenter when a commit attempt fails, so the failure is
    /// visible inside the sheet instead of only in the occluded main window.
    var errorMessage: String? = nil
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Review Coordinator DOCX Import")
                        .font(.title2.bold())
                    Text("Master, inpatient roster, and outpatient assignment bundle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
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
                    Label("\(result.importedRotators) rotators", systemImage: "person.3")
                    Text("\(result.inpatientAssignments) inpatient assignments")
                        .foregroundStyle(.secondary)
                }
                GridRow {
                    Label("\(result.outpatientSessions) outpatient sessions", systemImage: "calendar")
                    Text("\(result.unresolvedNames) unresolved names")
                        .foregroundStyle(result.unresolvedNames > 0 ? .orange : .secondary)
                }
                GridRow {
                    Label("\(result.warningsCount) warnings", systemImage: "exclamationmark.triangle")
                    Text("Preview only; apply to replace the current scheduler state.")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.callout)

            if !result.sourceFiles.isEmpty {
                Divider()
                DisclosureGroup("Source Files") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(sourceFileRows, id: \.label) { row in
                            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                                GridRow {
                                    Text(row.label)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .frame(width: 86, alignment: .leading)
                                    Text(row.fileName)
                                        .font(.caption)
                                        .lineLimit(1)
                                }
                            }
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
                Button(role: .destructive) {
                    onConfirm()
                } label: {
                    if isApplying {
                        HStack(spacing: 7) {
                            ProgressView().controlSize(.small)
                            Text("Applying")
                        }
                    } else {
                        Label("Apply DOCX Import", systemImage: "checkmark")
                    }
                }
                .disabled(isApplying)
            }
        }
        .padding(22)
        .frame(width: 560)
    }

    private var sourceFileRows: [(label: String, fileName: String)] {
        ["master", "inpatient", "outpatient"].compactMap { key in
            guard let path = result.sourceFiles[key], !path.isEmpty else { return nil }
            return (label: key.capitalized, fileName: URL(fileURLWithPath: path).lastPathComponent)
        }
    }
}
