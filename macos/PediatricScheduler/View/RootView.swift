import Foundation
import SwiftUI

/// Sidebar screens backed by live native SwiftUI surfaces.
enum Screen: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case rotators = "Rotators"
    case fellows = "Fellows"
    case sources = "Sources"
    case planning = "Planning Grid"
    case inpatient = "Inpatient"
    case outpatient = "Outpatient"
    case clinics = "Clinics"
    case reports = "Reports"
    case settings = "Settings"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .dashboard: return "gauge.with.dots.needle.33percent"
        case .rotators: return "person.3"
        case .fellows: return "star.fill"
        case .sources: return "tray.and.arrow.down"
        case .planning: return "calendar.day.timeline.left"
        case .inpatient: return "bed.double"
        case .outpatient: return "stethoscope"
        case .clinics: return "cross.case"
        case .reports: return "doc.text.magnifyingglass"
        case .settings: return "gearshape"
        }
    }

}

struct RootView: View {
    @EnvironmentObject var store: AppStore

    private var selection: Screen { store.screenSelection }

    var body: some View {
        NavigationSplitView {
            List(Screen.allCases, selection: $store.screenSelection) { screen in
                Label(screen.rawValue, systemImage: screen.systemImage)
                    .tag(screen)
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
            .navigationTitle("Scheduler")
        } detail: {
            detail
        }
        .onAppear {
            writeScreenProbeIfReady()
        }
        .onChange(of: store.scheduleFocus) { focus in
            guard let focus else { return }
            store.screenSelection = screen(for: focus.target)
            writeScreenProbeIfReady()
        }
        .onChange(of: store.screenSelection) { screen in
            // A banner produced on one screen would otherwise reappear out
            // of context on the next.
            store.lastMessage = nil
            writeScreenProbeIfReady(screen: screen)
        }
        .onChange(of: store.phase) { _ in
            writeScreenProbeIfReady()
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    Task { await store.undo() }
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .accessibilityIdentifier("scheduler-toolbar-undo")
                .disabled(!store.canUndo)
                .help("Undo last scheduler change")

                Button {
                    Task { await store.redo() }
                } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                }
                .accessibilityIdentifier("scheduler-toolbar-redo")
                .disabled(!store.canRedo)
                .help("Redo last scheduler change")
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch store.phase {
        case .starting:
            StatusView(icon: "hourglass", title: "Starting Scheduler…",
                       message: "Starting the local scheduling engine.")
        case .failed(let message):
            StatusView(icon: "exclamationmark.triangle", title: "Scheduler engine couldn't start",
                       message: message, isError: true) {
                Button("Retry") { store.boot() }
            }
        case .ready:
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .dashboard:
            DashboardView(
                onOpenSources: { store.screenSelection = .sources },
                onOpenRotators: { store.screenSelection = .rotators },
                onOpenReports: { store.screenSelection = .reports }
            )
        case .rotators:
            RotatorsView()
        case .fellows:
            FellowsView(
                onOpenSources: { store.screenSelection = .sources },
                onOpenRotators: { store.screenSelection = .rotators }
            )
        case .sources:
            SourcesView()
        case .planning:
            PlanningGridView()
        case .inpatient:
            InpatientView()
        case .outpatient:
            OutpatientView()
        case .clinics:
            ClinicsView()
        case .reports:
            ReportsView()
        case .settings:
            SettingsView()
        }
    }

    private func screen(for target: ScheduleFocusTarget) -> Screen {
        switch target {
        case .planning:
            return .planning
        case .inpatient:
            return .inpatient
        case .outpatient:
            return .outpatient
        case .clinics:
            return .clinics
        case .rotators:
            return .rotators
        }
    }

    private func writeScreenProbeIfReady(screen: Screen? = nil) {
        guard case .ready = store.phase else { return }
        NativeScreenProbe.write(screen: screen ?? selection, phase: store.phase, state: store.state)
    }
}

extension Screen {
    static var initialSelection: Screen {
        let raw = ProcessInfo.processInfo.environment["PEDI_SCHEDULER_INITIAL_SCREEN"]
            ?? UserDefaults.standard.string(forKey: "PEDI_SCHEDULER_INITIAL_SCREEN")
            ?? ""
        return matching(raw) ?? .dashboard
    }

    private static func matching(_ value: String) -> Screen? {
        let normalized = normalize(value)
        guard !normalized.isEmpty else { return nil }
        return allCases.first { screen in
            normalize(screen.rawValue) == normalized
                || normalize(String(describing: screen)) == normalized
        }
    }

    private static func normalize(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}

private enum NativeScreenProbe {
    static func write(screen: Screen, phase: AppStore.Phase, state: SchedulerState?) {
        let directory = AppSupport.dataDirectory()
        let output = directory.appendingPathComponent("native-ui-screen.json")
        let payload: [String: Any] = [
            "ok": true,
            "screen": screen.rawValue,
            "phase": phaseLabel(phase),
            "activeBlockId": state?.activeBlockId ?? "",
            "activeBlockName": state?.activeBlock?.name ?? "",
            "rotatorCount": state?.rotators.count ?? 0
        ]

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: output, options: [.atomic])
        } catch {
            NSLog("Failed to write native screen probe: \(error.localizedDescription)")
        }
    }

    private static func phaseLabel(_ phase: AppStore.Phase) -> String {
        switch phase {
        case .starting:
            return "starting"
        case .ready:
            return "ready"
        case .failed:
            return "failed"
        }
    }
}

/// Centered status/spinner panel for the boot + error states.
struct StatusView<Accessory: View>: View {
    let icon: String
    let title: String
    let message: String
    var isError: Bool = false
    @ViewBuilder var accessory: () -> Accessory

    init(icon: String, title: String, message: String, isError: Bool = false,
         @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }) {
        self.icon = icon
        self.title = title
        self.message = message
        self.isError = isError
        self.accessory = accessory
    }

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(isError ? .orange : .secondary)
            Text(title).font(.title3).bold()
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            accessory()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
