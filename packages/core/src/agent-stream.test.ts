import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModel } from './model.js';
import { createTool } from './tool.js';
import { streamWithTools } from './agent-stream.js';
import { isDiscriminatedUnionSchema, readDiscriminatedUnion, readMetaId } from './zod-internals.js';

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

const variantTitles = (definition: { event: unknown }): string[] => {
    const union = readDiscriminatedUnion(definition.event as never);
    return (union?.options ?? []).map((option) => readMetaId(option) ?? '<untitled>');
};

describe('createTool', () => {
    it('defaults the codegen title to the name in PascalCase and exposure to full', () => {
        expect(LookupOrderTool.title).toBe('LookupOrder');
        expect(LookupOrderTool.expose).toBe('full');
    });

    it('keeps an explicit title', () => {
        const tool = createTool({
            name: 'lookup_order',
            title: 'OrderLookup',
            description: 'Look up an order by id.',
            input: z.object({}),
            output: z.object({}),
        });
        expect(tool.title).toBe('OrderLookup');
    });
});

describe('streamWithTools', () => {
    it('returns an sse response whose events are named after their type field', () => {
        const response = streamWithTools({
            title: 'ChatEvent',
            tools: [LookupOrderTool],
        });

        expect(response.stream).toBe('sse');
        expect(response.eventName).toBe('type');
        expect(response.tools).toEqual([LookupOrderTool]);
        expect(readMetaId(response.event as never)).toBe('ChatEvent');
    });

    it('accepts every standard agent event', () => {
        const { event } = streamWithTools({
            title: 'ChatEvent',
            tools: [LookupOrderTool],
        });

        expect(event.safeParse({ type: 'start' }).success).toBe(true);
        expect(event.safeParse({ type: 'reasoning', text: 'weighing options' }).success).toBe(true);
        expect(event.safeParse({ type: 'delta', text: 'hello' }).success).toBe(true);
        expect(
            event.safeParse({
                type: 'done',
                finishReason: 'stop',
                inputTokens: 12,
                outputTokens: 40,
            }).success
        ).toBe(true);
        expect(event.safeParse({ type: 'aborted', reason: 'client disconnected' }).success).toBe(true);
    });

    it('derives call, result and error events for each declared tool', () => {
        const { event } = streamWithTools({
            title: 'ChatEvent',
            tools: [LookupOrderTool],
        });

        expect(
            event.safeParse({
                type: 'tool_call',
                id: 'call_1',
                name: 'lookup_order',
                input: {
                    orderId: 'ord_1',
                },
            }).success
        ).toBe(true);
        expect(
            event.safeParse({
                type: 'tool_result',
                id: 'call_1',
                name: 'lookup_order',
                output: {
                    status: 'shipped',
                },
            }).success
        ).toBe(true);
        expect(
            event.safeParse({
                type: 'tool_error',
                id: 'call_1',
                name: 'lookup_order',
                message: 'order service timed out',
            }).success
        ).toBe(true);
    });

    it('rejects a tool event naming a tool that was never declared', () => {
        const { event } = streamWithTools({
            title: 'ChatEvent',
            tools: [LookupOrderTool],
        });

        expect(
            event.safeParse({
                type: 'tool_call',
                id: 'call_1',
                name: 'delete_order',
                input: {},
            }).success
        ).toBe(false);
    });

    it('titles tool variants from the tool, so a shared tool contributes one set of models', () => {
        const response = streamWithTools({
            title: 'ChatEvent',
            tools: [LookupOrderTool],
        });

        expect(variantTitles(response)).toEqual([
            'ChatEventStart',
            'ChatEventReasoning',
            'ChatEventDelta',
            'ChatEventDone',
            'ChatEventAborted',
            'LookupOrderCall',
            'LookupOrderResult',
            'LookupOrderError',
        ]);
    });

    it('rejects the same tool name twice', () => {
        const other = createTool({
            name: 'lookup_order',
            title: 'OrderLookup',
            description: 'A second tool with a colliding name.',
            input: z.object({}),
            output: z.object({}),
        });

        expect(() =>
            streamWithTools({
                title: 'ChatEvent',
                tools: [LookupOrderTool, other],
            })
        ).toThrow(/declares the tool 'lookup_order' twice/);
    });

    describe('expose', () => {
        it("omits the payloads but keeps the events under 'name-only'", () => {
            const { event } = streamWithTools({
                title: 'SearchEvent',
                tools: [
                    createTool({
                        name: 'search_docs',
                        description: 'Search the documentation.',
                        input: z.object({
                            query: z.string(),
                        }),
                        output: z.array(z.string()),
                        expose: 'name-only',
                    }),
                ],
            });

            const call = event.safeParse({
                type: 'tool_call',
                id: 'call_1',
                name: 'search_docs',
                input: {
                    query: 'sse',
                },
            });
            expect(call.success).toBe(true);
            expect(call.data).toEqual({
                type: 'tool_call',
                id: 'call_1',
                name: 'search_docs',
            });

            const result = event.safeParse({
                type: 'tool_result',
                id: 'call_1',
                name: 'search_docs',
                output: ['a hit'],
            });
            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                type: 'tool_result',
                id: 'call_1',
                name: 'search_docs',
            });
        });

        it("emits no variants at all under 'none'", () => {
            const response = streamWithTools({
                title: 'AuditEvent',
                tools: [
                    createTool({
                        name: 'audit_access',
                        description: 'Record that the account was read.',
                        input: z.object({
                            accountId: z.string(),
                        }),
                        output: z.void(),
                        expose: 'none',
                    }),
                ],
            });

            expect(variantTitles(response)).toEqual([
                'AuditEventStart',
                'AuditEventReasoning',
                'AuditEventDelta',
                'AuditEventDone',
                'AuditEventAborted',
            ]);
            expect(
                response.event.safeParse({
                    type: 'tool_call',
                    id: 'call_1',
                    name: 'audit_access',
                }).success
            ).toBe(false);
        });
    });

    describe('merging the author event schema', () => {
        it('flattens a discriminated union into the merged union', () => {
            const response = streamWithTools({
                title: 'ChatEvent',
                tools: [],
                event: z.discriminatedUnion('type', [
                    createTitledVariant('ChatEventQuotaWarning', 'quota_warning'),
                    createTitledVariant('ChatEventHandoff', 'handoff'),
                ]),
            });

            expect(variantTitles(response)).toContain('ChatEventQuotaWarning');
            expect(variantTitles(response)).toContain('ChatEventHandoff');
            expect(response.event.safeParse({ type: 'handoff', detail: 'to a human' }).success).toBe(true);
            expect(isDiscriminatedUnionSchema(response.event as never)).toBe(true);
        });

        it('keeps a single object variant as itself', () => {
            const { event } = streamWithTools({
                title: 'ChatEvent',
                tools: [],
                event: z.object({
                    type: z.literal('quota_warning'),
                    remaining: z.int(),
                }),
            });

            expect(event.safeParse({ type: 'quota_warning', remaining: 3 }).success).toBe(true);
        });

        it('falls back to a plain union when a variant does not discriminate on type', () => {
            const response = streamWithTools({
                title: 'ChatEvent',
                tools: [],
                event: z.object({
                    kind: z.literal('quota_warning'),
                }),
            });

            expect(isDiscriminatedUnionSchema(response.event as never)).toBe(false);
            expect(response.event.safeParse({ kind: 'quota_warning' }).success).toBe(true);
            expect(response.event.safeParse({ type: 'delta', text: 'hello' }).success).toBe(true);
        });

        it('throws when an author variant redeclares a standard event', () => {
            expect(() =>
                streamWithTools({
                    title: 'ChatEvent',
                    tools: [],
                    event: z.object({
                        type: z.literal('delta'),
                        chunk: z.string(),
                    }),
                })
            ).toThrow(/two events with type 'delta'/);
        });
    });
});

function createTitledVariant(title: string, type: string) {
    return createModel({
        title,
        schema: z.object({
            type: z.literal(type),
            detail: z.string().optional(),
        }),
    });
}
