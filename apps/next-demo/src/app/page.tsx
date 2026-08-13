import { apiClient, memberClient } from '../lib/api-client';
import { createUserAction, deleteUserAction, removeMemberAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Home() {
    const result = await apiClient.users.listUsers({
        query: {
            page: 1,
            limit: 50,
        },
    });
    const users = result.status === 200 ? result.body.users : [];

    const { manageMembers } = await memberClient.permissions();
    const membersResult = await memberClient.members.listMembers();
    const members = membersResult.status === 200 ? membersResult.body.members : [];

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

            <h2>Workspace members</h2>
            <p>
                Signed in as Ada. Whether the Remove button renders is the same question the route asks before its handler runs, read once
                from the permissions endpoint rather than guessed at in the component.
            </p>

            <ul>
                {members.map((member) => (
                    <li
                        key={member.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.25rem',
                        }}>
                        <span>
                            {member.name} ({member.email})
                        </span>
                        {manageMembers && (
                            <form action={removeMemberAction}>
                                <input type="hidden" name="id" value={member.id} />
                                <button type="submit">Remove</button>
                            </form>
                        )}
                    </li>
                ))}
                {members.length === 0 && <li>No other members.</li>}
            </ul>

            <p>
                The button is a convenience, never the decision. Whether one particular member may go still depends on that member, since
                the owner cannot be removed, and that answer needs the record. It stays on the server as{' '}
                <code>permission.removeMember(target)</code>, which answers 403 with a reason.
            </p>
        </main>
    );
}
