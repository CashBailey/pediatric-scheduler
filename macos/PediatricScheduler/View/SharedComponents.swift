import SwiftUI

// Shared small view helpers used across Dashboard, Fellows, Inpatient, and
// Planning Grid so a change to one visual convention (badge styling, source
// coloring, section headers, empty states) doesn't have to be re-applied by
// hand in every screen that copied it.

extension Color {
    /// Maps an assignment `source` string to its display color. Single
    /// source of truth for InpatientView's AssigneeChip and PlanningGridView's
    /// PlanningChip (previously copy-pasted `sourceColor` computed properties).
    static func assignmentSource(_ source: String?) -> Color {
        switch source {
        case "Manual": return .blue
        case "Auto-Draft": return .green
        case "Auto-Split": return .teal
        case "Auto-Methodist": return .purple
        case "Auto-Preassigned": return .indigo
        case "Range-Assigned": return .orange
        default: return .gray
        }
    }
}

/// Capsule badge with bold monospaced text on a tinted background. Was
/// triplicated as CountBadge/FellowStatBadge/DraftReportBadge.
struct CountBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.bold().monospacedDigit())
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
            .foregroundStyle(color)
    }
}

/// Plain secondary-text empty-state line, sentence case, no decorative
/// punctuation. Reused by Dashboard, Fellows, and Inpatient sections. Pass
/// `color` to keep a warning-weight tint (e.g. Inpatient's uncovered-day row)
/// instead of flattening every empty state to the same visual weight.
struct EmptyStateLine: View {
    let text: String
    var color: Color = .secondary

    var body: some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }
}

/// Headline + divider section wrapper shared by Dashboard and Fellows.
/// `innerSpacing` and `outerVerticalPadding` cover the two differences between
/// the call sites (Dashboard wraps content in an extra spaced VStack and adds
/// vertical padding around the whole section; Fellows does neither).
struct SectionContainer<Content: View>: View {
    let title: String
    let symbol: String
    var innerSpacing: CGFloat?
    var outerVerticalPadding: CGFloat = 0
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.headline)
            Divider()
            if let innerSpacing {
                VStack(alignment: .leading, spacing: innerSpacing) {
                    content()
                }
            } else {
                content()
            }
        }
        .padding(.vertical, outerVerticalPadding)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// One row of Expected Sources readiness (status icon, program name, detail),
/// with an optional trailing action button. Shared by Dashboard's Source
/// Readiness section and Settings' Expected Sources section so both stay in
/// sync with a single row layout.
struct SourceReadinessLine: View {
    let item: SourceProgramReadiness
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: item.symbol)
                .foregroundStyle(item.color)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.program)
                    .font(.callout.bold())
                    .lineLimit(1)
                Text(item.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.link)
                    .font(.caption)
            }
        }
    }
}
