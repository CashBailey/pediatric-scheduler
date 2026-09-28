import Foundation

/// Display-only calendar helpers for laying out the schedule grid. These
/// mirror the engine's UTC date math (parity-tested on the Python side) but
/// are used purely for rendering — the authoritative schedule always comes
/// from the backend, never from client-side date arithmetic.
enum CalendarUtil {
    static let weekdays = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]

    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    static func date(from iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var comps = DateComponents()
        comps.year = parts[0]
        comps.month = parts[1]
        comps.day = parts[2]
        return utcCalendar.date(from: comps)
    }

    static func weekdayName(_ iso: String) -> String {
        guard let d = date(from: iso) else { return "" }
        let weekday = utcCalendar.component(.weekday, from: d) // 1 = Sunday
        return weekdays[(weekday - 1) % 7]
    }

    static func isWeekend(_ iso: String) -> Bool {
        let name = weekdayName(iso)
        return name == "Saturday" || name == "Sunday"
    }

    /// Inclusive list of ISO dates from start to end; empty if end precedes start.
    static func dateRange(_ start: String, _ end: String) -> [String] {
        guard let startDate = date(from: start), let endDate = date(from: end) else { return [] }
        var out: [String] = []
        var cursor = startDate
        while cursor <= endDate {
            out.append(iso(cursor))
            guard let next = utcCalendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return out
    }

    private static func iso(_ date: Date) -> String {
        let c = utcCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// ISO date shifted by `days` (UTC math, matching the engine). Nil when
    /// the input is not a parseable date.
    static func addDays(_ isoDate: String, _ days: Int) -> String? {
        guard let start = date(from: isoDate),
              let shifted = utcCalendar.date(byAdding: .day, value: days, to: start)
        else { return nil }
        return iso(shifted)
    }

    /// True when the string is a yyyy-MM-dd date literal. Shared by the
    /// draft forms so free-text date fields validate consistently.
    static func isISODate(_ value: String) -> Bool {
        value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            && date(from: value) != nil
    }

    /// Today's date as yyyy-MM-dd in the user's local calendar. For
    /// "what should I look at now" UI only — schedule math stays UTC/backed
    /// by the engine.
    static func todayISO() -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Short "Mon Jul 6" style label for a day header.
    static func dayLabel(_ iso: String) -> String {
        let wd = weekdayName(iso)
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return iso }
        let months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let mon = (1...12).contains(month) ? months[month] : ""
        return "\(String(wd.prefix(3))) \(mon) \(day)"
    }

    /// Continuity-clinic periods ("AM"/"PM") a rotator holds on `weekday`,
    /// parsed from the freeform profile text (e.g. "Tuesday PM, Thursday AM").
    /// Grammar-parity port of backend_py/domain/draft.py
    /// parse_continuity_clinic_slots / continuity_periods_for_weekday — keep
    /// in lockstep so the grid badge always agrees with the backend's own
    /// continuity-conflict detection.
    static func continuityPeriods(_ text: String?, onWeekday weekday: String) -> [String] {
        guard let text, !text.isEmpty else { return [] }
        let chunks = text
            .replacingOccurrences(of: " and ", with: ",", options: [.caseInsensitive])
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        var periods: [String] = []
        for chunk in chunks where !chunk.isEmpty {
            let tokens = chunk.lowercased()
                .split(whereSeparator: { " /-".contains($0) })
                .map(String.init)
            var chunkWeekday: String?
            var chunkPeriod: String?
            for token in tokens {
                if chunkWeekday == nil {
                    if let match = weekdays.first(where: { name in
                        let lower = name.lowercased()
                        return lower == token || (token.count >= 3 && lower.hasPrefix(token))
                    }) {
                        chunkWeekday = match
                        continue
                    }
                }
                if chunkPeriod == nil {
                    if ["am", "a.m.", "morning"].contains(token) {
                        chunkPeriod = "AM"
                    } else if ["pm", "p.m.", "afternoon"].contains(token) {
                        chunkPeriod = "PM"
                    }
                }
            }
            if chunkWeekday == weekday, let period = chunkPeriod, !periods.contains(period) {
                periods.append(period)
            }
        }
        return periods
    }
}
