import { test } from 'vitest';
import { openApiPlugin } from './plugin.js';

const info = {
    title: 'T',
    version: '1',
};

test('each path prop takes only a path that serves its own format', () => {
    openApiPlugin({
        info,
    });

    openApiPlugin({
        info,
        docsPath: '/reference',
        jsonPath: '/spec.json',
        yamlPath: '/spec.yaml',
    });

    openApiPlugin({
        info,
        // @ts-expect-error nothing is on or off, so a boolean says nothing
        docsPath: true,
    });

    openApiPlugin({
        info,
        // @ts-expect-error the same for the document
        jsonPath: false,
    });

    openApiPlugin({
        info,
        // @ts-expect-error a path has to start with a slash
        docsPath: 'reference',
    });

    openApiPlugin({
        info,
        // @ts-expect-error the JSON document is served from a `.json` path
        jsonPath: '/spec',
    });

    openApiPlugin({
        info,
        // @ts-expect-error and YAML from a `.yaml` one
        yamlPath: '/spec.json',
    });
});
