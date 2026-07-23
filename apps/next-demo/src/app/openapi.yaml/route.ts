import { openApiSpec } from '../../lib/openApi';

export const GET = () =>
    new Response(openApiSpec('yaml'), {
        headers: {
            'Content-Type': 'text/yaml; charset=utf-8',
        },
    });
