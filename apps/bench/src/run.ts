import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = path.join(appRoot, 'node_modules', '.bin', 'tsx');

const duration = Number(process.env.BENCH_DURATION ?? 10);
const warmupDuration = Number(process.env.BENCH_WARMUP ?? 2);
const connections = Number(process.env.BENCH_CONNECTIONS ?? 50);
const startupRuns = Number(process.env.BENCH_STARTUP_RUNS ?? 5);

const adapters = ['express', 'fastify', 'hono'] as const;
const variants = ['baseline', 'kizuna'] as const;

type Adapter = (typeof adapters)[number];
type Variant = (typeof variants)[number];

interface Scenario {
    name: string;
    description: string;
    request: (baseUrl: string) => autocannon.Options;
}

const scenarios: Scenario[] = [
    {
        name: 'getUser',
        description: 'GET /users/:id, path param and a small object out',
        request: (baseUrl) => ({
            url: `${baseUrl}/users/user-13`,
        }),
    },
    {
        name: 'listUsers',
        description: 'GET /users?page=1&limit=25, query parsing and a 25-item list out',
        request: (baseUrl) => ({
            url: `${baseUrl}/users?page=1&limit=25`,
        }),
    },
    {
        name: 'createUser',
        description: 'POST /users, JSON body in and a created object out',
        request: (baseUrl) => ({
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
];

interface ScenarioResult {
    requestsPerSecond: number;
    meanMilliseconds: number;
    p50Milliseconds: number;
    p99Milliseconds: number;
}

interface ServerResult {
    startupMilliseconds: number;
    scenarios: Record<string, ScenarioResult>;
}

const results: Record<string, ServerResult> = {};

let nextPort = 4600;

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function serverEntry(adapter: Adapter, variant: Variant): string {
    return path.join(appRoot, 'src', 'servers', `${adapter}-${variant}.ts`);
}

async function waitForReady(baseUrl: string, child: ChildProcess): Promise<void> {
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

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) {
        return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    await exited;
    clearTimeout(forceKill);
}

async function startServer(
    adapter: Adapter,
    variant: Variant
): Promise<{ child: ChildProcess; baseUrl: string; startupMilliseconds: number }> {
    const port = nextPort;
    nextPort += 1;
    const baseUrl = `http://127.0.0.1:${port}`;
    const startedAt = performance.now();
    const child = spawn(tsxBin, [serverEntry(adapter, variant)], {
        env: {
            ...process.env,
            PORT: String(port),
        },
        stdio: 'ignore',
    });
    try {
        await waitForReady(baseUrl, child);
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

async function measureStartup(adapter: Adapter, variant: Variant): Promise<number> {
    const samples: number[] = [];
    for (let run = 0; run < startupRuns; run += 1) {
        const { child, startupMilliseconds } = await startServer(adapter, variant);
        samples.push(startupMilliseconds);
        await stopServer(child);
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)];
    if (median === undefined) {
        throw new Error('no startup samples collected');
    }
    return median;
}

async function measureScenarios(adapter: Adapter, variant: Variant): Promise<Record<string, ScenarioResult>> {
    const { child, baseUrl } = await startServer(adapter, variant);
    const scenarioResults: Record<string, ScenarioResult> = {};
    try {
        for (const scenario of scenarios) {
            const request = scenario.request(baseUrl);
            if (warmupDuration > 0) {
                await autocannon({
                    ...request,
                    connections,
                    duration: warmupDuration,
                });
            }
            const result = await autocannon({
                ...request,
                connections,
                duration,
            });
            if (result.non2xx > 0) {
                throw new Error(`${adapter}-${variant} ${scenario.name}: ${result.non2xx} non-2xx responses`);
            }
            scenarioResults[scenario.name] = {
                requestsPerSecond: result.requests.average,
                meanMilliseconds: result.latency.average,
                p50Milliseconds: result.latency.p50,
                p99Milliseconds: result.latency.p99,
            };
        }
    } finally {
        await stopServer(child);
    }
    return scenarioResults;
}

function resultKey(adapter: Adapter, variant: Variant): string {
    return `${adapter}-${variant}`;
}

function getResult(adapter: Adapter, variant: Variant): ServerResult {
    const result = results[resultKey(adapter, variant)];
    if (!result) {
        throw new Error(`no results for ${adapter}-${variant}`);
    }
    return result;
}

function getScenarioResult(adapter: Adapter, variant: Variant, scenarioName: string): ScenarioResult {
    const scenarioResult = getResult(adapter, variant).scenarios[scenarioName];
    if (!scenarioResult) {
        throw new Error(`no ${scenarioName} results for ${adapter}-${variant}`);
    }
    return scenarioResult;
}

function formatTable(header: string[], rows: string[][]): string {
    const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)));
    const formatRow = (row: string[]): string =>
        row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join('  ');
    return [formatRow(header), ...rows.map(formatRow)].join('\n');
}

function formatNumber(value: number, digits = 0): string {
    return value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function printReport(): void {
    for (const scenario of scenarios) {
        console.log(`\n${scenario.name}: ${scenario.description}`);
        const rows = selectedAdapters.map((adapter) => {
            const baseline = getScenarioResult(adapter, 'baseline', scenario.name);
            const kizuna = getScenarioResult(adapter, 'kizuna', scenario.name);
            return [
                adapter,
                formatNumber(baseline.requestsPerSecond),
                formatNumber(kizuna.requestsPerSecond),
                `${formatNumber((kizuna.requestsPerSecond / baseline.requestsPerSecond) * 100, 1)}%`,
                formatNumber(baseline.meanMilliseconds, 2),
                formatNumber(kizuna.meanMilliseconds, 2),
                formatNumber(baseline.p99Milliseconds),
                formatNumber(kizuna.p99Milliseconds),
            ];
        });
        console.log(
            formatTable(['adapter', 'plain req/s', 'kizuna req/s', 'kept', 'plain mean', 'kizuna mean', 'plain p99', 'kizuna p99'], rows)
        );
    }

    console.log('\nstartup: time from process spawn to first successful response, median of ' + startupRuns + ' runs (ms)');
    const startupRows = selectedAdapters.map((adapter) => {
        const baseline = getResult(adapter, 'baseline').startupMilliseconds;
        const kizuna = getResult(adapter, 'kizuna').startupMilliseconds;
        const added = kizuna - baseline;
        return [adapter, formatNumber(baseline), formatNumber(kizuna), `${added >= 0 ? '+' : ''}${formatNumber(added)}`];
    });
    console.log(formatTable(['adapter', 'plain', 'kizuna', 'added'], startupRows));
    console.log('\nlatencies are in milliseconds; "kept" is kizuna throughput as a share of plain framework throughput.');
    console.log(`settings: ${connections} connections, ${duration}s per run after ${warmupDuration}s warmup.`);
}

function writeResults(): void {
    const resultsDirectory = path.join(appRoot, 'results');
    mkdirSync(resultsDirectory, {
        recursive: true,
    });
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const file = path.join(resultsDirectory, `${timestamp}.json`);
    writeFileSync(
        file,
        JSON.stringify(
            {
                settings: {
                    duration,
                    warmupDuration,
                    connections,
                    startupRuns,
                },
                results,
            },
            null,
            4
        )
    );
    console.log(`\nraw results written to ${path.relative(process.cwd(), file)}`);
}

const requestedAdapters = process.argv
    .slice(2)
    .filter((argument): argument is Adapter => (adapters as readonly string[]).includes(argument));
const selectedAdapters = requestedAdapters.length > 0 ? requestedAdapters : [...adapters];

for (const adapter of selectedAdapters) {
    for (const variant of variants) {
        console.log(`benchmarking ${adapter} ${variant}...`);
        const startupMilliseconds = await measureStartup(adapter, variant);
        const scenarioResults = await measureScenarios(adapter, variant);
        results[resultKey(adapter, variant)] = {
            startupMilliseconds,
            scenarios: scenarioResults,
        };
    }
}

printReport();
writeResults();
