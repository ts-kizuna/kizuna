import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { KizunaServer } from './server.js';
import { createReceiverProbe, createReceiverRouter, receiverContract } from '../../core/src/adapter-testing/index.js';

/**
 * The shared catalogue covers every receiver behaviour. Express's own is the
 * hoisting: `app.use` only appends, so the receiver routes have to be moved ahead
 * of a body parser installed first.
 */
describe('receivers on express', () => {
    const buildApi = () =>
        new KizunaServer(receiverContract).api({
            router: createReceiverRouter(),
            receivers: createReceiverProbe().implementations as never,
        });

    it('hoists the receiver routes to the front of the middleware stack', () => {
        const app = express();
        app.use(express.json());
        buildApi().mount(app);
        const stack = (app as unknown as { router: { stack: { name: string }[] } }).router.stack;
        expect(stack[0]!.name).not.toBe('jsonParser');
    });

    it('warns when the stack cannot be reordered, because a parser would then win', () => {
        const logger = {
            warn: vi.fn(),
            error: vi.fn(),
        };
        const original = console.warn;
        console.warn = logger.warn;
        try {
            buildApi().mount({
                use: () => undefined,
            });
        } finally {
            console.warn = original;
        }
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ahead of the app middleware'));
    });
});
