import type { Router } from '@ts-kizuna/server/express';
import type { contract } from '@ts-kizuna-demo/shared';

export const health: Router<typeof contract.routes.health> = {
    check: () => ({
        status: 200,
        body: {
            ok: true,
        },
    }),
    version: () => ({
        status: 200,
        body: {
            version: '1.0.0',
        },
    }),
    history: () => ({
        status: 200,
        body: [{ ok: true, checkedAt: new Date().toISOString() }],
    }),
};
