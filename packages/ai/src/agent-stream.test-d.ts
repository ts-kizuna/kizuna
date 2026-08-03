import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { agentStream } from './agent-stream.js';
import { createTool, implementTool, type ToolsOf } from './tool.js';
import type { HandlerReturn } from '@ts-kizuna/core';

const LookupOrderTool = createTool({
    name: 'lookup_order',
    description: 'Look up an order by id.',
    input: z.object({
        orderId: z.string(),
    }),
    output: z.object({
        status: z.string(),
    }),
});

const SearchDocsTool = createTool({
    name: 'search_docs',
    description: 'Search the documentation.',
    input: z.object({
        query: z.string(),
    }),
    output: z.array(z.string()),
    expose: 'name-only',
});

const AuditAccessTool = createTool({
    name: 'audit_access',
    description: 'Record that the assistant read the account.',
    input: z.object({
        accountId: z.string(),
    }),
    output: z.void(),
    expose: 'none',
});

const chatEvents = agentStream({
    title: 'ChatEvent',
    tools: [LookupOrderTool, SearchDocsTool, AuditAccessTool],
});

type ChatEvent = z.infer<typeof chatEvents.event>;

test('the merged union carries the standard agent events', () => {
    expectTypeOf<{
        type: 'delta';
        text: string;
    }>().toExtend<ChatEvent>();
    expectTypeOf<{
        type: 'done';
        finishReason: string;
        inputTokens: number;
        outputTokens: number;
    }>().toExtend<ChatEvent>();
});

test("a 'full' tool carries its input and output payloads", () => {
    expectTypeOf<{
        type: 'tool_call';
        id: string;
        name: 'lookup_order';
        input: {
            orderId: string;
        };
    }>().toExtend<ChatEvent>();
    expectTypeOf<{
        type: 'tool_result';
        id: string;
        name: 'lookup_order';
        output: {
            status: string;
        };
    }>().toExtend<ChatEvent>();
});

test("a 'name-only' tool has no payload to read", () => {
    type SearchCall = Extract<ChatEvent, { type: 'tool_call'; name: 'search_docs' }>;
    expectTypeOf<SearchCall>().toEqualTypeOf<{
        type: 'tool_call';
        id: string;
        name: 'search_docs';
    }>();
});

test("a 'none' tool contributes no events", () => {
    expectTypeOf<Extract<ChatEvent, { name: 'audit_access' }>>().toBeNever();
});

test('an unknown tool name is not part of the union', () => {
    expectTypeOf<Extract<ChatEvent, { name: 'delete_order' }>>().toBeNever();
});

test('a handler must yield the merged union for a route using the response', () => {
    const route = {
        method: 'POST',
        path: '/chat',
        responses: {
            200: chatEvents,
        },
    } as const;

    type Return = HandlerReturn<typeof route>;
    expectTypeOf<Return>().toExtend<{
        status: 200;
    }>();
    // The handler's generator is typed against the same union the client reads.
    expectTypeOf<Return['stream']>().parameter(0).toBeCallableWith({ type: 'start' });
});

test('implementTool types its run from the declaration', () => {
    const lookup = implementTool(LookupOrderTool, (input) => {
        expectTypeOf(input).toEqualTypeOf<{
            orderId: string;
        }>();
        return {
            status: 'shipped',
        };
    });

    expectTypeOf(lookup.declaration.name).toEqualTypeOf<'lookup_order'>();
    // Exposure is about the wire, so a tool nobody sees still has a typed input.
    const audit = implementTool(AuditAccessTool, (input) => {
        expectTypeOf(input).toEqualTypeOf<{
            accountId: string;
        }>();
    });
    expectTypeOf(audit.declaration.expose).toEqualTypeOf<'none'>();
});

test('the declared tools of a response are recoverable', () => {
    expectTypeOf<ToolsOf<typeof chatEvents>>().toEqualTypeOf<
        readonly [typeof LookupOrderTool, typeof SearchDocsTool, typeof AuditAccessTool]
    >();
});

test('a custom event schema widens the union', () => {
    const withCustom = agentStream({
        title: 'SupportEvent',
        tools: [],
        event: z.object({
            type: z.literal('handoff'),
            queue: z.string(),
        }),
    });

    expectTypeOf<{
        type: 'handoff';
        queue: string;
    }>().toExtend<z.infer<typeof withCustom.event>>();
});
