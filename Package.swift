// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PediatricSchedulerMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PediatricScheduler", targets: ["PediatricScheduler"])
    ],
    targets: [
        .executableTarget(
            name: "PediatricScheduler",
            path: "macos/PediatricScheduler",
            // The app icon is assembled into the .app by build_and_run.sh
            // (sips/iconutil); exclude it so SwiftPM doesn't treat the raw PNG
            // as an unhandled resource.
            exclude: ["Assets"]
        ),
        .testTarget(
            name: "PediatricSchedulerTests",
            dependencies: ["PediatricScheduler"],
            path: "macos/PediatricSchedulerTests"
        )
    ]
)
