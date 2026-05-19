import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;

const waitForServer = async (timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE_URL}/users?page=1&limit=1`);
            if (response.ok) return;
        } catch {
            // not up yet
        }
        await delay(200);
    }
    throw new Error(`Server did not become ready at ${BASE_URL} within ${timeoutMs}ms`);
};

const main = async (): Promise<void> => {
    const generated = readFileSync('swift/Sources/APIClient/APIClient.swift', 'utf8');
    if (!generated.includes('@available(*, deprecated')) {
        throw new Error('Generated APIClient.swift is missing @available(*, deprecated) — deprecation annotations were not emitted');
    }

    console.log(`Starting express-demo server on port ${PORT}...`);
    // detached: true puts the child in its own process group so process.kill(-pid)
    // kills the entire tree (pnpm → tsx → node), not just the pnpm wrapper.
    const server = spawn('pnpm', ['--filter', '@ts-kizuna-demo/express', 'server:once'], {
        env: {
            ...process.env,
            PORT: String(PORT),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
    });

    const killServer = () => {
        try {
            process.kill(-server.pid!, 'SIGTERM');
        } catch {
            // already gone
        }
    };

    let exitCode = 1;
    try {
        await waitForServer(30_000);
        console.log('Server ready. Running swift test...');
        const test = spawnSync('swift', ['test'], {
            cwd: 'swift',
            stdio: 'inherit',
            env: {
                ...process.env,
                API_BASE_URL: BASE_URL,
            },
        });
        exitCode = test.status ?? 1;
    } finally {
        console.log('Shutting down server...');
        killServer();
        await delay(300);
    }

    process.exit(exitCode);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
