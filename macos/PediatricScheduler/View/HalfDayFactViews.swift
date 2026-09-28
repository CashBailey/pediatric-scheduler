import SwiftUI

struct HalfDayFactBadges: View {
    let facts: [HalfDayFact]
    let includeRotator: Bool
    let rotatorLabel: (String) -> String

    init(
        facts: [HalfDayFact],
        includeRotator: Bool = false,
        rotatorLabel: @escaping (String) -> String = { $0 }
    ) {
        self.facts = facts
        self.includeRotator = includeRotator
        self.rotatorLabel = rotatorLabel
    }

    var body: some View {
        FlexibleWrap(spacing: 4) {
            ForEach(facts) { fact in
                HalfDayFactBadge(
                    title: includeRotator ? "\(rotatorLabel(fact.rotatorId)) \(fact.shortLabel)" : fact.shortLabel,
                    fact: fact
                )
            }
        }
    }
}

private struct HalfDayFactBadge: View {
    let title: String
    let fact: HalfDayFact

    @State private var showingDetails = false

    var body: some View {
        Button {
            showingDetails.toggle()
        } label: {
            Label(title, systemImage: "circle.lefthalf.filled")
                .font(.caption2.bold())
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .foregroundStyle(tint)
                .background(tint.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(fact.helpText)
        .accessibilityHint("Open half-day source details.")
        .popover(isPresented: $showingDetails, arrowEdge: .bottom) {
            HalfDayFactDetailPopover(title: title, fact: fact, tint: tint)
        }
        .help("\(fact.helpText) - open for details")
    }

    private var accessibilityLabel: String {
        "Half-day fact: \(title)"
    }

    private var tint: Color {
        switch fact.status?.uppercased() {
        case "IP":
            return .green
        case "OP":
            return .blue
        default:
            return fact.kind == "inpatient-annotation" ? .orange : .purple
        }
    }
}

private struct HalfDayFactDetailPopover: View {
    let title: String
    let fact: HalfDayFact
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: "circle.lefthalf.filled")
                .font(.headline)
                .foregroundStyle(tint)
                .lineLimit(2)

            VStack(alignment: .leading, spacing: 6) {
                detailRow("Date", "\(fact.date) \(fact.period)")
                detailRow("Source", fact.sourceLabel)
                detailRow("Kind", fact.kind)
                if let status = clean(fact.status) {
                    detailRow("Status", status)
                }
                detailRow("Label", fact.displayLabel)
            }

            if let sourceText = clean(fact.sourceText) {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Text("Source text")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Text(sourceText)
                        .font(.caption)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(12)
        .frame(width: 280, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
                .frame(width: 56, alignment: .leading)
            Text(value)
                .font(.caption)
                .textSelection(.enabled)
                .lineLimit(3)
        }
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed.replacingOccurrences(of: "\n", with: " ")
    }
}
