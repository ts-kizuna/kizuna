import { api } from '../../../server/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = api.mount({
    basePath: '/api',
});
