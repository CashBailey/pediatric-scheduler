import SwiftUI
import AppKit

/// Native macOS entry point. Replaces the old WKWebView shell entirely: the UI
/// is SwiftUI, and the Python backend (launched by AppStore.boot) is the
/// engine. No web view, no bundled React.
final class SchedulerAppDelegate: NSObject, NSApplicationDelegate {
    override init() {
        UserDefaults.standard.register(defaults: [
            "ApplePersistenceIgnoreState": true,
            "NSQuitAlwaysKeepsWindows": false
        ])
        UserDefaults.standard.set(true, forKey: "ApplePersistenceIgnoreState")
        UserDefaults.standard.set(false, forKey: "NSQuitAlwaysKeepsWindows")
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        bringWindowsForward()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.bringWindowsForward()
        }
    }

    func application(_ application: NSApplication, shouldRestoreApplicationState coder: NSCoder) -> Bool {
        false
    }

    func application(_ application: NSApplication, shouldSaveApplicationState coder: NSCoder) -> Bool {
        false
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            sender.windows.first?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    private func bringWindowsForward() {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        NSApp.windows.forEach {
            $0.isRestorable = false
            $0.makeKeyAndOrderFront(nil)
        }
    }
}

@main
struct PediatricSchedulerApp: App {
    @NSApplicationDelegateAdaptor(SchedulerAppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore()

    var body: some Scene {
        Window("Pediatric Scheduler", id: "main") {
            RootView()
                .environmentObject(store)
                .frame(minWidth: 900, minHeight: 600)
                .background(DisableWindowRestorationView())
                .onAppear { store.boot() }
                .onDisappear { store.shutdown() }
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .undoRedo) {
                // While the user is editing text, ⌘Z must undo their typing,
                // not the last scheduler mutation — forward to the field
                // editor. The buttons stay enabled even with an empty
                // scheduler stack (undo()/redo() surface "Nothing to undo.")
                // so text undo keeps working.
                Button("Undo") {
                    if Self.isEditingText() {
                        NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
                    } else {
                        Task { await store.undo() }
                    }
                }
                .keyboardShortcut("z", modifiers: .command)

                Button("Redo") {
                    if Self.isEditingText() {
                        NSApp.sendAction(Selector(("redo:")), to: nil, from: nil)
                    } else {
                        Task { await store.redo() }
                    }
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }

            CommandGroup(after: .newItem) {
                Button("Reload Schedule") {
                    Task { await store.reload() }
                }
                .keyboardShortcut("r", modifiers: .command)
                // Mid-boot, reload would race boot()'s own load and flip a
                // transient failure into the boot-failure screen.
                .disabled(store.phase == .starting)
            }

            // ⌘1–⌘9 (and ⌘0 for the tenth screen) jump between sidebar
            // screens, as in Mail/Xcode/Finder.
            CommandGroup(after: .sidebar) {
                Divider()
                ForEach(Array(Screen.allCases.enumerated()), id: \.element) { index, screen in
                    Button(screen.rawValue) {
                        store.screenSelection = screen
                    }
                    .keyboardShortcut(KeyEquivalent(Character("\((index + 1) % 10)")), modifiers: .command)
                }
                Divider()
            }
        }
    }

    /// True while a text field / text view is first responder in the key
    /// window (the field editor is an NSTextView, which is an NSText).
    private static func isEditingText() -> Bool {
        NSApp.keyWindow?.firstResponder is NSText
    }
}

private struct DisableWindowRestorationView: NSViewRepresentable {
    final class Coordinator {
        var hasActivated = false
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        disableRestoration(for: view, coordinator: context.coordinator)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        disableRestoration(for: nsView, coordinator: context.coordinator)
    }

    private func disableRestoration(for view: NSView, coordinator: Coordinator) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.isRestorable = false
            // updateNSView re-runs on every store update; activate only on
            // first attach so a command finishing in the background doesn't
            // steal focus from whatever app the user switched to.
            if !coordinator.hasActivated {
                coordinator.hasActivated = true
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
            NativeWindowProbe.write(window: window)
        }
    }
}

private enum NativeWindowProbe {
    static func write(window: NSWindow) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-window.json")
        let payload: [String: Any] = [
            "ok": true,
            "appActive": NSApp.isActive,
            "windowAttached": true,
            "windowTitle": window.title,
            "isVisible": window.isVisible,
            "isKeyWindow": window.isKeyWindow,
            "isRestorable": window.isRestorable,
            "frame": NSStringFromRect(window.frame)
        ]

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native UI probe: \(error.localizedDescription)")
        }
    }
}
