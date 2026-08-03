import { z } from 'zod';
import { kizuna, createModel, createTags } from '@ts-kizuna/core';
import { ProblemDetailsSchema } from '@ts-kizuna/core/schemas';
import { createTool, agentStream } from '@ts-kizuna/ai';

export const OrderSchema = createModel({
    title: 'Order',
    schema: z.object({
        id: z.string(),
        status: z.enum(['pending', 'shipped', 'delivered']),
        total: z.number(),
    }),
});

export const ChatMessageSchema = createModel({
    title: 'ChatMessage',
    schema: z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
    }),
});

/**
 * Exposed in full, so the client sees which order was looked up and what came
 * back, and can render the lookup inline in the conversation.
 */
export const LookupOrderTool = createTool({
    name: 'lookup_order',
    description: 'Look up one order by its id. Call this whenever the answer depends on an order the user names.',
    input: z.object({
        orderId: z.string(),
    }),
    output: OrderSchema,
});

/**
 * Name-only, because the search text is the customer's own words and does not
 * need to be echoed back over the wire.
 */
export const SearchOrdersTool = createTool({
    name: 'search_orders',
    description: 'Search orders by free text. Use it when the user describes an order but does not know its id.',
    input: z.object({
        query: z.string(),
    }),
    output: z.array(OrderSchema),
    expose: 'name-only',
});

const { k } = kizuna({
    tags: createTags({
        chat: {
            title: 'Chat',
            description: 'Streaming assistant replies with order tools',
        },
    }),
});

export const ChatStream = agentStream({
    title: 'ChatEvent',
    description: 'One event in an assistant reply.',
    tools: [LookupOrderTool, SearchOrdersTool],
});

const chatRoutes = k.routes('chat', {
    sendChatMessage: {
        method: 'POST',
        path: '/chat',
        body: z.object({
            messages: z.array(ChatMessageSchema).min(1),
        }),
        responses: {
            200: ChatStream,
            400: ProblemDetailsSchema,
        },
        summary: 'Stream an assistant reply, with order tools the model may call',
    },
});

export const routes = {
    chat: chatRoutes,
};

export const contract = k.contract({
    routes,
});
