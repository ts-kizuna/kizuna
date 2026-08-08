import { api } from '../../../lib/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
    basePath: '/api',
});
