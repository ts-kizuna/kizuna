import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

export const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Fastify Demo',
        version: '1.0.0',
        description: 'Fastify adapter demo for the ts-kizuna user API.',
    },
    servers: [
        {
            url: 'http://localhost:8002',
            description: 'Local fastify demo',
        },
    ],
    setOperationId: true,
});
