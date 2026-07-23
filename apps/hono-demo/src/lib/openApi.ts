import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

export const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Hono Demo',
        version: '1.0.0',
        description: 'Hono adapter demo for the ts-kizuna user API.',
    },
    servers: [
        {
            url: 'http://localhost:8001',
            description: 'Local hono demo',
        },
    ],
    setOperationId: true,
});
