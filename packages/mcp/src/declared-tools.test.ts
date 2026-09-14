import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';
import { assembleApi, TOOLS_META } from '@ts-kizuna/core/adapter';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from './mcp-server.js';

const k = new Kizuna();

const routes = k.routes({
    health: {
        method: 'GET',
        path: '/health',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

const tools = k.tools(({ toolFromRoutes }) => ({
    weather: {
        getForecast: {
            title: 'Weather forecast',
            description: 'Look up the forecast for one city',
            input: z.object({
                city: z.string(),
            }),
            output: z.object({
                tempC: z.number(),
            }),
            annotations: {
                readOnlyHint: true,
            },
        },
    },
    countWords: {
        description: 'Count the words in a piece of text',
        input: z.object({
            text: z.string(),
        }),
        output: z.object({
            words: z.int(),
        }),
    },
    reindex: {
        description: 'Rebuild the search index',
    },
    health: toolFromRoutes(routes.health),
}));

const contract = k.contract({
    routes,
    tools,
});

/**
 * Plain functions. None of them is reachable over HTTP, and none of them goes
 * through a route to get its input.
 */
const toolHandlers = {
    weather: {
        getForecast: ({ input }: { input: { city: string } }) => ({
            tempC: input.city === 'Oslo' ? 14 : 20,
        }),
    },
    countWords: ({ input }: { input: { text: string } }) => ({
        words: input.text.split(/\s+/).filter(Boolean).length,
    }),
    reindex: () => undefined,
};

const buildApi = () =>
    Object.assign(
        assembleApi(contract, {
            router: {
                health: () => ({
                    status: 200,
                    body: {
                        ok: true,
                    },
                }),
            },
        }),
        {
            [TOOLS_META]: {
                tools: contract.tools!,
                handlers: toolHandlers as Record<string, unknown>,
            },
        }
    );

const connect = async (options?: Parameters<typeof createMcpServer>[1]) => {
    const server = createMcpServer(buildApi() as Parameters<typeof createMcpServer>[0], {
        name: 'Test API',
        version: '1.0.0',
        ...options,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
        name: 'test-client',
        version: '1.0.0',
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        },
    };
};

describe('declared tools over MCP', () => {
    it('publishes every declared tool, beside the routes named with fromRoute', async () => {
        const { client, close } = await connect();
        const { tools: listed } = await client.listTools();
        const names = listed.map((tool) => tool.name);

        expect(names).toContain('health');
        expect(names).toContain('weather_get_forecast');
        expect(names).toContain('count_words');
        await close();
    });

    it('leaves out a tool that is simply not declared', async () => {
        const { client, close } = await connect();
        const { tools: listed } = await client.listTools();

        expect(listed.map((tool) => tool.name)).not.toContain('archive_everything');
        await close();
    });

    it('onlyReadOnly keeps the tools that say they are read only', async () => {
        const { client, close } = await connect({
            onlyReadOnly: true,
        });
        const { tools: listed } = await client.listTools();
        const names = listed.map((tool) => tool.name);

        expect(names).toContain('weather_get_forecast');
        expect(names).not.toContain('count_words');
        await close();
    });
});
