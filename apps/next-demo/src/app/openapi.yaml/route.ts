import { openApiSpec } from '../../lib/openapi-spec';

export const GET = () =>
    new Response(openApiSpec('yaml'), {
        headers: {
            'Content-Type': 'text/yaml; charset=utf-8',
        },
    });
