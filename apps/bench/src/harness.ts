import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

/**
 * Shared machinery for both bench runners: the scenario list, starting a bench
 * server as a child process, waiting until it responds, and firing one
 * autocannon load round at it.
 */

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = path.join(appRoot, 'node_modules', '.bin', 'tsx');

export const adapters = ['express', 'fastify', 'hono'] as const;
export const variants = ['baseline', 'kizuna'] as const;

export type Adapter = (typeof adapters)[number];
export type Variant = (typeof variants)[number];

export interface Scenario {
    name: string;
    description: string;
    request: (baseUrl: string) => autocannon.Options;
}

/**
 * Each scenario stresses a different part of the request pipeline.
 */
export const scenarios = [
    {
        name: 'getUser',
        description: 'GET /users/:id, path param and a small object out',
        request: (baseUrl: string) => ({
            url: `${baseUrl}/users/user-13`,
        }),
    },
    {
        name: 'listUsers',
        description: 'GET /users?page=1&limit=25, query parsing and a 25-item list out',
        request: (baseUrl: string) => ({
            url: `${baseUrl}/users?page=1&limit=25`,
        }),
    },
    {
        name: 'createUser',
        description: 'POST /users, JSON body in and a created object out',
        request: (baseUrl: string) => ({
            url: `${baseUrl}/users`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                name: 'Bench User',
                email: 'bench@example.com',
            }),
        }),
    },
] as const satisfies readonly Scenario[];

export type ScenarioName = (typeof scenarios)[number]['name'];

export interface RunningServer {
    child: ChildProcess;
    baseUrl: string;
    /**
     * Time from process spawn to the first successful response.
     */
    startupMilliseconds: number;
}

/**
 * Each server gets a fresh port so a lingering socket from the previous one
 * cannot interfere.
 */
let nextPort = Number(process.env.BENCH_PORT ?? 4600);

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilResponding(baseUrl: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`server exited with code ${child.exitCode} before responding`);
        }
        try {
            const response = await fetch(`${baseUrl}/users/user-13`);
            if (response.ok) {
                await response.arrayBuffer();
                return;
            }
        } catch {
            await sleep(5);
        }
    }
    throw new Error(`server at ${baseUrl} did not respond within 30s`);
}

export async function startServer(adapter: Adapter, variant: Variant): Promise<RunningServer> {
    const port = nextPort;
    nextPort += 1;
    const baseUrl = `http://127.0.0.1:${port}`;
    const entry = path.join(appRoot, 'src', 'servers', `${adapter}-${variant}.ts`);
    const startedAt = performance.now();
    const child = spawn(tsxBin, [entry], {
        env: {
            ...process.env,
            PORT: String(port),
        },
        stdio: 'ignore',
    });
    try {
        await waitUntilResponding(baseUrl, child);
    } catch (error) {
        await stopServer(child);
        throw error;
    }
    return {
        child,
        baseUrl,
        startupMilliseconds: performance.now() - startedAt,
    };
}

export async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) {
        return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    await exited;
    clearTimeout(forceKill);
}

export interface LoadSettings {
    connections: number;
    duration: number;
    warmupDuration: number;
}

/**
 * One warmup round (discarded, lets the JIT settle) followed by one measured round.
 */
export async function runLoad(request: autocannon.Options, settings: LoadSettings): Promise<autocannon.Result> {
    if (settings.warmupDuration > 0) {
        await autocannon({
            ...request,
            connections: settings.connections,
            duration: settings.warmupDuration,
        });
    }
    return autocannon({
        ...request,
        connections: settings.connections,
        duration: settings.duration,
    });
}

export function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = sorted[Math.floor(sorted.length / 2)];
    if (middle === undefined) {
        throw new Error('median of an empty list');
    }
    return middle;
}

export function formatNumber(value: number, digits = 0): string {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

export function formatTable(header: string[], rows: string[][]): string {
    const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)));
    const formatRow = (row: string[]): string =>
        row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join('  ');
    return [formatRow(header), ...rows.map(formatRow)].join('\n');
}
