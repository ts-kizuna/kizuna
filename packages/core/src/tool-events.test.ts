import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTools } from './tools.js';
import { toolEvents } from './tool-events.js';
import { formatEvent } from './stream.js';
import { Kizuna } from './kizuna.js';

const tools = buildTools({
    weather: {
        getForecast: {
            description: 'Look up the forecast for one city',
            input: z.object({
                city: z.string(),
            }),
            output: z.object({
                tempC: z.number(),
            }),
        },
    },
    ping: {
        description: 'Answer that the server is up',
    },
});

describe('toolEvents', () => {
    it('adds tool_call, tool_result and tool_error', () => {
        expect(Object.keys(toolEvents(tools))).toEqual(['tool_call', 'tool_result', 'tool_error']);
    });

    it('throws on a tool set with no tools in it', () => {
        expect(() => toolEvents(buildTools({}))).toThrow(/a tool set with no tools in it/);
    });

    it('parses a call for the tool it names', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_call.parse({
                id: 'call_1',
                name: 'weather.getForecast',
                input: {
                    city: 'Oslo',
                },
            })
        ).toEqual({
            id: 'call_1',
            name: 'weather.getForecast',
            input: {
                city: 'Oslo',
            },
        });
    });

    it('refuses a call whose input is not the named tool own', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_call.safeParse({
                id: 'call_1',
                name: 'weather.getForecast',
                input: {
                    city: 14,
                },
            }).success
        ).toBe(false);
    });

    it('refuses a call naming a tool the set does not declare', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_call.safeParse({
                id: 'call_1',
                name: 'weather.getHistory',
                input: {
                    city: 'Oslo',
                },
            }).success
        ).toBe(false);
    });

    it('parses a call for a tool taking no arguments', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_call.parse({
                id: 'call_2',
                name: 'ping',
            })
        ).toEqual({
            id: 'call_2',
            name: 'ping',
        });
    });

    it('parses a result carrying the tool own output', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_result.parse({
                id: 'call_1',
                name: 'weather.getForecast',
                output: {
                    tempC: 14,
                },
            })
        ).toEqual({
            id: 'call_1',
            name: 'weather.getForecast',
            output: {
                tempC: 14,
            },
        });
    });

    it('takes any declared tool name on an error', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_error.parse({
                id: 'call_1',
                name: 'ping',
                message: 'the clock is unset',
            })
        ).toEqual({
            id: 'call_1',
            name: 'ping',
            message: 'the clock is unset',
        });
    });

    it('refuses an error naming a tool the set does not declare', () => {
        const events = toolEvents(tools);
        expect(
            events.tool_error.safeParse({
                id: 'call_1',
                name: 'weather.getHistory',
                message: 'nope',
            }).success
        ).toBe(false);
    });

    it('builds a union even for a single tool', () => {
        const events = toolEvents(
            buildTools({
                ping: {
                    description: 'Answer that the server is up',
                },
            })
        );
        expect(
            events.tool_call.parse({
                id: 'call_1',
                name: 'ping',
            })
        ).toEqual({
            id: 'call_1',
            name: 'ping',
        });
    });
});

describe('the wire a tool event produces', () => {
    it('frames a call and its result as named server-sent events', () => {
        const call = formatEvent(
            {
                event: 'tool_call',
                data: {
                    id: 'toolu_01',
                    name: 'weather.getForecast',
                    input: {
                        city: 'Oslo',
                    },
                },
            },
            true
        );
        const result = formatEvent(
            {
                event: 'tool_result',
                data: {
                    id: 'toolu_01',
                    name: 'weather.getForecast',
                    output: {
                        tempC: 14,
                    },
                },
            },
            true
        );

        expect(call).toBe('event: tool_call\ndata: {"id":"toolu_01","name":"weather.getForecast","input":{"city":"Oslo"}}\n\n');
        expect(result).toBe('event: tool_result\ndata: {"id":"toolu_01","name":"weather.getForecast","output":{"tempC":14}}\n\n');
    });
});

describe('expandStreamTools', () => {
    const k = new Kizuna();

    const declared = k.tools({
        countWords: {
            description: 'Count the words in a piece of text',
            input: z.object({
                text: z.string(),
            }),
        },
    });

    it('folds the tool events into the stream and drops the tools field', () => {
        const routes = k.routes({
            reply: {
                method: 'POST',
                path: '/reply',
                responses: {
                    200: {
                        stream: {
                            delta: z.object({
                                text: z.string(),
                            }),
                        },
                        tools: declared,
                    },
                },
            },
        });

        const response = routes['reply']!.responses[200] as {
            stream: Record<string, z.ZodType>;
            tools?: unknown;
        };
        expect(Object.keys(response.stream)).toEqual(['delta', 'tool_call', 'tool_result', 'tool_error']);
        expect('tools' in response).toBe(false);
    });

    it('throws when the stream already names a tool event', () => {
        expect(() =>
            k.routes({
                reply: {
                    method: 'POST',
                    path: '/reply',
                    responses: {
                        200: {
                            stream: {
                                tool_call: z.object({
                                    mine: z.string(),
                                }),
                            },
                            tools: declared,
                        },
                    },
                },
            })
        ).toThrow(/already names an event "tool_call"/);
    });

    it('throws when tools sit beside a single stream schema', () => {
        expect(() =>
            k.routes({
                reply: {
                    method: 'POST',
                    path: '/reply',
                    responses: {
                        200: {
                            stream: z.object({
                                text: z.string(),
                            }),
                            tools: declared,
                        },
                    },
                },
            })
        ).toThrow(/beside a single stream schema/);
    });
});
