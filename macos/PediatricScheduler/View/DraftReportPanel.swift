import SwiftUI

struct DraftReportPanel: View {
    let report: DraftReport
    var onSetRotationStart: ((DraftReportCheck) -> Void)? = nil
    var onDismiss: () -> Void

    @State private var showAllChecks = false

    private static let collapsedLimit = 8

    private var visibleChecks: [DraftReportCheck] {
        showAllChecks ? report.checks : Array(report.checks.prefix(Self.collapsedLimit))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.headline)
                    Text(summaryLine)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .help("Dismiss draft report")
            }

            HStack(spacing: 8) {
                CountBadge(text: "\(report.summary.inpatientAdded) IP", color: .blue)
                CountBadge(text: "\(report.summary.outpatientAdded) OP", color: .green)
                CountBadge(text: "\(report.summary.errorCount) errors", color: report.summary.errorCount > 0 ? .orange : .secondary)
                CountBadge(text: "\(report.summary.warningCount) warnings", color: report.summary.warningCount > 0 ? .orange : .secondary)
                if report.unmetCount > 0 {
                    CountBadge(text: "\(report.unmetCount) unmet", color: .red)
                }
            }

            if report.checks.isEmpty {
                Label("No draft issues flagged.", systemImage: "checkmark.circle.fill")
                    .font(.callout)
                    .foregroundStyle(.green)
            } else if showAllChecks {
                ScrollView {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(visibleChecks) { check in
                            DraftReportCheckRow(check: check, onSetRotationStart: onSetRotationStart)
                        }
                    }
                }
                .frame(maxHeight: 280)
                Button("Show fewer checks") {
                    showAllChecks = false
                }
                .buttonStyle(.borderless)
                .font(.caption)
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(visibleChecks) { check in
                        DraftReportCheckRow(check: check, onSetRotationStart: onSetRotationStart)
                    }
                    if report.checks.count > visibleChecks.count {
                        Button("\(report.checks.count - visibleChecks.count) more checks") {
                            showAllChecks = true
                        }
                        .buttonStyle(.borderless)
                        .font(.caption)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private var title: String {
        report.summary.blockName.isEmpty ? "Draft Report" : "Draft Report - \(report.summary.blockName)"
    }

    private var summaryLine: String {
        "Filled \(report.summary.totalAdded) cells across \(report.summary.startDate) to \(report.summary.endDate)."
    }
}

private struct DraftReportCheckRow: View {
    let check: DraftReportCheck
    var onSetRotationStart: ((DraftReportCheck) -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: check.isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(check.isError ? .orange : .blue)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(check.message)
                    .font(.callout)
                    .lineLimit(3)
                if let date = check.date, !date.isEmpty {
                    Text(date)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if check.checkId == "methodist-no-start", check.rotatorId != nil, onSetRotationStart != nil {
                    Button("Set rotation start") {
                        onSetRotationStart?(check)
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                    .accessibilityIdentifier("draft-report-fix-rotation-start-\(check.rotatorId ?? "")")
                    .help("Open Rotators with this provider selected to set their Methodist rotation start date")
                }
            }
            Spacer(minLength: 0)
        }
    }
}
