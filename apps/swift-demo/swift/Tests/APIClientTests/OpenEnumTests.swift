import XCTest
@testable import OpenEnumAPIClient

final class OpenEnumTests: XCTestCase {
    func testDecodesKnownValue() throws {
        let decoded = try JSONDecoder().decode(OpenEnumAPI.EventRecord.Kind.self, from: Data("\"login\"".utf8))
        XCTAssertEqual(decoded, .login)
    }

    func testFallsBackToUnknownInsteadOfThrowing() throws {
        let decoded = try JSONDecoder().decode(OpenEnumAPI.EventRecord.Kind.self, from: Data("\"teleport\"".utf8))
        XCTAssertEqual(decoded, .unknown("teleport"))
    }

    func testUnknownRawValueRoundTrips() throws {
        let encoded = try JSONEncoder().encode(OpenEnumAPI.EventRecord.Kind.unknown("teleport"))
        XCTAssertEqual(String(decoding: encoded, as: UTF8.self), "\"teleport\"")
    }

    func testUnknownValueDegradesOneFieldNotTheWholeObject() throws {
        let json = """
        {"id":"evt_1","kind":"teleport","occurredAt":"2026-01-01T00:00:00Z","userId":"user_1"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let record = try decoder.decode(OpenEnumAPI.EventRecord.self, from: Data(json.utf8))
        XCTAssertEqual(record.kind, .unknown("teleport"))
        XCTAssertEqual(record.id, "evt_1")
        XCTAssertEqual(record.userId, "user_1")
    }
}
