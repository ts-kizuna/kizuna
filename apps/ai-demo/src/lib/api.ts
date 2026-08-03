import { anthropic } from '@ai-sdk/anthropic';
import { createServer } from '@ts-kizuna/next';
import { runAgent } from '@ts-kizuna/ai/runtime';
import type { ToolImplementations, ToolsOf } from '@ts-kizuna/ai';
import { ChatStream, contract } from './contract';
import { orderStore } from './orders';

const { server } = createServer(contract);

const SYSTEM_PROMPT = [
    'You are a support assistant for an online store.',
    'Use the order tools whenever the answer depends on order data; never guess an order status.',
    'Keep replies to a sentence or two.',
].join(' ');

/**
 * One implementation per tool the contract declares, typed from the declarations
 * themselves. Naming the type here also keeps the implementations readable.
 */
const orderTools: ToolImplementations<ToolsOf<typeof ChatStream>> = {
    lookup_order: ({ orderId }) => {
        const order = orderStore.findById(orderId);
        // A thrown tool reaches the model as an error it can recover from, and the
        // client sees a tool_error event while the stream continues.
        if (!order) throw new Error(`No order exists with id ${orderId}.`);
        return order;
    },
    search_orders: ({ query }) => orderStore.search(query),
};

const router = server.router('chat', {
    sendChatMessage: async ({ body, signal }) => ({
        status: 200 as const,
        stream: runAgent({
            response: ChatStream,
            model: anthropic('claude-opus-5'),
            system: SYSTEM_PROMPT,
            messages: body.messages,
            signal,
            tools: orderTools,
        }),
    }),
});

export const api = server.api({
    router: {
        chat: router,
    },
});
