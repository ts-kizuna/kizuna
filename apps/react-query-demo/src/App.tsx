import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './lib/api';

export function App() {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <main style={{ fontFamily: 'system-ui', maxWidth: '40rem', margin: '2rem auto', padding: '0 1rem', lineHeight: 1.5 }}>
            <h1>ts-kizuna React Query demo</h1>
            <p>
                Talking to the express demo through <code>@ts-kizuna/react-query</code>. Start it with{' '}
                <code>pnpm --filter @ts-kizuna-demo/express server</code>.
            </p>
            <UserList selectedId={selectedId} onSelect={setSelectedId} />
            {selectedId && <UserDetail id={selectedId} />}
            <CreateUser />
        </main>
    );
}

function UserList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
    const { data, error, isPending } = api.users.listUsers.useQuery({
        query: {
            page: 1,
            limit: 10,
        },
    });

    if (isPending) return <p>Loading users…</p>;
    if (error) return <p>Failed to load users.</p>;

    return (
        <section>
            <h2>Users ({data.body.total})</h2>
            <ul>
                {data.body.users.map((user) => (
                    <li key={user.id}>
                        <button onClick={() => onSelect(user.id)} disabled={user.id === selectedId}>
                            {user.name}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function UserDetail({ id }: { id: string }) {
    const { data, error, isPending } = api.users.getUser.useQuery({
        params: {
            id,
        },
        headers: {
            'x-request-id': crypto.randomUUID(),
        },
    });

    if (isPending) return <p>Loading user…</p>;
    if (error) return <p>{error.status === 404 ? 'User not found.' : 'Failed to load user.'}</p>;

    return (
        <section>
            <h2>{data.body.name}</h2>
            <p>{data.body.email}</p>
        </section>
    );
}

function CreateUser() {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    const { mutate, data, error, isPending } = api.users.createUser.useMutation({
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: api.users.listUsers.queryKey(),
            });
        },
    });

    return (
        <section>
            <h2>Create user</h2>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    mutate({
                        body: {
                            name,
                            email,
                        },
                    });
                }}>
                <input value={name} placeholder="Name" onChange={(event) => setName(event.target.value)} />
                <input value={email} placeholder="Email" onChange={(event) => setEmail(event.target.value)} />
                <button type="submit" disabled={isPending}>
                    Create
                </button>
            </form>
            {data?.status === 201 && <p>Created {data.body.name}.</p>}
            {error && error.status === 400 && <p>Validation failed: {error.body.detail}</p>}
        </section>
    );
}
