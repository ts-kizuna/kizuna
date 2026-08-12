import { isValidationError } from '@ts-kizuna/fetch';
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

        console.log('--- userActivity (hover year to see a number, not a string) ---');
        const activity = await apiClient.users.userActivity({
            params: {
                id: created.body.id,
                year: 2024,
            },
        });
        if (activity.status === 200) console.log(`events in ${activity.body.year}:`, activity.body.events);

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
        if (miss.status === 404) console.log('expected 404:', miss.body.detail);
    } else {
        console.log('create failed:', created.body.detail);
    }

    console.log('--- createUser invalid email (expect 400) ---');
    const bad = await apiClient.users.createUser({
        body: {
            name: 'X',
            email: 'not-an-email',
        },
    });
    console.log('status:', bad.status);

    console.log('--- createUser invalid phone (expect 400 with custom code) ---');
    const badPhone = await apiClient.users.createUser({
        body: {
            name: 'Grace Hopper',
            email: 'grace@example.com',
            phone: 'not-a-phone',
        },
    });
    if (badPhone.status === 400 && isValidationError(badPhone.body)) {
        for (const issue of badPhone.body.errors) {
            // `issue.code` is typed as ValidationIssueCode, comparing against
            // the custom `invalid_phone_number` is fully type-checked.
            if (issue.code === 'invalid_phone_number') {
                console.log('custom code:', issue.code, '->', issue.message);
            }
        }
    }
};

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
