import { createClient } from '@ts-kizuna/react-query';
import { contract } from '@ts-kizuna-demo/shared';

export const api = createClient(contract, {
    baseUrl: '/api',
});
