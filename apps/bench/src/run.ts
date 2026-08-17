import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    type Adapter,
    type ScenarioName,
    type Variant,
    adapters,
    appRoot,
    formatNumber,
    formatTable,
    median,
    runLoad,
    scenarios,
    startServer,
    stopServer,
} from './harness';

/**
 * The full suite: throughput, latency, and startup for every adapter, plain and
 * through ts-kizuna. One measured run per server, so numbers drift with machine
 * load; when deciding whether a change helped, trust `pnpm bench:ab` instead.
 */

const settings = {
    connections: Number(process.env.BENCH_CONNECTIONS ?? 50),
    duration: Number(process.env.BENCH_DURATION ?? 10),
    warmupDuration: Number(process.env.BENCH_WARMUP ?? 2),
    startupRuns: Number(process.env.BENCH_STARTUP_RUNS ?? 5),
};

interface ScenarioResult {
    requestsPerSecond: number;
    meanMilliseconds: number;
    p50Milliseconds: number;
    p99Milliseconds: number;
}

interface ServerResult {
    startupMilliseconds: number;
    scenarios: Record<ScenarioName, ScenarioResult>;
}

interface AdapterRun {
    adapter: Adapter;
    baseline: ServerResult;
    kizuna: ServerResult;
}

async function measureStartup(adapter: Adapter, variant: Variant): Promise<number> {
    const samples: number[] = [];
    for (let run = 0; run < settings.startupRuns; run += 1) {
        const server = await startServer(adapter, variant);
        samples.push(server.startupMilliseconds);
        await stopServer(server.child);
    }
    return median(samples);
}

async function measureServer(adapter: Adapter, variant: Variant): Promise<ServerResult> {
    const startupMilliseconds = await measureStartup(adapter, variant);
    const server = await startServer(adapter, variant);
    const scenarioResults = {} as Record<ScenarioName, ScenarioResult>;
    try {
        for (const scenario of scenarios) {
            const result = await runLoad(scenario.request(server.baseUrl), settings);
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
        await stopServer(server.child);
    }
    return {
        startupMilliseconds,
        scenarios: scenarioResults,
    };
}

function printReport(runs: AdapterRun[]): void {
    for (const scenario of scenarios) {
        console.log(`\n${scenario.name}: ${scenario.description}`);
        const rows = runs.map((run) => {
            const baseline = run.baseline.scenarios[scenario.name];
            const kizuna = run.kizuna.scenarios[scenario.name];
            return [
                run.adapter,
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

    console.log(`\nstartup: time from process spawn to first successful response, median of ${settings.startupRuns} runs (ms)`);
    const startupRows = runs.map((run) => {
        const added = run.kizuna.startupMilliseconds - run.baseline.startupMilliseconds;
        return [
            run.adapter,
            formatNumber(run.baseline.startupMilliseconds),
            formatNumber(run.kizuna.startupMilliseconds),
            `${added >= 0 ? '+' : ''}${formatNumber(added)}`,
        ];
    });
    console.log(formatTable(['adapter', 'plain', 'kizuna', 'added'], startupRows));
    console.log('\nlatencies are in milliseconds; "kept" is kizuna throughput as a share of plain framework throughput.');
    console.log(`settings: ${settings.connections} connections, ${settings.duration}s per run after ${settings.warmupDuration}s warmup.`);
}

function writeResults(runs: AdapterRun[]): void {
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
                settings,
                runs,
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

const runs: AdapterRun[] = [];
for (const adapter of selectedAdapters) {
    console.log(`benchmarking ${adapter}...`);
    runs.push({
        adapter,
        baseline: await measureServer(adapter, 'baseline'),
        kizuna: await measureServer(adapter, 'kizuna'),
    });
}

printReport(runs);
writeResults(runs);
