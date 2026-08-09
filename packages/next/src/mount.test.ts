import { describe, expect, it } from 'vitest';
import { KizunaServer, NextRequest } from './server.js';
import { userContract, createUserRouter } from '../../core/src/adapter-testing/fixtures.js';

describe('api.mount', () => {
    it('serves routes', async () => {
        const { server } = KizunaServer.init(userContract);
        const api = server.api({ router: createUserRouter() as never });
        const { GET, POST } = api.mount({
            basePath: '/api',
        });

        await POST(
            new NextRequest('http://localhost/api/users', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Ada',
                    email: 'ada@example.com',
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
            })
        );

        const response = await GET(new NextRequest('http://localhost/api/users/1'));
        expect(response.status).toBe(200);
    });

    it('runs registered plugins', async () => {
        const seen: string[] = [];
        const { server } = KizunaServer.init(userContract);
        const api = server.api({
            router: createUserRouter() as never,
            plugins: [
                {
                    name: 'probe',
                    mount: (host) => {
                        seen.push(host === undefined ? 'no-host' : 'got-host');
                    },
                },
            ],
        });
        const { GET } = api.mount({
            basePath: '/api',
        });

        await GET(new NextRequest('http://localhost/api/users/1'));
        expect(seen).toEqual(['got-host']);
    });

    it('serves a plugin path under basePath, ahead of the contract routes', async () => {
        const { server } = KizunaServer.init(userContract);
        const api = server.api({
            router: createUserRouter() as never,
            plugins: [
                {
                    name: 'probe',
                    mount: (host) => {
                        host.post('/probe', async (request) => Response.json({ url: request.url }));
                    },
                },
            ],
        });
        const { POST } = api.mount({
            basePath: '/api',
        });

        const response = await POST(new NextRequest('http://localhost/api/probe', { method: 'POST' }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            url: 'http://localhost/api/probe',
        });
    });

    it('leaves unmatched paths to the contract', async () => {
        const { server } = KizunaServer.init(userContract);
        const api = server.api({
            router: createUserRouter() as never,
            plugins: [
                {
                    name: 'probe',
                    mount: (host) => {
                        host.post('/probe', async () => Response.json({ ok: true }));
                    },
                },
            ],
        });
        const { GET, POST } = api.mount({
            basePath: '/api',
        });

        const created = await POST(
            new NextRequest('http://localhost/api/users', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Ada',
                    email: 'ada@example.com',
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
            })
        );
        expect(created.status).toBe(201);

        const response = await GET(new NextRequest('http://localhost/api/users/1'));
        expect(response.status).toBe(200);
    });
});
