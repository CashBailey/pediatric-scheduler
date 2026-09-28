import Foundation

enum RosterImportMode: String, CaseIterable, Identifiable {
    case merge
    case replace
    case add

    var id: String { rawValue }

    var title: String {
        switch self {
        case .merge: return "Merge"
        case .replace: return "Replace"
        case .add: return "Add"
        }
    }

    var confirmTitle: String {
        switch self {
        case .merge: return "Import"
        case .replace: return "Replace Roster"
        case .add: return "Add Rows"
        }
    }

    var summary: String {
        switch self {
        case .merge: return "Add new rotators and update matching names."
        case .replace: return "Replace the current rotator list with this file."
        case .add: return "Append every row, including duplicate names."
        }
    }
}
