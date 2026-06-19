import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useKizuna } from './api.js';

export function App() {
    const api = useKizuna();
    const queryClient = useQueryClient();

    const usersQuery = useQuery(
        api.users.listUsers.queryOptions({
            query: {
                page: 1,
                limit: 50,
            },
        })
    );

    const createUser = useMutation(
        api.users.createUser.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(api.users.pathFilter()),
        })
    );

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    return (
        <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
            <h1>ts-kizuna · react-query</h1>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    createUser.mutate({
                        body: {
                            name,
                            email,
                        },
                    });
                    setName('');
                    setEmail('');
                }}
                style={{ display: 'flex', gap: 8, margin: '1rem 0' }}>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
                <button type="submit" disabled={createUser.isPending}>
                    Create user
                </button>
            </form>

            {/* `data` is the full response union — discriminate on `status`. */}
            {usersQuery.isLoading && <p>Loading…</p>}
            {usersQuery.data?.status === 200 ? (
                <ul>
                    {usersQuery.data.body.users.map((user) => (
                        <li key={user.id}>
                            {user.name} — <code>{user.email}</code>
                        </li>
                    ))}
                </ul>
            ) : usersQuery.data ? (
                <p>Request failed with status {usersQuery.data.status}.</p>
            ) : null}
        </main>
    );
}
