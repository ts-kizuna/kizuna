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
        .target(
            name: "OpenEnumAPIClient",
            path: "Sources/OpenEnumAPIClient"
        ),
        .testTarget(
            name: "APIClientTests",
            dependencies: ["APIClient", "OpenEnumAPIClient"],
            path: "Tests/APIClientTests"
        ),
    ]
)
