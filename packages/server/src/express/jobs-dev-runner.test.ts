import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';
import type { Contract } from '@ts-kizuna/contract';
import { KizunaServer } from '../next/server.js';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startJobsDevRunner, type JobsDevRunner } from '@ts-kizuna/contract';

const scheduler = Kizuna.identity.bearer({});

const k = new Kizuna({
    identities: {
        scheduler,
    },
});

const routes = k.routes({
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.array(z.string()),
        },
    },
});

const jobs = k.jobs('scheduler', {
    everyMinute: {
        schedule: '* * * * *',
        result: z.object({
            ran: z.boolean(),
        }),
    },
    never: {
        schedule: '0 0 30 2 *',
    },
});

const contract = k.contract({
    routes,
    jobs,
    auth: {
        listUsers: false,
    },
});

const ran = vi.fn();

const server = new KizunaServer(contract);

const startServer = async (): Promise<{ httpServer: Server; baseUrl: string }> => {
    const api = server.api({
        router: server.router({
            listUsers: () => ({
                status: 200,
                body: [],
            }),
        }),
        guards: {
            scheduler: server.guard('scheduler', ({ bearer, deny }) => {
                if (bearer?.token !== 'cron-secret') return deny(401, 'Unauthorized');
            }),
        },
        jobs: server.jobs({
            everyMinute: () => {
                ran();
                return {
                    status: 200,
                    body: {
                        ran: true,
                    },
                };
            },
            never: () => {},
        }),
    });
    const app = express();
    app.use(express.json());
    api.mount(app);
    const httpServer = createHttpServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    return {
        httpServer,
        baseUrl: `http://localhost:${port}`,
    };
};

let runner: JobsDevRunner | undefined;
let httpServer: Server | undefined;

afterEach(async () => {
    runner?.stop();
    runner = undefined;
    if (httpServer) {
        await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
        httpServer = undefined;
    }
    ran.mockClear();
});

const silentLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe('startJobsDevRunner', () => {
    it('ticks the dispatch endpoint against the running server', async () => {
        const started = await startServer();
        httpServer = started.httpServer;
        runner = startJobsDevRunner(contract as unknown as Contract, {
            baseUrl: started.baseUrl,
            secret: 'cron-secret',
            logger: silentLogger,
        });
        expect(await runner.trigger()).toEqual({
            status: 200,
        });
        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('surfaces the guard rejection when the secret is wrong', async () => {
        const started = await startServer();
        httpServer = started.httpServer;
        runner = startJobsDevRunner(contract as unknown as Contract, {
            baseUrl: started.baseUrl,
            secret: 'wrong',
            logger: silentLogger,
        });
        expect(await runner.trigger()).toEqual({
            status: 401,
        });
        expect(ran).not.toHaveBeenCalled();
    });

    it('warns that ticks are not durable', async () => {
        const started = await startServer();
        httpServer = started.httpServer;
        const logger = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        runner = startJobsDevRunner(contract as unknown as Contract, {
            baseUrl: started.baseUrl,
            logger,
        });
        expect(logger.warn.mock.calls.flat().join(' ')).toContain('missed while the process is down');
    });

    it('warns when started with NODE_ENV=production', async () => {
        const started = await startServer();
        httpServer = started.httpServer;
        const previous = process.env.NODE_ENV;
        vi.stubEnv('NODE_ENV', 'production');
        const logger = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        try {
            runner = startJobsDevRunner(contract as unknown as Contract, {
                baseUrl: started.baseUrl,
                logger,
            });
        } finally {
            vi.stubEnv('NODE_ENV', previous ?? 'test');
        }
        expect(logger.warn.mock.calls.flat().join(' ')).toContain('Use your platform scheduler in production');
    });

    it('ticks on the interval', async () => {
        const started = await startServer();
        httpServer = started.httpServer;
        const onTick = vi.fn();
        runner = startJobsDevRunner(contract as unknown as Contract, {
            baseUrl: started.baseUrl,
            secret: 'cron-secret',
            intervalMs: 20,
            logger: silentLogger,
            onTick,
        });
        await vi.waitFor(() => expect(onTick).toHaveBeenCalled());
        expect(onTick.mock.calls[0]?.[0]).toEqual({
            status: 200,
        });
    });
});
