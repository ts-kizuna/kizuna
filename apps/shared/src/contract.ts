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
    plugins: ({ routes }) => ({
        mcp: mcpPlugin(routes, {
            name: 'ts-kizuna demo',
            tools: {
                health: false,
                users: {
                    exportUsers: false,
                },
                notifications: {
                    webhook: false,
                },
            },
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
