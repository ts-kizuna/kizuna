import Fastify from 'fastify';
import { KizunaServer, type Router } from '@ts-kizuna/fastify';
import { contract } from '../contract';
import { findUser, pageUsers, users } from '../data';

const server = new KizunaServer(contract);

const bench: Router<typeof contract.routes.bench> = {
    getUser: ({ params }) => {
        const user = findUser(params.id);
        if (!user) {
            return {
                status: 404,
                body: {
                    detail: 'User not found',
                },
            };
        }
        return {
            status: 200,
            body: user,
        };
    },
    listUsers: ({ query }) => ({
        status: 200,
        body: {
            users: pageUsers(query.page, query.limit),
            total: users.length,
        },
    }),
    createUser: ({ body }) => ({
        status: 201,
        body: {
            id: 'user-created',
            name: body.name,
            email: body.email,
        },
    }),
};

const api = server.api({
    router: server.router({
        bench,
    }),
});

const app = Fastify();
await api.mount(app);

await app.listen({
    port: Number(process.env.PORT),
});
