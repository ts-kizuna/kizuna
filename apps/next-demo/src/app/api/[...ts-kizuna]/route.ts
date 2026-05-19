import { createNextEndpoints } from '@ts-kizuna/next';
import { api } from '../../../lib/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createNextEndpoints(api, {
    basePath: '/api',
});
