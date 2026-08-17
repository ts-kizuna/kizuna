# bench

Measures what ts-kizuna costs on top of each HTTP adapter. Every adapter runs twice with the same three routes: once written directly against the framework, once through a ts-kizuna contract. The difference between the two runs is the price of the contract pipeline.

Three routes, each stressing a different part of that pipeline:

- `getUser`: path param in, small object out.
- `listUsers`: query parsing in, a 25-item list out.
- `createUser`: validated JSON body in, created object out.

## Two runners

**`pnpm bench`** runs the full suite: throughput, mean and p99 latency, and startup time (process spawn to first response) for every adapter and scenario. Good for an overview. Raw numbers land in `results/` as JSON.

**`pnpm bench:ab`** runs one scenario as a paired comparison: plain and kizuna servers alternate round by round, so both see the same machine conditions, and medians decide. Use this one to judge whether a change helped. Single full-suite runs drift several percent with machine load, enough to show a regression that is not there.

```sh
pnpm bench                    # full suite, all adapters
pnpm bench fastify            # full suite, one adapter
pnpm bench:ab                 # paired getUser comparison, all adapters
pnpm bench:ab hono listUsers  # paired comparison, one adapter, one scenario
```

Both accept environment variables: `BENCH_CONNECTIONS` (default 50), `BENCH_DURATION` (seconds per measured run, 10 for the suite, 6 for pairs), `BENCH_WARMUP` (warmup seconds, default 2), `BENCH_STARTUP_RUNS` (spawns behind the startup median, default 5), `BENCH_ROUNDS` (pairs per adapter in `bench:ab`, default 3).

## Layout

- `src/contract.ts`, `src/data.ts`: the bench contract and its fixed data.
- `src/servers/`: one entry per adapter and variant, e.g. `fastify-baseline.ts` and `fastify-kizuna.ts`. Each pair serves identical routes.
- `src/harness.ts`: shared machinery, spawning servers and firing load rounds.
- `src/run.ts`, `src/interleaved.ts`: the two runners.

## Reading the numbers

Both variants run under `tsx`, so the startup column overstates a production start equally on both sides. Compare the pair, not the absolute value. The baseline servers validate nothing, so part of the throughput gap is validation work the plain server simply is not doing.
