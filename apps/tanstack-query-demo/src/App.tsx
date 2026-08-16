import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isUndeclaredResponseError } from '@ts-kizuna/tanstack-query';
import { api } from './api.js';
import styles from './App.module.css';

function CreateUserForm() {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');

    const createUser = useMutation(
        api.users.createUser.mutationOptions({
            onSuccess: () => {
                setName('');
                // One key invalidates every users query.
                void queryClient.invalidateQueries({
                    queryKey: api.users.key(),
                });
            },
        })
    );

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        createUser.mutate({
            body: {
                name,
                email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            },
        });
    };

    return (
        <>
            <form className={styles.row} onSubmit={submit}>
                <input
                    className={styles.input}
                    value={name}
                    placeholder="New user name"
                    onChange={(event) => setName(event.target.value)}
                />
                <button className={styles.button} type="submit" disabled={name === '' || createUser.isPending}>
                    {createUser.isPending ? 'Creating…' : 'Create'}
                </button>
            </form>

            {createUser.data?.status === 400 && <p className={styles.note}>Rejected: {createUser.data.body.title}</p>}
        </>
    );
}

function UserList() {
    const users = useQuery(
        api.users.listUsers.queryOptions({
            input: {
                query: {
                    page: 1,
                    limit: 20,
                },
            },
        })
    );

    if (users.isPending) {
        return <p className={styles.note}>Loading users…</p>;
    }

    if (users.isError) {
        return <p className={styles.note}>Could not reach the API. Is the express demo running on :8000?</p>;
    }

    // A `query` schema puts the automatic 400 in the union, so the success
    // branch has to be narrowed before reading the body.
    if (users.data.status !== 200) {
        return <p className={styles.note}>Rejected: {users.data.body.title}</p>;
    }

    const { users: found, total } = users.data.body;

    return (
        <ul className={styles.users}>
            {found.map((user) => (
                <li key={user.id}>
                    {user.name} <span className={styles.note}>{user.email}</span>
                </li>
            ))}
            <li className={styles.note}>{total} users total</li>
        </ul>
    );
}

function loadMoreLabel(isFetching: boolean, hasMore: boolean) {
    if (isFetching) {
        return 'Loading…';
    }
    return hasMore ? 'Load more' : 'No more results';
}

function UserSearch() {
    const [term, setTerm] = useState('');

    const search = useInfiniteQuery(
        api.users.searchUsers.infiniteOptions({
            input: (cursor: number) => ({
                query: {
                    q: term,
                    limit: 5,
                    cursor,
                },
            }),
            initialPageParam: 0,
            getNextPageParam: (lastPage) => (lastPage.status === 200 ? lastPage.body.nextCursor : null),
            enabled: term !== '',
        })
    );

    const found = search.data?.pages.flatMap((page) => (page.status === 200 ? page.body.users : [])) ?? [];

    return (
        <>
            <div className={styles.row}>
                <input className={styles.input} value={term} placeholder="Search users" onChange={(event) => setTerm(event.target.value)} />
            </div>

            {term === '' && <p className={styles.note}>Type to search. Each page is five users.</p>}

            {term !== '' && (
                <>
                    <ul className={styles.users}>
                        {found.map((user) => (
                            <li key={user.id}>{user.name}</li>
                        ))}
                    </ul>
                    <div className={`${styles.row} ${styles.more}`}>
                        <button
                            className={styles.button}
                            type="button"
                            onClick={() => void search.fetchNextPage()}
                            disabled={!search.hasNextPage || search.isFetchingNextPage}>
                            {loadMoreLabel(search.isFetchingNextPage, search.hasNextPage)}
                        </button>
                    </div>
                </>
            )}
        </>
    );
}

function MissingUser() {
    const missing = useQuery(
        api.users.getUser.queryOptions({
            input: {
                params: {
                    id: 'does-not-exist',
                },
                headers: {
                    'x-request-id': 'tanstack-query-demo',
                },
            },
            retry: false,
        })
    );

    if (missing.isPending) {
        return <p className={styles.note}>Loading…</p>;
    }

    if (missing.error !== null && isUndeclaredResponseError(missing.error)) {
        return <p className={styles.note}>The server returned an undeclared {missing.error.status}, so it threw.</p>;
    }

    return (
        <p className={styles.note}>
            The contract declares 404, so it arrives on <code className={styles.code}>data</code> with{' '}
            <code className={styles.code}>status: {missing.data?.status}</code>, not on <code className={styles.code}>error</code>.
        </p>
    );
}

export function App() {
    return (
        <main className={styles.page}>
            <h1 className={styles.title}>ts-kizuna + TanStack Query</h1>
            <p className={styles.lede}>Every query and mutation below is built from the same contract as the express demo it talks to.</p>

            <section className={styles.section}>
                <h2 className={styles.heading}>Users</h2>
                <CreateUserForm />
                <UserList />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Search</h2>
                <UserSearch />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>A declared 404 is data</h2>
                <MissingUser />
            </section>
        </main>
    );
}
