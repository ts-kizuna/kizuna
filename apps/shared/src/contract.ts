import { mcpPlugin } from '@ts-kizuna/mcp';
import { openApiPlugin } from '@ts-kizuna/openapi';
import { k } from './k';
import { routes } from './routes/index';
import { jobs } from './jobs';
import { tools } from './tools';
import { auth } from './auth';

export const contract = k.contract({
    routes,
    jobs,
    tools,
    auth,
    plugins: ({ routes, tools }) => ({
        mcp: mcpPlugin({
            name: 'ts-kizuna demo',
            routes,
            tools,
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
    }),
});
