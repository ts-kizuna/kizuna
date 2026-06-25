import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

export const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Next.js Demo',
        version: '1.0.0',
        description: 'Next.js App Router adapter demo for the ts-kizuna user API.',
    },
    servers: [
        {
            url: 'http://localhost:3030/api',
            description: 'Local Next.js demo',
        },
    ],
    setOperationId: true,
});
