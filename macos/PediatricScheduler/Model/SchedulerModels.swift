import Foundation

/// Swift projections of the scheduler-state.v1 contract.
///
/// These are DECODE-ONLY on purpose. In this architecture Python owns the
/// authoritative state and every mutation goes through the command endpoint;
/// Swift only reads state to render it. So the models declare just the fields
/// the UI consumes and let Codable ignore the rest — no need to round-trip
/// every field back, and schema drift in unmodeled fields can't break the
/// client. Undo/redo snapshots the raw JSON blob rather than re-encoding
/// these structs — see AppStore.

struct SchedulerState: Decodable {
    var version: Int
    var activeBlockId: String
    var serviceBlocks: [ServiceBlock]
    var sources: [SourceRecord]?
    var rotators: [Rotator]
    var inpatientAssignments: [InpatientAssignment]
    var outpatientSessions: [OutpatientSession]
    var halfDayFacts: [HalfDayFact]?
    var clinicAssignments: [ClinicAssignment]?
    var attendings: [Attending]?
    var expectedSourcePrograms: [String]?
    var rules: Rules?
    var posterSettings: PosterSettings?
    /// State-level caveats written by imports (e.g. Coordinator DOCX placeholder
    /// warnings). Distinct from PosterSettings.notes.
    var notes: [String]?

    var activeBlock: ServiceBlock? {
        serviceBlocks.first { $0.id == activeBlockId } ?? serviceBlocks.first
    }

    func rotator(_ id: String) -> Rotator? {
        rotators.first { $0.id == id }
    }

    /// Human label for a rotator id, falling back gracefully.
    func rotatorLabel(_ id: String) -> String {
        rotator(id)?.label ?? id
    }

    func halfDayFactsFor(date: String, rotatorId: String? = nil, period: String? = nil) -> [HalfDayFact] {
        (halfDayFacts ?? [])
            .filter { fact in
                fact.date == date
                    && (rotatorId == nil || fact.rotatorId == rotatorId)
                    && (period == nil || fact.period == period)
            }
            .sorted {
                if $0.period != $1.period { return $0.period < $1.period }
                if $0.rotatorId != $1.rotatorId { return $0.rotatorId < $1.rotatorId }
                return $0.displayLabel < $1.displayLabel
            }
    }
}

struct SourceRecord: Decodable, Identifiable {
    var id: String
    var importedAt: String?
    var status: String?
    var program: String?
    var fileName: String?
    var fileType: String?
    var content: String?
    var parsedRows: [[String: JSONValue]]
    var importedRotatorCount: Int?
    var importWarningCount: Int?
    var importWarnings: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case importedAt
        case status
        case program
        case fileName
        case fileType
        case content
        case parsedRows
        case importedRotatorCount
        case importWarningCount
        case importWarnings
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        importedAt = try container.decodeIfPresent(String.self, forKey: .importedAt)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        program = try container.decodeIfPresent(String.self, forKey: .program)
        fileName = try container.decodeIfPresent(String.self, forKey: .fileName)
        fileType = try container.decodeIfPresent(String.self, forKey: .fileType)
        content = try container.decodeIfPresent(String.self, forKey: .content)
        parsedRows = (try? container.decode([[String: JSONValue]].self, forKey: .parsedRows)) ?? []
        importedRotatorCount = Self.decodeFlexibleInt(container, forKey: .importedRotatorCount)
        importWarningCount = Self.decodeFlexibleInt(container, forKey: .importWarningCount)
        importWarnings = (try? container.decode([String].self, forKey: .importWarnings)) ?? []
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? "source-\((fileName ?? "unknown").lowercased())-\(importedAt ?? "undated")"
    }

    var displayName: String {
        fileName?.isEmpty == false ? fileName! : id
    }

    var typeLabel: String {
        fileType?.isEmpty == false ? fileType!.uppercased() : "SOURCE"
    }

    var isReviewed: Bool {
        guard let status, !status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return true
        }
        return status.localizedCaseInsensitiveContains("review")
    }

    var warningCount: Int {
        importWarningCount ?? importWarnings.count
    }

    var previewColumns: [String] {
        let columns = parsedRows.reduce(into: Set<String>()) { result, row in
            row.keys.forEach { result.insert($0) }
        }
        return columns.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private static func decodeFlexibleInt(_ container: KeyedDecodingContainer<CodingKeys>, forKey key: CodingKeys) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
            return Int(value)
        }
        if let value = try? container.decodeIfPresent(String.self, forKey: key) {
            return Int(value)
        }
        return nil
    }
}

enum JSONValue: Decodable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .number(Double(value))
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            self = .string("")
        }
    }

    var displayString: String {
        switch self {
        case .null:
            return ""
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            return value.rounded() == value ? String(Int(value)) : String(value)
        case .string(let value):
            return value
        case .array(let values):
            return values.map(\.displayString).filter { !$0.isEmpty }.joined(separator: ", ")
        case .object(let object):
            return object.keys.sorted().map { key in
                "\(key): \(object[key]?.displayString ?? "")"
            }.joined(separator: "; ")
        }
    }
}

struct ServiceBlock: Decodable, Identifiable {
    var id: String
    var name: String
    var startDate: String
    var endDate: String
    var status: String?
    var finalizedAt: String?
    var finalizedBy: String?
    var finalReview: BlockFinalReview?
    var postFinalChanges: [PostFinalChange]?
    var holidays: [Holiday]?
    var coverage: BlockCoverage?

    func inpatientCoverageTarget(on date: String) -> Int {
        let dayCoverage: CoverageDay?
        if holidayDates.contains(date) {
            dayCoverage = coverage?.holiday
        } else {
            switch CalendarUtil.weekdayName(date) {
            case "Saturday":
                dayCoverage = coverage?.saturday
            case "Sunday":
                dayCoverage = coverage?.sunday
            default:
                dayCoverage = coverage?.weekday
            }
        }
        return max(0, dayCoverage?.ip?.count ?? 2)
    }

    private var holidayDates: Set<String> {
        Set((holidays ?? []).filter(\.usesHolidayCoverage).map(\.date))
    }

    func coverageCount(for kind: CoverageKind) -> Int {
        let dayCoverage: CoverageDay?
        switch kind {
        case .weekday:
            dayCoverage = coverage?.weekday
        case .saturday:
            dayCoverage = coverage?.saturday
        case .sunday:
            dayCoverage = coverage?.sunday
        case .holiday:
            dayCoverage = coverage?.holiday
        }
        return max(0, dayCoverage?.ip?.count ?? 2)
    }
}

struct BlockFinalReview: Decodable {
    var reviewedAt: String?
    var criticalConflictCount: Int?
    var warningConflictCount: Int?
    var openSlots: Int?
    var missingSourcePrograms: [String]?
    var reason: String?
}

struct PostFinalChange: Decodable, Identifiable {
    var id: String
    var blockId: String?
    var changedAt: String?
    var changedBy: String?
    var command: String?
    var reason: String?
    var summary: String?

    enum CodingKeys: String, CodingKey {
        case id
        case blockId
        case changedAt
        case changedBy
        case command
        case reason
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        blockId = try container.decodeIfPresent(String.self, forKey: .blockId)
        changedAt = try container.decodeIfPresent(String.self, forKey: .changedAt)
        changedBy = try container.decodeIfPresent(String.self, forKey: .changedBy)
        command = try container.decodeIfPresent(String.self, forKey: .command)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? "\(command ?? "post-final")-\(changedAt ?? "undated")"
    }

    var displayReason: String {
        let trimmedReason = (reason ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedReason.isEmpty {
            return trimmedReason
        }
        let trimmedSummary = (summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSummary.isEmpty {
            return trimmedSummary
        }
        return command ?? "Post-final edit"
    }

    var displayMetadata: String {
        [changedAt, changedBy, command]
            .compactMap { value in
                let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
            .joined(separator: " - ")
    }
}

enum CoverageKind {
    case weekday
    case saturday
    case sunday
    case holiday
}

/// A holiday is either a bare ISO date string ("2026-07-03") or an object
/// ({date, noClinic, label}) depending on which path wrote it (DOCX import
/// emits strings; the block editor emits objects). Decode both so one shape
/// can't blank the whole schedule.
struct Holiday: Decodable {
    var date: String
    var noClinic: Bool?
    var label: String?
    var usesHolidayCoverage: Bool

    enum CodingKeys: String, CodingKey { case date, noClinic, label }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let dateString = try? single.decode(String.self) {
            date = dateString
            noClinic = nil
            label = nil
            usesHolidayCoverage = false
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        date = try container.decode(String.self, forKey: .date)
        noClinic = try container.decodeIfPresent(Bool.self, forKey: .noClinic)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        usesHolidayCoverage = true
    }
}

struct BlockCoverage: Decodable {
    var weekday: CoverageDay?
    var saturday: CoverageDay?
    var sunday: CoverageDay?
    var holiday: CoverageDay?
}

struct CoverageDay: Decodable {
    var ip: InpatientCoverage?
}

struct InpatientCoverage: Decodable {
    var count: Int?
    /// Per-role minimums set by the CLI/browser. Decoded so the native
    /// Settings form can echo them back instead of dropping them when it
    /// rebuilds the coverage payload.
    var byRole: [String: Int]?

    enum CodingKeys: String, CodingKey { case count, byRole }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let intValue = try? container.decodeIfPresent(Int.self, forKey: .count) {
            count = intValue
        } else if let doubleValue = try? container.decodeIfPresent(Double.self, forKey: .count) {
            count = Int(doubleValue)
        } else {
            count = nil
        }
        byRole = try? container.decodeIfPresent([String: Int].self, forKey: .byRole)
    }
}

struct Rotator: Decodable, Identifiable {
    var id: String
    var fullName: String?
    var displayName: String?
    var program: String?
    var level: String?
    var role: String?
    var schoolType: String?
    var segments: [RotatorSegment]?
    var continuityClinic: String?
    var rotationStartDate: String?
    var methodistStartSide: String?
    var dayOff: [String]?
    var unavailableRanges: [UnavailableRange]?

    var label: String { displayName ?? fullName ?? id }
    var isFellow: Bool { (role == "Fellow") || (level?.lowercased() == "fellow") }
    var isPediatricNeurologyFellow: Bool {
        guard isFellow else { return false }
        let normalizedProgram = (program ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedProgram.isEmpty || normalizedProgram == "other" || normalizedProgram.contains("pedi")
    }

    func isActive(on date: String) -> Bool {
        (segments ?? []).contains { segment in
            segment.start <= date && date <= segment.end
        }
    }
}

struct RotatorSegment: Decodable {
    var start: String
    var end: String
    var defaultPhase: String?
}

struct UnavailableRange: Decodable {
    var start: String
    var end: String
    var label: String?
}

struct InpatientAssignment: Decodable, Identifiable {
    var id: String
    var date: String
    var rotatorId: String
    var role: String?
    var source: String?
    var unsafeWholeDayMapping: Bool?
    var sourceText: String?

    /// "Off" days count as scheduled-off, not coverage — mirrors the engine's
    /// `role !== "Off"` headcount rule.
    var isOff: Bool { role == "Off" }
}

struct OutpatientSession: Decodable, Identifiable {
    var id: String
    var date: String
    var period: String
    var clinic: String?
    var provider: String?
    var rotatorId: String?
    var source: String?
    var status: String?
    var details: [OutpatientDetail]?
}

struct OutpatientDetail: Decodable {
    var clinic: String?
    var attending: String?
    var task: String?
    var notes: String?
}

struct HalfDayFact: Decodable, Identifiable {
    var id: String
    var date: String
    var period: String
    var rotatorId: String
    var kind: String
    var status: String?
    var label: String?
    var source: String?
    var sourceText: String?

    var displayLabel: String {
        let raw = (label ?? status ?? kind).trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.isEmpty ? "\(period) fact" : raw.replacingOccurrences(of: "\n", with: " ")
    }

    var shortLabel: String {
        let label = displayLabel
        if label.localizedCaseInsensitiveCompare(period) == .orderedSame {
            return period
        }
        if label.localizedCaseInsensitiveContains(period) {
            return label
        }
        return "\(period) \(label)"
    }

    var sourceLabel: String {
        let value = (source ?? kind).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Half-day fact" : value
    }

    var helpText: String {
        var parts = [sourceLabel, "\(date) \(period)", displayLabel]
        if let sourceText, !sourceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(sourceText.replacingOccurrences(of: "\n", with: " "))
        }
        return parts.joined(separator: " - ")
    }
}

struct ClinicAssignment: Decodable, Identifiable {
    var id: String
    var clinicOccurrenceId: String
    var rotatorId: String
    var date: String
    var session: String
    var source: String?
}

struct Attending: Decodable {
    var name: String
    var recurringClinics: [RecurringClinic]?
    var oneOffDates: [OneOffClinic]?
}

struct RecurringClinic: Decodable, Equatable {
    var id: String?
    var weekday: String?
    var period: String?
    var session: String?
    var clinicName: String?
    var location: String?
    var capacity: Int?
    var allowedRoles: [String]?
    var active: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case weekday
        case period
        case session
        case clinicName
        case location
        case capacity
        case allowedRoles
        case active
    }

    init(
        id: String? = nil,
        weekday: String?,
        period: String?,
        session: String?,
        clinicName: String? = nil,
        location: String? = nil,
        capacity: Int? = nil,
        allowedRoles: [String]? = nil,
        active: Bool? = nil
    ) {
        self.id = id
        self.weekday = weekday
        self.period = period
        self.session = session
        self.clinicName = clinicName
        self.location = location
        self.capacity = capacity
        self.allowedRoles = allowedRoles
        self.active = active
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        weekday = try container.decodeIfPresent(String.self, forKey: .weekday)
        period = try container.decodeIfPresent(String.self, forKey: .period)
        session = try container.decodeIfPresent(String.self, forKey: .session)
        clinicName = try container.decodeIfPresent(String.self, forKey: .clinicName)
        location = try container.decodeIfPresent(String.self, forKey: .location)
        capacity = Self.decodeFlexibleInt(container, forKey: .capacity)
        allowedRoles = try container.decodeIfPresent([String].self, forKey: .allowedRoles)
        active = try container.decodeIfPresent(Bool.self, forKey: .active)
    }

    var effectivePeriod: String {
        session ?? period ?? "AM"
    }

    private static func decodeFlexibleInt(_ container: KeyedDecodingContainer<CodingKeys>, forKey key: CodingKeys) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
            return Int(value)
        }
        if let value = try? container.decodeIfPresent(String.self, forKey: key) {
            return Int(value)
        }
        return nil
    }
}

struct OneOffClinic: Decodable, Equatable {
    var id: String?
    var date: String?
    var period: String?
    var session: String?
    var clinicName: String?
    var location: String?
    var capacity: Int?
    var allowedRoles: [String]?

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case period
        case session
        case clinicName
        case location
        case capacity
        case allowedRoles
    }

    init(
        id: String? = nil,
        date: String?,
        period: String?,
        session: String?,
        clinicName: String? = nil,
        location: String? = nil,
        capacity: Int? = nil,
        allowedRoles: [String]? = nil
    ) {
        self.id = id
        self.date = date
        self.period = period
        self.session = session
        self.clinicName = clinicName
        self.location = location
        self.capacity = capacity
        self.allowedRoles = allowedRoles
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        date = try container.decodeIfPresent(String.self, forKey: .date)
        period = try container.decodeIfPresent(String.self, forKey: .period)
        session = try container.decodeIfPresent(String.self, forKey: .session)
        clinicName = try container.decodeIfPresent(String.self, forKey: .clinicName)
        location = try container.decodeIfPresent(String.self, forKey: .location)
        capacity = Self.decodeFlexibleInt(container, forKey: .capacity)
        allowedRoles = try container.decodeIfPresent([String].self, forKey: .allowedRoles)
    }

    var effectivePeriod: String {
        session ?? period ?? "AM"
    }

    private static func decodeFlexibleInt(_ container: KeyedDecodingContainer<CodingKeys>, forKey key: CodingKeys) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
            return Int(value)
        }
        if let value = try? container.decodeIfPresent(String.self, forKey: key) {
            return Int(value)
        }
        return nil
    }
}

struct Rules: Decodable {
    var maxConsecutiveInpatientDays: Int?
    var honorNoClinicHolidays: Bool?
}

struct PosterSettings: Decodable, Equatable {
    var programName: String?
    var chief: String?
    var notes: [String]?
    var locations: [PosterLocation]?
    var tagline: String?

    static let fallback = PosterSettings(
        programName: "Pediatric Neurology Residency",
        chief: "",
        notes: [
            "Please arrive 15 minutes before clinic starts.",
            "Check Epic for patient lists and clinic location details.",
            "Notify the chief of any schedule conflicts as soon as possible.",
            "This schedule is subject to change.",
        ],
        locations: [PosterLocation(name: "Main Campus", address: "")],
        tagline: "Thank you for all you do for our patients!"
    )
}

struct PosterLocation: Decodable, Equatable {
    var name: String?
    var address: String?
}

struct DraftReport {
    var summary: DraftReportSummary
    var checks: [DraftReportCheck]
    var unmetCount: Int

    init(raw: [String: Any]) {
        summary = DraftReportSummary(raw: raw["summary"] as? [String: Any] ?? [:])
        let rawChecks = raw["checks"] as? [[String: Any]] ?? []
        checks = rawChecks.enumerated().map { index, item in
            DraftReportCheck(raw: item, index: index)
        }
        unmetCount = (raw["unmet"] as? [Any])?.count ?? 0
    }
}

struct DraftReportSummary {
    var blockName: String
    var startDate: String
    var endDate: String
    var inpatientAdded: Int
    var outpatientAdded: Int
    var errorCount: Int
    var warningCount: Int

    init(raw: [String: Any]) {
        blockName = raw["blockName"] as? String ?? ""
        startDate = raw["startDate"] as? String ?? ""
        endDate = raw["endDate"] as? String ?? ""
        inpatientAdded = Self.integer(raw["inpatientAdded"])
        outpatientAdded = Self.integer(raw["outpatientAdded"])
        errorCount = Self.integer(raw["errorCount"])
        warningCount = Self.integer(raw["warningCount"])
    }

    var totalAdded: Int {
        inpatientAdded + outpatientAdded
    }

    private static func integer(_ value: Any?) -> Int {
        if let intValue = value as? Int { return intValue }
        if let doubleValue = value as? Double { return Int(doubleValue) }
        if let numberValue = value as? NSNumber { return numberValue.intValue }
        if let stringValue = value as? String, let intValue = Int(stringValue) { return intValue }
        return 0
    }
}

struct DraftReportCheck: Identifiable {
    var id: String
    var checkId: String
    var severity: String
    var message: String
    var date: String?
    var dates: [String]
    var candidates: [String]
    var rotatorId: String?

    init(raw: [String: Any], index: Int) {
        let checkId = raw["id"] as? String ?? "check"
        let rawMessage = raw["message"] as? String ?? "Draft check needs review."
        self.checkId = checkId
        severity = raw["severity"] as? String ?? "warning"
        message = rawMessage
        date = raw["date"] as? String
        dates = Self.stringArray(raw["dates"])
        if dates.isEmpty, let date {
            dates = [date]
        }
        candidates = Self.stringArray(raw["candidates"])
        rotatorId = raw["rotatorId"] as? String
        id = "\(index)-\(checkId)-\(dates.first ?? date ?? "")"
    }

    var isError: Bool {
        severity == "error"
    }

    private static func stringArray(_ value: Any?) -> [String] {
        guard let values = value as? [Any] else { return [] }
        return values.compactMap { item in
            if let string = item as? String {
                return string
            }
            if let number = item as? NSNumber {
                return number.stringValue
            }
            return nil
        }
    }
}
