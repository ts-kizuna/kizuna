package com.kizuna.demo

import kotlinx.coroutines.test.runTest
import kotlin.test.*

class APIClientTest {
    private lateinit var client: APIClient

    @BeforeTest
    fun setUp() {
        val baseUrl = System.getenv("API_BASE_URL") ?: "http://localhost:8765"
        client = APIClient(baseUrl = baseUrl)
    }

    @Test
    fun testListUsersReturnsSeededUsers() = runTest {
        val response = client.users.listUsers {
            query(
                page = 1,
                limit = 10,
            )
        }
        assertTrue(response.body.users.size >= 2)
        assertTrue(response.body.total >= 2)
        val names = response.body.users.map { it.name }
        assertTrue("Ada Lovelace" in names)
        assertTrue("Linus Torvalds" in names)
    }

    @Test
    fun testListUsersPagination() = runTest {
        val first = client.users.listUsers {
            query(
                page = 1,
                limit = 1,
            )
        }
        val second = client.users.listUsers {
            query(
                page = 2,
                limit = 1,
            )
        }
        assertEquals(1, first.body.users.size)
        assertEquals(1, second.body.users.size)
        assertNotEquals(first.body.users[0].id, second.body.users[0].id)
    }

    @Test
    fun testGetUserReturnsSeededUser() = runTest {
        val response = client.users.getUser {
            params(
                id = "1",
            ).headers(
                xRequestId = "test-1",
            )
        }
        assertEquals("1", response.body.id)
        assertEquals("Ada Lovelace", response.body.name)
        assertEquals("ada@example.com", response.body.email)
    }

    @Test
    fun testGetUserNotFoundThrowsTypedError() = runTest {
        val failure = assertFailsWith<APIClient.UsersGetUser.Failure.NotFound> {
            client.users.getUser {
                params(
                    id = "does-not-exist",
                ).headers(
                    xRequestId = "test-2",
                )
            }
        }
        assertTrue(failure.body.detail.isNotEmpty())
    }

    @Test
    fun testCreateUserRoundTrip() = runTest {
        val response = client.users.createUser {
            body(
                name = "Grace Hopper",
                email = "grace@example.com",
                last_name = "Hopper",
            )
        }
        assertTrue(response.body.id.isNotEmpty())
        assertEquals("Grace Hopper", response.body.name)
        assertEquals("Hopper", response.body.last_name)
    }

    @Test
    fun testSnakeCaseFieldDecodedFromSeed() = runTest {
        val response = client.users.getUser {
            params(
                id = "1",
            ).headers(
                xRequestId = "snake-decode",
            )
        }
        assertEquals("Lovelace", response.body.last_name)
    }

    @Suppress("DEPRECATION")
    @Test
    fun testDeleteUserRoundTrip() = runTest {
        val created = client.users.createUser {
            body(
                name = "Temp User",
                email = "temp@example.com",
            )
        }
        val deleted = client.users.deleteUser {
            params(
                id = created.body.id,
            )
        }
        assertTrue(deleted.body.success)

        assertFailsWith<APIClient.UsersGetUser.Failure.NotFound> {
            client.users.getUser {
                params(
                    id = created.body.id,
                ).headers(
                    xRequestId = "test-4",
                )
            }
        }
    }

    @Test
    fun testResponseHeaderEchoedInResult() = runTest {
        val response = client.users.getUser {
            params(
                id = "1",
            ).headers(
                xRequestId = "trace-xyz-999",
            )
        }
        assertEquals("trace-xyz-999", response.headers.xRequestId)
    }

    @Test
    fun testSearchUsersCoercedQuery() = runTest {
        val response = client.users.searchUsers {
            query(
                q = "ada",
                limit = 5,
                cursor = 0,
            )
        }
        assertTrue(response.body.users.size >= 0)
    }

    @Test
    fun testSendNotificationEmail() = runTest {
        val event = API.NotificationEvent.Email(
            to = "alice@example.com",
            subject = "Hello"
        )
        val response = client.notifications.sendNotification {
            body(
                payload = event,
            )
        }
        assertTrue(response.body.accepted)
    }

    @Test
    fun testSendNotificationSms() = runTest {
        val event = API.NotificationEvent.Sms(
            phone = "+1234567890",
            text = "Hi there"
        )
        val response = client.notifications.sendNotification {
            body(
                payload = event,
            )
        }
        assertTrue(response.body.accepted)
    }

    @Test
    fun testListEventsEnumQuerySerializesRawValue() = runTest {
        val response = client.notifications.listEvents {
            query(
                kind = APIClient.NotificationsListEvents.QueryKind.LOGIN,
            )
        }
        assertEquals(APIClient.NotificationsListEvents.ResponseBodyEchoKind.LOGIN, response.body.echo.kind)
    }

    @Test
    fun testListEventsArrayQueryRepeats() = runTest {
        val eventIds = listOf("a", "b", "c")
        val response = client.notifications.listEvents {
            query(
                ids = eventIds,
            )
        }
        assertEquals(eventIds, response.body.echo.ids)
    }

    @Test
    fun testListEventsTransformQueryParam() = runTest {
        val response = client.notifications.listEvents {
            query(
                label = "hello",
            )
        }
        assertEquals("hello", response.body.echo.label)
    }

    @Test
    fun testListEventsUnionQueryParam() = runTest {
        val response = client.notifications.listEvents {
            query(
                tagIds = listOf("tag-a", "tag-b"),
            )
        }
        assertEquals(listOf("tag-a", "tag-b"), response.body.echo.tagIds)
    }

    @Test
    fun testArchiveUserMultiStatus() = runTest {
        val created = client.users.createUser {
            body(
                name = "Archive Target",
                email = "archive@example.com",
            )
        }

        when (
            val body = client.users.archiveUser {
                params(
                    id = created.body.id,
                )
            }.body
        ) {
            is APIClient.UsersArchiveUser.Success.Status201 -> assertEquals(created.body.id, body.body.userId)
            is APIClient.UsersArchiveUser.Success.Status200 -> fail("first archive should return 201")
        }

        when (
            val body = client.users.archiveUser {
                params(
                    id = created.body.id,
                )
            }.body
        ) {
            is APIClient.UsersArchiveUser.Success.Status200 -> {
                assertEquals(created.body.id, body.body.userId)
                assertTrue(body.body.alreadyArchived)
            }
            is APIClient.UsersArchiveUser.Success.Status201 -> fail("second archive should return 200")
        }
    }

    @Test
    fun testPingUserVoidBodyAndResponse() = runTest {
        val created = client.users.createUser {
            body(
                name = "Ping Target",
                email = "ping@example.com",
            )
        }
        client.users.pingUser {
            params(
                id = created.body.id,
            )
        }
    }

    @Test
    fun testHealthSubClientCheck() = runTest {
        val response = client.health.check()
        assertTrue(response.body.ok)
    }

    @Test
    fun testHealthSubClientVersion() = runTest {
        val response = client.health.version()
        assertTrue(response.body.version.isNotEmpty())
    }

    @Test
    fun testHealthSubClientHistory() = runTest {
        val response = client.health.history()
        assertTrue(response.body.size >= 1)
        assertTrue(response.body[0].ok)
    }

    @Test
    fun testHeadUserStripsBody() = runTest {
        val created = client.users.createUser {
            body(
                name = "Head Target",
                email = "head@example.com",
            )
        }
        client.users.checkUser {
            params(
                id = created.body.id,
            )
        }
    }

    @Test
    fun testCheckUserNotFoundThrows() = runTest {
        // HEAD responses carry no body (RFC 9110), so the 404 cannot decode into ProblemDetails —
        // it still surfaces as a typed Failure for this operation.
        assertFailsWith<APIClient.UsersCheckUser.Failure> {
            client.users.checkUser {
                params(
                    id = "does-not-exist",
                )
            }
        }
    }

    @Test
    fun testOptionsDescribeUsers() = runTest {
        val response = client.users.describeUsers()
        assertTrue(response.body.allow.isNotEmpty())
    }

    @Test
    fun testValidateConfigKeywordEscaping() = runTest {
        val response = client.notifications.validateConfig {
            body(
                default = "standard",
                interval = 30,
            )
        }
        assertEquals("ok", response.body.status)
    }

    @Test
    fun testGetUserPathParamWithSlashIsEncoded() = runTest {
        assertFailsWith<APIClient.UsersGetUser.Failure.NotFound> {
            client.users.getUser {
                params(
                    id = "a/b",
                ).headers(
                    xRequestId = "test-5",
                )
            }
        }
    }
}
