import { apiClient } from '../lib/api-client';
import { createUserAction, deleteUserAction } from './actions';

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
                <a href="http://localhost:8002/api/orders" target="_blank" rel="noreferrer">
                    Payload API (:8002/api/orders) →
                </a>
            </nav>

            <h2>Users</h2>
            <form
                action={createUserAction}
                style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                }}>
                <input name="name" placeholder="Name" required />
                <input name="email" type="email" placeholder="Email" required />
                <button type="submit">Add user</button>
            </form>

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
                        <form action={deleteUserAction}>
                            <input type="hidden" name="id" value={user.id} />
                            <button type="submit">Delete</button>
                        </form>
                    </li>
                ))}
                {users.length === 0 && <li>No users yet.</li>}
            </ul>
        </main>
    );
}
