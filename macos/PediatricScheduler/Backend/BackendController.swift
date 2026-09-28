import Foundation

/// Launches and supervises the local-only Python FastAPI backend, which is now
/// the app's engine (not just a static file server). Ported from the original
/// shell's BackendController with one change: the `dist/` requirement is gone —
/// the native UI no longer needs a built React bundle, only the Python engine.
final class BackendController {
    /// Loopback URL the backend binds. Kept in sync with build_and_run.sh's
    /// PORT and the backend's PEDI_SCHEDULER_BIND_HOST=127.0.0.1.
    static let baseURL = URL(string: "http://127.0.0.1:6174")!

    private var process: Process?
    private let stderrLock = NSLock()
    private var stderrTail: [String] = []

    /// Start the backend if it isn't already answering, then resolve once
    /// `/api/health` returns 200 (or fail after a bounded wait).
    func startIfNeeded(completion: @escaping (Result<Void, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let engineRoot = AppSupport.findRepoRoot() else {
                completion(.failure(AppError("Could not find the bundled scheduler engine.")))
                return
            }

            if self.runningBackendMatches(engineRoot: engineRoot) {
                completion(.success(()))
                return
            }

            if self.healthIsReady() {
                completion(.failure(AppError("Another Scheduler engine is already running. Quit the other Scheduler app, then retry.")))
                return
            }

            do {
                try self.start(engineRoot: engineRoot)
                for _ in 0..<40 {
                    if self.runningBackendMatches(engineRoot: engineRoot) {
                        completion(.success(()))
                        return
                    }
                    // The engine crashed during startup — fail now with its
                    // stderr instead of burning the rest of the 10s wait on a
                    // dead process.
                    if let process = self.process, !process.isRunning {
                        completion(.failure(AppError(self.startupFailureMessage(
                            "The local scheduling engine exited during startup."))))
                        return
                    }
                    Thread.sleep(forTimeInterval: 0.25)
                }
                completion(.failure(AppError(self.startupFailureMessage(
                    "The local scheduling engine did not become ready."))))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func startupFailureMessage(_ headline: String) -> String {
        stderrLock.lock()
        let tail = stderrTail.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        stderrLock.unlock()
        return tail.isEmpty ? headline : "\(headline)\n\n\(tail)"
    }

    func stop() {
        guard let process, process.isRunning else { return }
        process.terminate()
    }

    private func start(engineRoot: URL) throws {
        let python = engineRoot.appendingPathComponent("backend_py/.venv/bin/python")
        guard FileManager.default.isExecutableFile(atPath: python.path) else {
            throw AppError("Missing bundled Python environment. Rebuild the Scheduler app.")
        }

        let dataDir = AppSupport.dataDirectory()
        try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)

        var environment = ProcessInfo.processInfo.environment
        environment["PYTHONPATH"] = engineRoot.path
        environment["PEDI_SCHEDULER_BIND_HOST"] = "127.0.0.1"
        environment["PEDI_SCHEDULER_DATA_DIR"] = dataDir.path
        environment["PORT"] = "6174"
        let pythonHome = engineRoot.appendingPathComponent("backend_py/.venv", isDirectory: true)
        if FileManager.default.fileExists(atPath: pythonHome.appendingPathComponent("Python3").path) {
            environment["PYTHONHOME"] = pythonHome.path
        }

        let child = Process()
        child.currentDirectoryURL = engineRoot
        child.executableURL = python
        child.arguments = ["-m", "backend_py.run"]
        child.environment = environment

        // Keep the last few stderr lines so a startup crash produces an
        // actionable message instead of "did not become ready".
        stderrLock.lock()
        stderrTail = []
        stderrLock.unlock()
        let stderrPipe = Pipe()
        child.standardError = stderrPipe
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            self.stderrLock.lock()
            self.stderrTail.append(contentsOf: text.split(separator: "\n").map(String.init))
            if self.stderrTail.count > 12 {
                self.stderrTail.removeFirst(self.stderrTail.count - 12)
            }
            self.stderrLock.unlock()
        }

        try child.run()
        process = child
    }

    private func healthIsReady() -> Bool {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent("api/health"))
        request.timeoutInterval = 0.5

        let semaphore = DispatchSemaphore(value: 0)
        var ready = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            ready = (response as? HTTPURLResponse)?.statusCode == 200
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1)
        return ready
    }

    private func runningBackendMatches(engineRoot: URL) -> Bool {
        guard let runtime = runtimeInfo() else { return false }
        let expected = normalizedPath(engineRoot)
        return normalizedPath(URL(fileURLWithPath: runtime.engineRoot, isDirectory: true)) == expected
            && normalizedPath(URL(fileURLWithPath: runtime.cwd, isDirectory: true)) == expected
    }

    private func runtimeInfo() -> RuntimeInfo? {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent("api/runtime"))
        request.timeoutInterval = 0.5

        let semaphore = DispatchSemaphore(value: 0)
        var runtime: RuntimeInfo?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let engineRoot = object["engineRoot"] as? String,
                  let cwd = object["cwd"] as? String
            else {
                return
            }
            runtime = RuntimeInfo(engineRoot: engineRoot, cwd: cwd)
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1)
        return runtime
    }

    private func normalizedPath(_ url: URL) -> String {
        url.resolvingSymlinksInPath().standardizedFileURL.path
    }
}

private struct RuntimeInfo {
    let engineRoot: String
    let cwd: String
}
