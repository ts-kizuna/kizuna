import { implementTool } from '@ts-kizuna/ai';
import { LookupOrderTool } from '../contract';
import { orderStore } from '../orders';

export const lookupOrder = implementTool(LookupOrderTool, ({ orderId }) => {
    const order = orderStore.findById(orderId);
    // A thrown tool reaches the model as an error it can recover from, and the client
    // sees a tool_error event while the stream keeps going.
    if (!order) throw new Error(`No order exists with id ${orderId}.`);
    return order;
});
