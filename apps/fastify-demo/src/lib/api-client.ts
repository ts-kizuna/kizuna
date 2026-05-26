import { createClient } from '@ts-kizuna/fetch';
import { contract } from '@ts-kizuna-demo/shared';

export const apiClient = createClient(contract, {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:8002',
});
