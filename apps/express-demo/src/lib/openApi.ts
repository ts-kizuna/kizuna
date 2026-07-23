import { generateOpenApi } from '@ts-kizuna/openapi';
import { contract } from '@ts-kizuna-demo/shared';

export const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Express Demo',
        version: '1.0.0',
        description: 'Express adapter demo for the ts-kizuna user API.',
    },
    servers: [
        {
            url: 'http://localhost:8000',
            description: 'Local express demo',
        },
    ],
    setOperationId: true,
});
