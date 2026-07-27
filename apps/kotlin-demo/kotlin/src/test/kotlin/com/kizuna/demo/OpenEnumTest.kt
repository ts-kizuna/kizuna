package com.kizuna.demo

import com.kizuna.demo.openenum.OpenEnumAPI
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class OpenEnumTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesKnownValue() {
        val decoded = json.decodeFromString(OpenEnumAPI.EventRecord.Kind.Serializer, "\"login\"")
        assertEquals(OpenEnumAPI.EventRecord.Kind.LOGIN, decoded)
    }

    @Test
    fun fallsBackToUnknownInsteadOfThrowing() {
        val decoded = json.decodeFromString(OpenEnumAPI.EventRecord.Kind.Serializer, "\"teleport\"")
        assertEquals(OpenEnumAPI.EventRecord.Kind.Unknown("teleport"), decoded)
    }

    @Test
    fun unknownWireValueRoundTrips() {
        val encoded = json.encodeToString(
            OpenEnumAPI.EventRecord.Kind.Serializer,
            OpenEnumAPI.EventRecord.Kind.Unknown("teleport"),
        )
        assertEquals("\"teleport\"", encoded)
    }

    @Test
    fun unknownValueDegradesOneFieldNotTheWholeObject() {
        val payload = """{"id":"evt_1","kind":"teleport","occurredAt":"2026-01-01T00:00:00Z","userId":"user_1"}"""
        val record = json.decodeFromString(OpenEnumAPI.EventRecord.serializer(), payload)
        assertEquals(OpenEnumAPI.EventRecord.Kind.Unknown("teleport"), record.kind)
        assertEquals("evt_1", record.id)
        assertEquals("user_1", record.userId)
    }
}
