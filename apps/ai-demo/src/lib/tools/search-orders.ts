import { implementTool } from '@ts-kizuna/ai';
import { SearchOrdersTool } from '../contract';
import { orderStore } from '../orders';

export const searchOrders = implementTool(SearchOrdersTool, ({ query }) => orderStore.search(query));
