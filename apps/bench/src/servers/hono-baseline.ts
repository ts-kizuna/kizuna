import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { findUser, pageUsers, users } from '../data';

const app = new Hono();

app.get('/users/:id', (context) => {
    const user = findUser(context.req.param('id'));
    if (!user) {
        return context.json(
            {
                detail: 'User not found',
            },
            404
        );
    }
    return context.json(user);
});

app.get('/users', (context) => {
    const page = Number(context.req.query('page') ?? 1);
    const limit = Number(context.req.query('limit') ?? 10);
    return context.json({
        users: pageUsers(page, limit),
        total: users.length,
    });
});

app.post('/users', async (context) => {
    const body = await context.req.json<{ name: string; email: string }>();
    return context.json(
        {
            id: 'user-created',
            name: body.name,
            email: body.email,
        },
        201
    );
});

serve({
    fetch: app.fetch,
    port: Number(process.env.PORT),
});
