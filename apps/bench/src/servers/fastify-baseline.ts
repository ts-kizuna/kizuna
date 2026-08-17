import Fastify from 'fastify';
import { findUser, pageUsers, users } from '../data';

const app = Fastify();

app.get<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const user = findUser(request.params.id);
    if (!user) {
        reply.status(404);
        return {
            detail: 'User not found',
        };
    }
    return user;
});

app.get<{ Querystring: { page?: string; limit?: string } }>('/users', async (request) => {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 10);
    return {
        users: pageUsers(page, limit),
        total: users.length,
    };
});

app.post<{ Body: { name: string; email: string } }>('/users', async (request, reply) => {
    reply.status(201);
    return {
        id: 'user-created',
        name: request.body.name,
        email: request.body.email,
    };
});

await app.listen({
    port: Number(process.env.PORT),
});
