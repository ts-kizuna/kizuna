import { apiClient } from '../lib/api-client';

const main = async () => {
    console.log('--- listUsers ---');
    const list = await apiClient.users.listUsers({
        query: {
            page: 1,
            limit: 10,
        },
    });
    if (list.status === 200) {
        console.log(`users: ${list.body.users.length}, total: ${list.body.total}`);
    }

    console.log('--- searchUsers (hover limit/cursor to see required coerced numbers) ---');
    const found = await apiClient.users.searchUsers({
        query: {
            q: 'ada',
            limit: 20,
            cursor: 0,
        },
    });
    if (found.status === 200) {
        console.log(`matches: ${found.body.users.length}, nextCursor: ${found.body.nextCursor}`);
    }

    console.log('--- createUser ---');
    const created = await apiClient.users.createUser({
        body: {
            name: 'Grace Hopper',
            email: 'grace@example.com',
        },
    });
    if (created.status === 201) {
        console.log('created:', created.body.id, created.body.name);

        console.log('--- getUser created.id ---');
        const got = await apiClient.users.getUser({
            params: {
                id: created.body.id,
            },
            headers: {
                'x-request-id': 'demo-1',
            },
        });
        if (got.status === 200) console.log('found:', got.body.name);

        console.log('--- deleteUser created.id ---');
        const deleted = await apiClient.users.deleteUser({
            params: {
                id: created.body.id,
            },
        });
        if (deleted.status === 200) console.log('deleted, success:', deleted.body.success);

        console.log('--- getUser created.id again (expect 404) ---');
        const miss = await apiClient.users.getUser({
            params: {
                id: created.body.id,
            },
            headers: {
                'x-request-id': 'demo-2',
            },
        });
        if (miss.status === 404) console.log('expected 404:', miss.body.message);
    } else {
        console.log('create failed:', created.body.message);
    }

    console.log('--- createUser invalid email (expect 400) ---');
    const bad = await apiClient.users.createUser({
        body: {
            name: 'X',
            email: 'not-an-email',
        },
    });
    console.log('status:', bad.status);
};

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
