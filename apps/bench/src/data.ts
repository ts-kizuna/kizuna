export interface BenchUser {
    id: string;
    name: string;
    email: string;
}

export const users: BenchUser[] = Array.from(
    {
        length: 25,
    },
    (_, index) => ({
        id: `user-${index + 1}`,
        name: `User ${index + 1}`,
        email: `user${index + 1}@example.com`,
    })
);

export function findUser(id: string): BenchUser | undefined {
    return users.find((candidate) => candidate.id === id);
}

export function pageUsers(page: number, limit: number): BenchUser[] {
    const start = (page - 1) * limit;
    return users.slice(start, start + limit);
}
