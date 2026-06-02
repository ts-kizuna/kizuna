import XCTest
@testable import APIClient

final class APIClientTests: XCTestCase {
    private var client: APIClient!

    override func setUp() async throws {
        try await super.setUp()
        let raw = ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "http://localhost:8000"
        guard let url = URL(string: raw) else {
            XCTFail("Invalid API_BASE_URL: \(raw)")
            return
        }
        client = APIClient(baseURL: url)
    }

    func testListUsersReturnsSeededUsers() async throws {
        let response = try await client.users.listUsers(page: 1, limit: 10)
        XCTAssertGreaterThanOrEqual(response.body.users.count, 2)
        XCTAssertGreaterThanOrEqual(response.body.total, 2)
        let names = response.body.users.map(\.name)
        XCTAssertTrue(names.contains("Ada Lovelace"), "expected Ada in seeded users; got \(names)")
        XCTAssertTrue(names.contains("Linus Torvalds"), "expected Linus in seeded users; got \(names)")
    }

    func testListUsersPagination() async throws {
        let firstPage = try await client.users.listUsers(page: 1, limit: 1)
        XCTAssertEqual(firstPage.body.users.count, 1)
        let secondPage = try await client.users.listUsers(page: 2, limit: 1)
        XCTAssertEqual(secondPage.body.users.count, 1)
        XCTAssertNotEqual(firstPage.body.users[0].id, secondPage.body.users[0].id)
    }

    func testGetUserReturnsSeededUser() async throws {
        let result = try await client.users.getUser(id: "1", xRequestIdHeader: "test-1")
        XCTAssertEqual(result.body.id, "1")
        XCTAssertEqual(result.body.name, "Ada Lovelace")
        XCTAssertEqual(result.body.email, "ada@example.com")
    }

    func testGetUserNotFoundThrowsTypedError() async throws {
        do {
            _ = try await client.users.getUser(id: "does-not-exist", xRequestIdHeader: "test-2")
            XCTFail("expected .notFound to be thrown")
        } catch .notFound(let payload) {
            XCTAssertFalse(payload.detail.isEmpty, "expected non-empty error message")
        } catch {
            XCTFail("expected GetUserFailure.notFound, got \(error)")
        }
    }

    func testCreateUserRoundTrip() async throws {
        let created = try await client.users.createUser(name: "Grace Hopper", email: "grace@example.com", last_name: "Hopper")
        XCTAssertFalse(created.body.id.isEmpty)
        XCTAssertEqual(created.body.name, "Grace Hopper")
        XCTAssertEqual(created.body.email, "grace@example.com")
        XCTAssertEqual(created.body.last_name, "Hopper")

        let fetched = try await client.users.getUser(id: created.body.id, xRequestIdHeader: "test-3")
        XCTAssertEqual(fetched.body, created.body)
    }

    func testSnakeCaseFieldDecodedFromSeed() async throws {
        let result = try await client.users.getUser(id: "1", xRequestIdHeader: "snake-decode")
        XCTAssertEqual(result.body.last_name, "Lovelace", "snake_case wire key 'last_name' must round-trip into Swift property 'last_name'")
    }

    @available(*, deprecated)
    func testDeleteUserRoundTrip() async throws {
        let created = try await client.users.createUser(name: "Temp User", email: "temp@example.com")
        let result = try await client.users.deleteUser(id: created.body.id)
        XCTAssertTrue(result.body.success)

        do {
            _ = try await client.users.getUser(id: created.body.id, xRequestIdHeader: "test-4")
            XCTFail("expected getUser of deleted id to throw")
        } catch .notFound {
            // expected
        } catch {
            XCTFail("expected GetUserFailure.notFound, got \(error)")
        }
    }

    @available(*, deprecated)
    func testDeleteUserNotFoundThrowsTypedError() async throws {
        do {
            _ = try await client.users.deleteUser(id: "missing-id")
            XCTFail("expected .notFound to be thrown")
        } catch .notFound(let payload) {
            XCTAssertFalse(payload.detail.isEmpty)
        } catch {
            XCTFail("expected DeleteUserFailure.notFound, got \(error)")
        }
    }

    func testResponseHeaderEchoedInResult() async throws {
        let result = try await client.users.getUser(id: "1", xRequestIdHeader: "trace-xyz-999")
        XCTAssertEqual(result.headers.xRequestId, "trace-xyz-999", "server must echo x-request-id back and client must expose it on Result")
    }

    func testHyphenatedHeaderSentWithWireName() async throws {
        let captured = CapturedRequest()
        let url = URL(string: ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "http://localhost:8000")!
        let testClient = APIClient(baseURL: url, responseMiddleware: { request, _, _ in
            await captured.set(request: request)
        })
        _ = try await testClient.users.getUser(id: "1", xRequestIdHeader: "trace-abc-123")
        let value = await captured.headerValue(for: "x-request-id")
        XCTAssertEqual(value, "trace-abc-123", "expected hyphenated header to be sent under its wire name")
    }

    func testRequestMiddlewareRuns() async throws {
        let counter = MiddlewareCounter()
        let url = URL(string: ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "http://localhost:8000")!
        let testClient = APIClient(baseURL: url, requestMiddleware: { request in
            await counter.increment()
            request.setValue("integration-test", forHTTPHeaderField: "X-Test-Source")
        })
        _ = try await testClient.users.listUsers(page: 1, limit: 1)
        let count = await counter.value
        XCTAssertEqual(count, 1)
    }

    func testSearchUsersCoercedQuery() async throws {
        let response = try await client.users.searchUsers(q: "ada", limit: 5, cursor: 0)
        XCTAssertGreaterThanOrEqual(response.body.users.count, 0)
    }

    func testSendNotificationEmail() async throws {
        let event = API.NotificationEvent.email(API.EmailEvent(
            channel: "email",
            to: "alice@example.com",
            subject: "Hello"
        ))
        let result = try await client.sendNotification(event)
        XCTAssertTrue(result.body.accepted)
    }

    func testSendNotificationSms() async throws {
        let event = API.NotificationEvent.sms(API.SmsEvent(
            channel: "sms",
            phone: "+1234567890",
            text: "Hi there"
        ))
        let result = try await client.sendNotification(event)
        XCTAssertTrue(result.body.accepted)
    }

    func testGetUserPathParamWithSlashIsEncoded() async throws {
        // Without percent-encoding, /users/a/b would not match the :id route and Express
        // returns its generic HTML 404 — surfacing as decoding/unexpectedStatus, not a typed error.
        // With encoding, the handler runs and returns the contract-shaped 404.
        do {
            _ = try await client.users.getUser(id: "a/b", xRequestIdHeader: "test-5")
            XCTFail("expected .notFound")
        } catch .notFound(let payload) {
            XCTAssertFalse(payload.detail.isEmpty)
        } catch {
            XCTFail("expected GetUserFailure.notFound for slash-id, got \(error)")
        }
    }

    func testListEventsDateQueryRoundTrip() async throws {
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let response = try await client.listEvents(since: date, kind: nil, ids: nil)
        guard let echoed = response.body.echo.since else {
            XCTFail("server did not echo `since` — query param missing")
            return
        }
        // echo.since is now Date (z.iso.datetime() → Date) — no manual parsing needed
        XCTAssertEqual(echoed.timeIntervalSince1970, date.timeIntervalSince1970, accuracy: 1.0)
    }

    func testDatetimeFieldDecodesAsDate() async throws {
        // occurredAt: z.iso.datetime() must arrive as Date, not String.
        // Server sends "2026-04-01T10:00:00.000Z" — fractional seconds path.
        let response = try await client.listEvents()
        guard let event = response.body.events.first else {
            XCTFail("expected at least one seeded event")
            return
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expected = formatter.date(from: "2026-04-01T10:00:00.000Z")!
        XCTAssertEqual(event.occurredAt.timeIntervalSince1970, expected.timeIntervalSince1970, accuracy: 0.001,
                       "occurredAt should decode from fractional-seconds ISO8601 to Date")
    }

    func testListEventsEnumQuerySerializesRawValue() async throws {
        let response = try await client.listEvents(since: nil, kind: .login, ids: nil)
        XCTAssertEqual(response.body.echo.kind, .login, "enum query param must round-trip via raw value, not case name")
    }

    func testListEventsArrayQueryRepeats() async throws {
        let ids = ["a", "b", "c"]
        let response = try await client.listEvents(since: nil, kind: nil, ids: ids)
        XCTAssertEqual(response.body.echo.ids, ids, "array query param must serialize as repeated entries, not bracketed string")
    }

    func testListEventsTransformQueryParam() async throws {
        // label uses z.string().transform() — the Swift client must accept String, not AnyCodable.
        let response = try await client.listEvents(since: nil, kind: nil, ids: nil, label: "hello")
        XCTAssertEqual(response.body.echo.label, "hello", "transform query param must round-trip")
    }

    func testListEventsUnionQueryParam() async throws {
        // tagIds uses z.union([z.array(z.string()), z.string().transform(...)]) — Swift client must
        // accept [String], not AnyCodable. Pass an array and verify the server echoes it back.
        let response = try await client.listEvents(since: nil, kind: nil, ids: nil, label: nil, tagIds: ["tag-a", "tag-b"])
        XCTAssertEqual(response.body.echo.tagIds, ["tag-a", "tag-b"], "union query param must round-trip as array")
    }

    func testArchiveUserSuccessSumType() async throws {
        let created = try await client.users.createUser(name: "Archive Target", email: "archive@example.com")
        let firstResult = try await client.users.archiveUser(id: created.body.id)
        switch firstResult.body {
        case .status201(let payload):
            XCTAssertEqual(payload.userId, created.body.id)
            XCTAssertLessThan(abs(payload.archivedAt.timeIntervalSinceNow), 5)
        case .status200:
            XCTFail("first archive should return 201, got 200")
        }
        let secondResult = try await client.users.archiveUser(id: created.body.id)
        switch secondResult.body {
        case .status200(let payload):
            XCTAssertEqual(payload.userId, created.body.id)
            XCTAssertTrue(payload.alreadyArchived)
        case .status201:
            XCTFail("second archive should return 200, got 201")
        }
    }

    func testPingUserVoidBodyAndResponse() async throws {
        // pingUser has body: z.void() and responses: { 204: z.void() }.
        // The generated method takes no body param and returns Void — this test
        // confirms the client compiles and the server handles the request.
        let created = try await client.users.createUser(name: "Ping Target", email: "ping@example.com")
        try await client.users.pingUser(id: created.body.id)
    }

    func testGetMyWorkSanitizedEnumAndVoidSuccessArm() async throws {
        // getMyWork has responses: { 200: { contentType: z.enum([...]) }, 204: z.void() }.
        // The 200 arm carries a body whose enum values ("image/jpeg", "3d-model", ...) are not
        // valid Swift identifiers, so the case names must be sanitized while the rawValue keeps
        // the original string. The 204 arm is a bare `.status204` case with no associated value.
        let result = try await client.users.getMyWork()
        switch result.body {
        case .status200(let payload):
            XCTAssertEqual(payload.contentType, .imageJpeg)
            XCTAssertEqual(payload.contentType.rawValue, "image/jpeg")
            XCTAssertFalse(payload.items.isEmpty)
            // exercise every sanitized case name so a regression in identifier sanitizing fails to compile
            XCTAssertEqual(APIClient.UsersGetMyWork.ResponseContentType.textPlain.rawValue, "text-plain")
            XCTAssertEqual(APIClient.UsersGetMyWork.ResponseContentType.videoMp4.rawValue, "video.mp4")
            XCTAssertEqual(APIClient.UsersGetMyWork.ResponseContentType._3dModel.rawValue, "3d-model")
        case .status204:
            XCTFail("expected 200 work items, got 204")
        }
    }

    func testHealthSubClientHistory() async throws {
        let result = try await client.health.history()
        XCTAssertGreaterThanOrEqual(result.body.count, 1)
        XCTAssertTrue(result.body[0].ok)
    }

    func testHealthSubClientCheck() async throws {
        let result = try await client.health.check()
        XCTAssertTrue(result.body.ok)
    }

    func testHealthSubClientVersion() async throws {
        let result = try await client.health.version()
        XCTAssertFalse(result.body.version.isEmpty)
    }

    func testHeadUserStripsBody() async throws {
        let created = try await client.users.createUser(name: "Head Target", email: "head@example.com")
        // checkUser is a HEAD route — the generated method returns Void, no body to decode.
        try await client.users.checkUser(id: created.body.id)
    }

    func testOptionsDescribeUsers() async throws {
        let result = try await client.users.describeUsers()
        XCTAssertFalse(result.body.allow.isEmpty)
    }

    func testWebhookAnyCodableBody() async throws {
        let json = try JSONSerialization.data(withJSONObject: ["event": "test", "count": 42])
        let payload = APIClient.AnyCodable(value: json)
        let result = try await client.webhook(payload)
        XCTAssertTrue(result.body.received)
    }

    func testUploadAvatarMultipartEncoding() async throws {
        // The express demo ships a stub for multipart (see CLAUDE.md). The contract validator
        // rejects with 400 because parsed form fields don't satisfy `z.instanceof(File)`. We
        // verify the client serialized and sent the request — not the server-side round-trip.
        let bytes = Data(repeating: 0xAB, count: 16)
        let file = APIClient.MultipartFile(data: bytes, filename: "avatar.bin", mimeType: "application/octet-stream")
        do {
            _ = try await client.users.uploadAvatar(file: file, userId: "1")
            XCTFail("expected .unexpectedStatus to be thrown")
        } catch let failure {
            switch failure {
            case .badRequest:
                break
            case .requestFailed(let underlying):
                XCTFail("multipart request should reach the server, got request failure: \(underlying)")
            default:
                XCTFail("expected .badRequest, got \(failure)")
            }
        }
    }
}

private actor MiddlewareCounter {
    var value: Int = 0
    func increment() { value += 1 }
}

private actor CapturedRequest {
    var request: URLRequest?
    func set(request: URLRequest) { self.request = request }
    func headerValue(for name: String) -> String? {
        request?.value(forHTTPHeaderField: name)
    }
}
