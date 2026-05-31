import { apiClient } from '../lib/api-client';
import { AddUserForm, DeleteUserButton } from './users-ui';

export const dynamic = 'force-dynamic';

export default async function Home() {
    const result = await apiClient.users.listUsers({
        query: {
            page: 1,
            limit: 50,
        },
    });
    const users = result.status === 200 ? result.body.users : [];

    return (
        <main
            style={{
                padding: '2rem',
                maxWidth: '40rem',
                margin: '0 auto',
            }}>
            <h1>ts-kizuna demos</h1>
            <p>The same shared contract powers both demos. This page is a server component fetching via the typed client.</p>
            <nav
                style={{
                    display: 'flex',
                    gap: '1rem',
                    marginBottom: '1.5rem',
                    padding: '0.75rem 1rem',
                    background: '#f4f4f4',
                    borderRadius: '0.5rem',
                }}>
                <a href="http://localhost:8000/users" target="_blank" rel="noreferrer">
                    Express API (:8000/users) →
                </a>
                <a href="/api/users" target="_blank" rel="noreferrer">
                    Next.js API (:3030/api/users) →
                </a>
                <a href="http://localhost:8000/" target="_blank" rel="noreferrer">
                    Express demo page (:8000) →
                </a>
            </nav>

            <h2>Users</h2>
            <p>
                The form and delete buttons call server actions built with <code>createServerAction</code> — typed input, automatic{' '}
                <code>{'{ data } | { error }'}</code> collapse, and <code>revalidate</code> built in.
            </p>
            <AddUserForm />

            <ul>
                {users.map((user) => (
                    <li
                        key={user.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.25rem',
                        }}>
                        <span>
                            {user.name} ({user.email})
                        </span>
                        <DeleteUserButton id={user.id} />
                    </li>
                ))}
                {users.length === 0 && <li>No users yet.</li>}
            </ul>
        </main>
    );
}
