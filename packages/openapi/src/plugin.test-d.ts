import { test } from 'vitest';
import { openApiPlugin } from './plugin.js';

const info = {
    title: 'T',
    version: '1',
};

test('each path prop offers only the values that do something', () => {
    openApiPlugin({
        info,
        docsPath: false,
        jsonPath: true,
        yamlPath: true,
    });

    openApiPlugin({
        info,
        docsPath: '/reference',
        jsonPath: '/spec.json',
        yamlPath: '/spec.yaml',
    });

    openApiPlugin({
        info,
        // @ts-expect-error the reference UI is on by default, so `true` says nothing
        docsPath: true,
    });

    openApiPlugin({
        info,
        // @ts-expect-error the document is off by default, so `false` says nothing
        jsonPath: false,
    });

    openApiPlugin({
        info,
        // @ts-expect-error the same for YAML
        yamlPath: false,
    });

    openApiPlugin({
        info,
        // @ts-expect-error a path has to start with a slash
        docsPath: 'reference',
    });
});
