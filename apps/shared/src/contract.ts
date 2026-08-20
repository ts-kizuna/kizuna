import { mcpPlugin } from '@ts-kizuna/mcp';
import { openApiPlugin } from '@ts-kizuna/openapi';
import { k } from './k';
import { routes } from './routes/index';
import { jobs } from './jobs';
import { auth } from './auth';

export const contract = k.contract({
    routes,
    jobs,
    auth,
    plugins: {
        mcp: mcpPlugin({
            name: 'ts-kizuna demo',
        }),
        openApi: openApiPlugin({
            info: {
                title: 'ts-kizuna demo',
                version: '1.0.0',
                description: 'The ts-kizuna user API, shared by every adapter demo.',
            },
            setOperationId: true,
            docsPath: '/docs',
            jsonPath: '/openapi.json',
        }),
    },
});
