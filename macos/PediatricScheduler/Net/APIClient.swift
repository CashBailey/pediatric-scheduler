import Foundation

/// Thin async client for the local-only backend. All traffic is loopback
/// (127.0.0.1:6174); nothing leaves the machine.
struct APIClient {
    var baseURL: URL = BackendController.baseURL

    /// Loopback requests normally answer in milliseconds; the bound exists so
    /// a wedged backend surfaces as an error instead of a frozen UI. Generous
    /// enough for large roster/DOCX parses.
    static let requestTimeout: TimeInterval = 30

    enum APIError: LocalizedError {
        case badStatus(Int, body: String?)
        case badResponse
        case backendMessage(String)
        var errorDescription: String? {
            switch self {
            case .badStatus(let code, let body):
                if let body, !body.isEmpty {
                    return "Backend returned HTTP \(code): \(body)"
                }
                return "Backend returned HTTP \(code)."
            case .badResponse: return "Backend returned an unexpected response."
            case .backendMessage(let message): return message
            }
        }
    }

    /// GET /api/scheduler/state → decoded state.
    func getState() async throws -> SchedulerState {
        let data = try await getStateData()
        return try Self.decodeState(from: data)
    }

    /// GET /api/scheduler/state as raw bytes. Native undo/redo stores these
    /// snapshots so fields outside the Swift projection are preserved.
    func getStateData() async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: makeRequest("api/scheduler/state"))
        try Self.check(response, data: data)
        return data
    }

    /// GET /api/scheduler/state as raw JSON. Used for backup export so Swift
    /// does not need to round-trip fields it does not render.
    func getStateObject() async throws -> Any {
        let data = try await getStateData()
        return try JSONSerialization.jsonObject(with: data)
    }

    /// POST /api/scheduler/state with raw scheduler-state JSON. Used by
    /// import flows that receive a full validated state preview from Python.
    func writeStateObject(_ stateObject: Any) async throws {
        guard JSONSerialization.isValidJSONObject(stateObject) else {
            throw APIError.badResponse
        }
        var request = makeRequest("api/scheduler/state", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: stateObject)

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
    }

    /// POST /api/scheduler/state with raw scheduler-state JSON bytes. Used by
    /// native undo/redo, which snapshots the backend's authoritative JSON.
    func writeStateData(_ data: Data) async throws {
        var request = makeRequest("api/scheduler/state", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data

        let (responseData, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: responseData)
    }

    /// POST /api/scheduler/command. Returns the command envelope; on a mutation
    /// the envelope's `state` is the new authoritative state. `input` is an
    /// arbitrary JSON object (e.g. `["patch": ["maxConsecutiveInpatientDays": 9]]`),
    /// so it's serialized with JSONSerialization rather than Codable.
    @discardableResult
    func command(type: String, input: [String: Any] = [:]) async throws -> CommandResult {
        var request = makeRequest("api/scheduler/command", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["type": type, "input": input])

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
        return try CommandResult(data: data)
    }

    /// Parse the known local Coordinator DOCX bundle from this user's Downloads. The backend
    /// returns a validated state preview; callers decide whether to persist it.
    func importDefaultCoordinatorDocxPreview() async throws -> CoordinatorImportResult {
        let request = makeRequest("api/import/coordinator-docx/default", method: "POST")

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
        return try CoordinatorImportResult(data: data)
    }

    /// Parse a user-selected local Coordinator DOCX bundle. Only file paths are
    /// sent to the loopback backend; the files never leave this machine.
    func importCoordinatorDocxPreview(masterPath: String, inpatientPath: String, outpatientPath: String) async throws -> CoordinatorImportResult {
        var request = makeRequest("api/import/coordinator-docx", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "masterPath": masterPath,
            "inpatientPath": inpatientPath,
            "outpatientPath": outpatientPath,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
        return try CoordinatorImportResult(data: data)
    }

    /// Parse a user-selected local roster file into a scheduler-state preview.
    func importRosterPreview(
        filePath: String,
        mode: String = RosterImportMode.merge.rawValue,
        replaceSourceId: String? = nil,
        columnMapping: [String: Int]? = nil,
        matrixBangBehavior: String = "present"
    ) async throws -> RosterImportResult {
        var request = makeRequest("api/import/roster", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "filePath": filePath,
            "mode": mode,
            "matrixBangBehavior": matrixBangBehavior,
        ]
        if let replaceSourceId, !replaceSourceId.isEmpty {
            body["replaceSourceId"] = replaceSourceId
        }
        if let columnMapping, !columnMapping.isEmpty {
            body["columnMapping"] = columnMapping
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data: data)
        return try RosterImportResult(data: data, mode: mode, replaceSourceId: replaceSourceId)
    }

    private func url(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    private func makeRequest(_ path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: url(path))
        request.httpMethod = method
        request.timeoutInterval = Self.requestTimeout
        return request
    }

    private static func check(_ response: URLResponse, data: Data? = nil) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = object["error"] as? String {
                if let missing = object["missing"] as? [String], !missing.isEmpty {
                    throw APIError.backendMessage("\(message): \(missing.joined(separator: ", "))")
                }
                throw APIError.backendMessage(message)
            }
            // Non-JSON error body (proxy page, traceback, plain text): keep a
            // short snippet so the failure is diagnosable from the UI message.
            let snippet = data.flatMap { String(data: $0.prefix(200), encoding: .utf8) }?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw APIError.badStatus(http.statusCode, body: snippet?.isEmpty == false ? snippet : nil)
        }
    }

    static func decodeState(from data: Data) throws -> SchedulerState {
        try JSONDecoder().decode(SchedulerState.self, from: data)
    }
}

struct CoordinatorImportResult: Identifiable {
    let id = UUID()
    let stateObject: Any
    let sourceFiles: [String: String]
    let importedRotators: Int
    let inpatientAssignments: Int
    let outpatientSessions: Int
    let unresolvedNames: Int
    let warningsCount: Int
    let warnings: [String]

    init(data: Data) throws {
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let preview = object["schedulerStatePreview"],
            JSONSerialization.isValidJSONObject(preview)
        else {
            throw APIClient.APIError.badResponse
        }
        let acceptance = object["acceptance"] as? [String: Any] ?? [:]
        let warnings = object["warnings"] as? [Any] ?? []
        stateObject = preview
        sourceFiles = (object["sourceFiles"] as? [String: Any] ?? [:]).reduce(into: [:]) { result, item in
            result[item.key] = String(describing: item.value)
        }
        importedRotators = acceptance["rotators"] as? Int ?? 0
        inpatientAssignments = acceptance["inpatientAssignments"] as? Int ?? 0
        outpatientSessions = acceptance["outpatientSessions"] as? Int ?? 0
        unresolvedNames = acceptance["unresolvedNames"] as? Int ?? 0
        warningsCount = warnings.count
        self.warnings = warnings.map { String(describing: $0) }
    }
}

struct RosterImportResult: Identifiable {
    let id = UUID()
    let stateObject: Any
    let sourceFile: String
    let mode: RosterImportMode
    let replaceSourceId: String?
    let importMeta: RosterImportMetadata
    let added: Int
    let updated: Int
    let removed: Int
    let warningsCount: Int
    let warnings: [String]
    let columnsFound: [String]
    let rows: Int

    var fileName: String {
        URL(fileURLWithPath: sourceFile).lastPathComponent
    }

    init(data: Data, mode: String, replaceSourceId: String? = nil) throws {
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let preview = object["schedulerStatePreview"],
            JSONSerialization.isValidJSONObject(preview)
        else {
            throw APIClient.APIError.badResponse
        }
        let acceptance = object["acceptance"] as? [String: Any] ?? [:]
        stateObject = preview
        sourceFile = object["sourceFile"] as? String ?? ""
        self.mode = RosterImportMode(rawValue: mode) ?? .merge
        self.replaceSourceId = (object["replaceSourceId"] as? String) ?? replaceSourceId
        importMeta = RosterImportMetadata(raw: object["importMeta"] as? [String: Any])
        added = acceptance["added"] as? Int ?? 0
        updated = acceptance["updated"] as? Int ?? 0
        removed = acceptance["removed"] as? Int ?? 0
        warningsCount = acceptance["warnings"] as? Int ?? 0
        warnings = (object["warnings"] as? [Any] ?? []).map { String(describing: $0) }
        columnsFound = (object["columnsFound"] as? [Any] ?? []).map { String(describing: $0) }
        rows = acceptance["rows"] as? Int ?? 0
    }
}

struct RosterImportMetadata {
    let isMatrix: Bool
    let matrixBangBehavior: String
    let bangMarkedRotators: [String]
    let headers: [String]
    let detectedMapping: [String: Int]
    let columnMapping: [String: Int]
    let headerRowIndex: Int

    init(raw: [String: Any]?) {
        isMatrix = raw?["isMatrix"] as? Bool ?? false
        matrixBangBehavior = raw?["matrixBangBehavior"] as? String ?? "present"
        bangMarkedRotators = (raw?["bangMarkedRotators"] as? [Any] ?? []).map { String(describing: $0) }
        headers = (raw?["headers"] as? [Any] ?? []).map { String(describing: $0) }
        detectedMapping = Self.intMap(raw?["detectedMapping"] as? [String: Any])
        columnMapping = Self.intMap(raw?["columnMapping"] as? [String: Any])
        headerRowIndex = raw?["headerRowIndex"] as? Int ?? 0
    }

    private static func intMap(_ raw: [String: Any]?) -> [String: Int] {
        var out: [String: Int] = [:]
        for (key, value) in raw ?? [:] {
            if let intValue = value as? Int {
                out[key] = intValue
            } else if let number = value as? NSNumber {
                out[key] = number.intValue
            }
        }
        return out
    }
}

/// Decoded command envelope. `ok`/`changed`/`message` are read from the
/// envelope; `state` is decoded separately (present only on mutating success)
/// so a command-level failure (ok=false) still parses.
struct CommandResult {
    let ok: Bool
    let changed: Bool
    let message: String?
    let data: [String: Any]
    let state: SchedulerState?
    /// Raw bytes of the nested `state` payload when the backend sends one.
    /// AppStore caches these even if Swift cannot decode the typed projection.
    let stateData: Data?
    /// True when the backend sent a `state` payload Swift could not decode.
    /// The command still succeeded on the backend, but the UI is now stale.
    let stateDecodeFailed: Bool

    let errorMessage: String?

    init(data: Data) throws {
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        ok = object["ok"] as? Bool ?? false
        changed = object["changed"] as? Bool ?? false
        message = object["message"] as? String
        self.data = object["data"] as? [String: Any] ?? [:]
        errorMessage = (object["error"] as? [String: Any])?["message"] as? String

        // Re-decode the nested `state` (if present) into the typed model.
        if let stateObject = object["state"], JSONSerialization.isValidJSONObject(stateObject) {
            let encoded = try JSONSerialization.data(withJSONObject: stateObject)
            state = try? JSONDecoder().decode(SchedulerState.self, from: encoded)
            stateData = encoded
            stateDecodeFailed = state == nil
        } else {
            state = nil
            stateData = nil
            stateDecodeFailed = false
        }
    }
}
