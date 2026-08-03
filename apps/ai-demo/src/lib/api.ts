import { anthropic } from '@ai-sdk/anthropic';
import { createServer } from '@ts-kizuna/next';
import { runAgent } from '@ts-kizuna/ai/runtime';
import { ChatStream, contract } from './contract';
import { lookupOrder } from './tools/lookup-order';
import { searchOrders } from './tools/search-orders';

const { server } = createServer(contract);

const SYSTEM_PROMPT = [
    'You are a support assistant for an online store.',
    'Use the order tools whenever the answer depends on order data; never guess an order status.',
    'Keep replies to a sentence or two.',
].join(' ');

const router = server.router('chat', {
    sendChatMessage: async ({ body, signal }) => ({
        status: 200,
        stream: runAgent({
            response: ChatStream,
            model: anthropic('claude-opus-5'),
            system: SYSTEM_PROMPT,
            messages: body.messages,
            signal,
            tools: [lookupOrder, searchOrders],
        }),
    }),
});

export const api = server.api({
    router: {
        chat: router,
    },
});
