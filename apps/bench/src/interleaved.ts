import {
    type Adapter,
    type Scenario,
    adapters,
    formatNumber,
    median,
    runLoad,
    scenarios,
    startServer,
    stopServer,
    variants,
} from './harness';

/**
 * Paired comparison. Alternates plain and kizuna servers round by round, so
 * both see the same machine conditions, then compares medians. The full suite
 * (`pnpm bench`) measures each server once and drifts with machine load; this
 * is the runner to trust when deciding whether a change helped.
 */

const settings = {
    connections: Number(process.env.BENCH_CONNECTIONS ?? 50),
    duration: Number(process.env.BENCH_DURATION ?? 6),
    warmupDuration: Number(process.env.BENCH_WARMUP ?? 2),
    rounds: Number(process.env.BENCH_ROUNDS ?? 3),
};

async function measureOnce(adapter: Adapter, variant: (typeof variants)[number], scenario: Scenario): Promise<number> {
    const server = await startServer(adapter, variant);
    try {
        const result = await runLoad(scenario.request(server.baseUrl), settings);
        if (result.non2xx > 0) {
            throw new Error(`${adapter}-${variant} ${scenario.name}: ${result.non2xx} non-2xx responses`);
        }
        return Math.round(result.requests.average);
    } finally {
        await stopServer(server.child);
    }
}

const requestedArguments = process.argv.slice(2);
const requestedAdapters = requestedArguments.filter((argument): argument is Adapter => (adapters as readonly string[]).includes(argument));
const selectedAdapters = requestedAdapters.length > 0 ? requestedAdapters : [...adapters];
const scenario = scenarios.find((candidate) => requestedArguments.includes(candidate.name)) ?? scenarios[0];

console.log(`${scenario.name}: ${scenario.description}`);
console.log(`${settings.rounds} alternating rounds, ${settings.connections} connections, ${settings.duration}s per run\n`);

for (const adapter of selectedAdapters) {
    const baselineSamples: number[] = [];
    const kizunaSamples: number[] = [];
    for (let round = 0; round < settings.rounds; round += 1) {
        baselineSamples.push(await measureOnce(adapter, 'baseline', scenario));
        kizunaSamples.push(await measureOnce(adapter, 'kizuna', scenario));
    }
    const baseline = median(baselineSamples);
    const kizuna = median(kizunaSamples);
    const kept = (kizuna / baseline) * 100;
    console.log(
        `${adapter.padEnd(8)} plain ${formatNumber(baseline)} req/s  kizuna ${formatNumber(kizuna)} req/s  kept ${formatNumber(kept, 1)}%` +
            `  (rounds: ${kizunaSamples.map((sample) => formatNumber(sample)).join(' / ')} vs ${baselineSamples.map((sample) => formatNumber(sample)).join(' / ')})`
    );
}
