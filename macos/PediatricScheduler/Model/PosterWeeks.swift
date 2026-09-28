import Foundation

/// Monday-anchored week bucketing for the weekly clinics grid.
///
/// Ports the week model from `shared/scheduler/poster-weeks.js`
/// (`buildPosterWeeks`): one "week" is a Monday-anchored group of the block's
/// weekday dates. Blocks are not Monday-aligned, so the first and last buckets
/// may hold fewer than five dates.
enum PosterWeeks {
    /// ISO date of the Monday on or before the given date.
    static func mondayOf(_ iso: String) -> String {
        var date = iso
        for _ in 0..<7 {
            if CalendarUtil.weekdayName(date) == "Monday" { return date }
            guard let previous = CalendarUtil.addDays(date, -1) else { return iso }
            date = previous
        }
        return iso
    }

    /// Groups sorted-or-unsorted ISO dates into Monday-anchored weeks,
    /// ordered by week start; dates within a week are sorted ascending.
    static func weekBuckets(_ dates: [String]) -> [[String]] {
        var byMonday: [String: [String]] = [:]
        for date in dates {
            byMonday[mondayOf(date), default: []].append(date)
        }
        return byMonday.keys.sorted().map { byMonday[$0]!.sorted() }
    }
}
