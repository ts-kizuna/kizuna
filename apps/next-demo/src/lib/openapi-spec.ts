import * as path from 'node:path';
import { generateOpenApi } from '@ts-kizuna/open-api';
import { contract } from '@ts-kizuna-demo/shared';

export const openApiSpec = generateOpenApi(contract, {
    info: {
        title: 'ts-kizuna Next.js Demo',
        version: '1.0.0',
        description: 'Next.js App Router adapter demo for the ts-kizuna user contract.',
    },
    servers: [
        {
            url: 'http://localhost:3030/api',
            description: 'Local Next.js demo',
        },
    ],
    security: [
        {
            bearerAuth: [],
        },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
        },
    },
    setOperationId: true,
    deprecationWarnings: {
        contractPath: path.resolve(process.cwd(), '../shared/src/contract.ts'),
    },
});
