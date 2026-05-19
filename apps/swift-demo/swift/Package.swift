// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "APIClient",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    targets: [
        .target(
            name: "APIClient",
            path: "Sources/APIClient"
        ),
        .testTarget(
            name: "APIClientTests",
            dependencies: ["APIClient"],
            path: "Tests/APIClientTests"
        ),
    ]
)
