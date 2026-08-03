import { createNextEndpoints } from '@ts-kizuna/next';
import { api } from '../../../lib/api';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createNextEndpoints(api, {
    basePath: '/api',
    // A tool call is dead air on the wire, so keep-alive comments hold the connection
    // open through intermediaries while the model works.
    streamKeepAliveMs: 15_000,
    onStreamError: (error) => {
        console.error('[ai-demo] stream failed after its first event:', error);
    },
});
