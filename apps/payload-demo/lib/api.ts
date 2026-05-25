import { createApi, createMiddleware } from '@ts-kizuna/payload';
import { contract } from '../contract';
import { router } from './router';
import { requireAuth } from './guards';

const middleware = createMiddleware(contract, {
    orders: {
        create: [requireAuth],
        get: [],
        list: [],
    },
});

export const api = createApi({
    contract,
    router,
    middleware,
});
