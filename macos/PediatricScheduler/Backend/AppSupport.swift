import Foundation

/// App-support paths and repo discovery, extracted unchanged from the original
/// WKWebView shell. These are UI-independent — the native SwiftUI app reuses
/// them verbatim to locate the Python backend and its data directory.

enum AppSupport {
    /// Where the local-only scheduler state file lives. Matches the backend's
    /// PEDI_SCHEDULER_DATA_DIR default so the GUI and any CLI agree on one file.
    static func dataDirectory() -> URL {
        if let configured = configuredDataDirectory() {
            return configured
        }

        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        return base.appendingPathComponent("PediatricScheduler", isDirectory: true)
    }

    /// Locate the engine root (holds package.json + backend_py/). Packaged
    /// apps prefer the bundled Resources/Engine copy so they do not depend on
    /// the checkout path. Development builds fall back to RepoRoot.txt, then
    /// walking up from the executable.
    static func findRepoRoot() -> URL? {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("Engine", isDirectory: true),
           isRepoRoot(bundled) {
            return bundled
        }

        if let resourceURL = Bundle.main.url(forResource: "RepoRoot", withExtension: "txt"),
           let rawPath = try? String(contentsOf: resourceURL, encoding: .utf8) {
            let path = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
            let candidate = URL(fileURLWithPath: path, isDirectory: true)
            if isRepoRoot(candidate) {
                return candidate
            }
        }

        var current = Bundle.main.bundleURL
        for _ in 0..<10 {
            if isRepoRoot(current) {
                return current
            }
            current.deleteLastPathComponent()
        }
        return nil
    }

    private static func isRepoRoot(_ url: URL) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: url.appendingPathComponent("package.json").path)
            && fm.fileExists(atPath: url.appendingPathComponent("backend_py").path)
    }

    private static func configuredDataDirectory() -> URL? {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_DATA_DIR"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_DATA_DIR")
            ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let path = NSString(string: trimmed).expandingTildeInPath
        return URL(fileURLWithPath: path, isDirectory: true)
    }
}

struct AppError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
