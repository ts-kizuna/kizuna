import { createClient } from '@ts-kizuna/fetch';
import { contract } from './contract';

export const apiClient = createClient(contract, {
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? '/api',
});
